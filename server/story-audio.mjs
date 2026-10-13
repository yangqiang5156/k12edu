import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createAccessToken, verifyAccessToken } from './security.mjs';
import { randomUUID } from 'node:crypto';

const manifest = JSON.parse(await readFile(new URL('./builtin-audio.json', import.meta.url), 'utf8'));
export const builtinAudioNames = new Set(manifest);

export function createStoryAudio({ storage, identity, usage, database, env }) {
  const secret = env.SESSION_SECRET || randomUUID();
  const base = String(env.APP_BASE_PATH || '/lexue/').replace(/\/?$/, '/');
  let active = 0;
  const urlFor = (row, actor) => {
    if (!row.audio_object_key) return undefined;
    const ticket = createAccessToken({ type: 'audio', storyId: row.id, familyId: actor.familyId, userId: actor.userId, deviceId: actor.deviceId, sessionId: actor.sessionId }, secret, 1800);
    return `${base}api/stories/listen/${row.id}?ticket=${encodeURIComponent(ticket)}`;
  };
  const serve = async (req, res, key) => {
    await usage.audioRate(req);
    if (!storage.enabled) throw Object.assign(new Error('故事音频存储尚未配置'), { status: 503 });
    if (active >= 4) throw Object.assign(new Error('音频服务繁忙'), { status: 429 });
    active++;
    let stream;
    try {
      await usage.reserveAudio(req, 0);
      const meta = await storage.head(key);
      const size = Number(meta.res?.headers?.['content-length']);
      if (!Number.isSafeInteger(size) || size <= 0 || size > 20 * 1024 * 1024) throw new Error('音频大小无效');
      let start = 0, end = size - 1, partial = false;
      if (req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!range || (!range[1] && !range[2])) throw Object.assign(new Error('音频范围无效'), { status: 416 });
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw Object.assign(new Error('音频范围无效'), { status: 416 });
        partial = true;
      }
      await usage.reserveAudio(req, req.method === 'HEAD' ? 0 : end - start + 1, 0);
      const headers = { 'Content-Type': 'audio/mpeg', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) };
      if (req.method === 'HEAD') { res.writeHead(partial ? 206 : 200, headers); res.end(); return; }
      const result = await storage.getStream(key, { headers: { Range: `bytes=${start}-${end}` } });
      stream = result.stream;
      res.writeHead(partial ? 206 : 200, headers);
      await pipeline(stream, res, { signal: AbortSignal.timeout(120000) });
    } catch (error) {
      stream?.destroy();
      if (res.headersSent) { res.destroy(); return; }
      if (error.status === 404 || error.code === 'NoSuchKey') error.status = 404;
      throw error;
    } finally { active--; }
  };
  const handle = async (req, res, url) => {
    const builtin = url.pathname.match(/^\/api\/stories\/builtin\/([a-z0-9-]+-v\d+\.mp3)$/);
    const listen = url.pathname.match(/^\/api\/stories\/listen\/([0-9a-f-]{36})$/i);
    if (!builtin && !listen) return false;
    if (!['GET', 'HEAD'].includes(req.method)) throw Object.assign(new Error('请求方式不支持'), { status: 405 });
    if (builtin) {
      if (!builtinAudioNames.has(builtin[1])) throw Object.assign(new Error('故事音频不存在'), { status: 404 });
      await serve(req, res, storage.builtInKey(builtin[1]));
    } else {
      const ticket = verifyAccessToken(url.searchParams.get('ticket'), secret);
      if (!ticket || ticket.type !== 'audio' || ticket.storyId !== listen[1]) throw Object.assign(new Error('试听链接已过期，请刷新故事列表'), { status: 401 });
      const token = createAccessToken({ ...ticket, type: 'account' }, secret, 10);
      const actor = await identity.authenticate({ headers: { authorization: `Bearer ${token}` } });
      const result = await database.query("SELECT audio_object_key FROM family_stories WHERE id=$1 AND family_id=$2 AND status IN ('ready','published')", [listen[1], actor.familyId]);
      if (!result.rows[0]?.audio_object_key) throw Object.assign(new Error('音频不存在'), { status: 404 });
      await serve(req, res, result.rows[0].audio_object_key);
    }
    return true;
  };
  return { handle, urlFor };
}

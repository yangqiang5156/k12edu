import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, rm, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import OSS from 'ali-oss';

const hash = (value) => createHash('sha256').update(value).digest('hex');

export function createAudioCache(env = process.env) {
  const directory = env.TTS_CACHE_DIR || join(process.cwd(), '.cache', 'tts');
  const prefix = (env.OSS_TTS_PREFIX || 'lexue/tts/').replace(/^\/+/, '').replace(/\/?$/, '/');
  const ossEnabled = Boolean(env.OSS_REGION && env.OSS_BUCKET && env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET);
  const client = ossEnabled ? new OSS({
    region: env.OSS_REGION,
    bucket: env.OSS_BUCKET,
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    endpoint: env.OSS_ENDPOINT || undefined,
    secure: true,
    timeout: 15000,
    internal: env.OSS_INTERNAL === 'true',
  }) : undefined;

  const maxBytes = Number(env.TTS_CACHE_MAX_BYTES || 536870912);
  const ttlMs = Number(env.TTS_CACHE_TTL_DAYS || 7) * 86400000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isFinite(ttlMs) || ttlMs < 1) throw new Error('缓存容量或有效期配置无效');
  let lastSweep = 0, sweeping;
  const sweep = async (force = false) => {
    if (sweeping) return sweeping;
    if (!force && Date.now() - lastSweep < 60000) return;
    sweeping = (async () => {
      const files = [];
      for (const folder of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        if (!folder.isDirectory() || !/^[a-f0-9]{2}$/.test(folder.name)) continue;
        for (const name of await readdir(join(directory, folder.name))) {
          const path = join(directory, folder.name, name), meta = await stat(path).catch(() => null);
          if (meta?.isFile()) files.push({ path, size: meta.size, time: meta.mtimeMs });
        }
      }
      let size = files.reduce((total, file) => total + file.size, 0);
      for (const file of files.sort((a, b) => a.time - b.time)) {
        if (Date.now() - file.time <= ttlMs && size <= maxBytes) continue;
        await rm(file.path, { force: true }); size -= file.size;
      }
      lastSweep = Date.now();
    })();
    try { await sweeping; } finally { sweeping = undefined; }
  };
  const keyFor = ({ provider, model, voice, language, text, rate = 0.85 }) => hash(JSON.stringify({ version: 1, provider, model, voice, language, rate, text: text.trim() }));
  const paths = (key) => ({ local: join(directory, key.slice(0, 2), `${key}.audio`), object: `${prefix}${key}.audio` });

  const get = async (key) => {
    await sweep();
    const target = paths(key);
    try {
      if (Date.now() - (await stat(target.local)).mtimeMs > ttlMs) throw new Error('缓存过期');
      const bytes = await readFile(target.local);
      const meta = JSON.parse(await readFile(`${target.local}.json`, 'utf8'));
      return { bytes, type: meta.type, source: 'local' };
    } catch { /* 本地未命中时继续检查 OSS。 */ }
    if (!client) return undefined;
    try {
      const result = await client.get(target.object);
      const bytes = Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
      const type = result.res?.headers?.['content-type'] || 'audio/mpeg';
      await persistLocal(target.local, bytes, type);
      return { bytes, type, source: 'oss' };
    } catch (error) {
      if (error?.status !== 404 && error?.code !== 'NoSuchKey') console.warn('读取 OSS 语音缓存失败：', error.message);
      return undefined;
    }
  };

  const persistLocal = async (path, bytes, type) => {
    if (bytes.length > Math.min(maxBytes, 20 * 1024 * 1024)) throw new Error('音频缓存过大');
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
    await writeFile(`${path}.json`, JSON.stringify({ type, storedAt: new Date().toISOString() }));
    await sweep(true);
  };

  const put = async (key, audio) => {
    const target = paths(key);
    await persistLocal(target.local, audio.bytes, audio.type);
    if (client) {
      try {
        await client.put(target.object, target.local, { headers: { 'Content-Type': audio.type, 'Cache-Control': 'private, no-store' } });
      } catch (error) { console.warn('写入 OSS 语音缓存失败，已保留本地缓存：', error.message); }
    }
  };

  return { enabled: true, ossEnabled, keyFor, get, put, sweep };
}

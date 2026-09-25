import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
    internal: env.OSS_INTERNAL === 'true',
  }) : undefined;

  const keyFor = ({ provider, model, voice, language, text, rate = 0.85 }) => hash(JSON.stringify({ version: 1, provider, model, voice, language, rate, text: text.trim() }));
  const paths = (key) => ({ local: join(directory, key.slice(0, 2), `${key}.audio`), object: `${prefix}${key}.audio` });

  const get = async (key) => {
    const target = paths(key);
    try {
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
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
    await writeFile(`${path}.json`, JSON.stringify({ type, storedAt: new Date().toISOString() }));
  };

  const put = async (key, audio) => {
    const target = paths(key);
    await persistLocal(target.local, audio.bytes, audio.type);
    if (client) {
      try {
        await client.put(target.object, target.local, { headers: { 'Content-Type': audio.type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
      } catch (error) { console.warn('写入 OSS 语音缓存失败，已保留本地缓存：', error.message); }
    }
  };

  return { enabled: true, ossEnabled, keyFor, get, put };
}

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import OSS from 'ali-oss';
import { createAudioCache } from '../server/audio-cache.mjs';

const origin = process.env.LEXUE_SMOKE_URL || 'http://127.0.0.1:4174';
const deviceId = randomUUID();
const text = `乐学语音缓存全流程测试${Date.now()}`;
const language = 'zh';

const guestResponse = await fetch(`${origin}/api/session/guest`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId })
});
if (!guestResponse.ok) throw new Error(`游客会话创建失败：${guestResponse.status}`);
const { token } = await guestResponse.json();

const cache = createAudioCache(process.env);
if (!cache.ossEnabled) throw new Error('应用没有启用 OSS 缓存');
const provider = process.env.TTS_PROVIDER || 'qwen';
const model = provider === 'qwen' ? process.env.QWEN_TTS_MODEL || 'qwen-audio-3.1-tts-flash'
  : provider === 'minimax' ? process.env.MINIMAX_TTS_MODEL || 'speech-2.8-turbo' : process.env.DOUBAO_TTS_RESOURCE_ID || 'seed-tts-2.0';
const voice = provider === 'qwen' ? process.env.QWEN_TTS_VOICE || 'longanhuan_v3.1'
  : provider === 'minimax' ? process.env.MINIMAX_TTS_VOICE || 'female-shaonv' : process.env.DOUBAO_TTS_VOICE || 'zh_female_vv_uranus_bigtts';
const key = cache.keyFor({ provider, model, voice, language, text });
const directory = process.env.TTS_CACHE_DIR || join(process.cwd(), '.cache', 'tts');
const localPath = join(directory, key.slice(0, 2), `${key}.audio`);
const prefix = (process.env.OSS_TTS_PREFIX || 'lexue/tts/').replace(/^\/+/, '').replace(/\/?$/, '/');
const objectKey = `${prefix}${key}.audio`;
const oss = new OSS({
  region: process.env.OSS_REGION,
  bucket: process.env.OSS_BUCKET,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  endpoint: process.env.OSS_ENDPOINT || undefined,
  secure: true,
  internal: process.env.OSS_INTERNAL === 'true'
});

async function synthesize() {
  const response = await fetch(`${origin}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, language })
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`语音请求失败：${response.status} ${bytes.toString('utf8').slice(0, 200)}`);
  if (bytes.length < 100) throw new Error('语音服务返回内容过短');
  return { source: response.headers.get('x-lexue-audio-cache'), bytes: bytes.length };
}

try {
  const upstream = await synthesize();
  await oss.get(objectKey);
  await rm(localPath, { force: true });
  await rm(`${localPath}.json`, { force: true });
  const fromOss = await synthesize();
  const fromLocal = await synthesize();
  if (upstream.source !== 'miss') throw new Error(`首次请求应调用上游，实际缓存状态：${upstream.source}`);
  if (fromOss.source !== 'oss') throw new Error(`删除本地缓存后应命中 OSS，实际：${fromOss.source}`);
  if (fromLocal.source !== 'local') throw new Error(`第三次应命中本机缓存，实际：${fromLocal.source}`);
  console.log(JSON.stringify({ ok: true, upstream, fromOss, fromLocal }, null, 2));
} finally {
  await rm(localPath, { force: true });
  await rm(`${localPath}.json`, { force: true });
  await oss.delete(objectKey).catch(() => undefined);
}

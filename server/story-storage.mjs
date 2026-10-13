import OSS from 'ali-oss';

const trimSlashes = (value) => String(value || '').replace(/^\/+|\/+$/g, '');

export function createStoryStorage(env = process.env) {
  const prefix = trimSlashes(env.OSS_STORY_PREFIX || 'lexue/stories');
  const enabled = Boolean(env.OSS_REGION && env.OSS_BUCKET && env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET);
  const client = enabled ? new OSS({
    region: env.OSS_REGION,
    bucket: env.OSS_BUCKET,
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    endpoint: env.OSS_ENDPOINT || undefined,
    secure: true,
    timeout: 15000,
    // 浏览器必须获得外网地址。故事上传量不大，避免误签内网 URL。
    internal: env.OSS_STORY_INTERNAL === 'true',
  }) : undefined;
  const publicBase = String(env.STORY_AUDIO_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const builtInKey = (filename) => `${prefix}/builtin/${filename.replace(/^\/+/, '')}`;
  const familyKey = (familyId, storyId, version) => `${prefix}/families/${familyId}/${storyId}/${version}.mp3`;
  const urlFor = (key, expires = Number(env.STORY_AUDIO_URL_TTL_SECONDS || 7200)) => {
    if (publicBase && key.includes('/builtin/')) return `${publicBase}/${key}`;
    if (!client) return undefined;
    return client.signatureUrl(key, { expires, method: 'GET' });
  };
  const put = async (key, source, type = 'audio/mpeg') => {
    if (!client) throw Object.assign(new Error('故事 OSS 尚未配置'), { status: 503 });
    await client.put(key, source, { headers: {
      'Content-Type': type,
      'Cache-Control': 'private, no-store',
    } });
    return key;
  };
  const remove = async (key) => {
    if (client && key) await client.delete(key);
  };
  const head = async (key) => {
    if (!client) throw Object.assign(new Error('故事 OSS 尚未配置'), { status: 503 });
    // ObjectMeta返回对象原始大小，避免HeadObject压缩影响字节预算。
    return client.getObjectMeta(key);
  };
  const getStream = (key, options) => client.getStream(key, { ...options, timeout: 15000 });
  return { getStream, enabled, prefix, builtInKey, familyKey, urlFor, put, remove, head };
}

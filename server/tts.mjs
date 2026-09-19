import { setDefaultResultOrder } from 'node:dns';
import { randomUUID } from 'node:crypto';

// 优先 IPv4，避免部分本地网络的 IPv6 路由导致云语音连接重置。
setDefaultResultOrder('ipv4first');

class ServiceError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
const required = (env, name) => {
  if (!env[name]?.trim()) throw new ServiceError(`语音服务尚未配置：${name}`, 503);
  return env[name].trim();
};

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

async function downloadWithRetry(url, request, signal) {
  const delays = [0, 250, 750];
  let lastError;
  for (const delay of delays) {
    if (delay) await wait(delay, signal);
    try {
      const response = await request(url, { signal, redirect: 'error' });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) {
        throw new ServiceError(`千问音频下载失败（${response.status}），请重试`);
      }
      lastError = new ServiceError(`千问音频下载失败（${response.status}），请重试`);
    } catch (error) {
      if (signal?.aborted || error instanceof ServiceError) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export async function synthesize(text, language = 'auto', env = process.env, request = fetch, signal = AbortSignal.timeout(45000)) {
  const provider = env.TTS_PROVIDER || 'qwen';
  const post = async (url, headers, body) => {
    const response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new ServiceError(`语音服务请求失败（${response.status}），请检查服务配置或额度`);
    return response;
  };
  let bytes;
  let type = 'audio/mpeg';
  if (provider === 'qwen') {
    const key = required(env, 'QWEN_API_KEY');
    const workspace = required(env, 'QWEN_WORKSPACE_ID');
    if (!/^[a-zA-Z0-9-]+$/.test(workspace)) throw new ServiceError('QWEN_WORKSPACE_ID 格式不正确', 503);
    const voice = language === 'en'
      ? env.QWEN_TTS_EN_VOICE || 'loongeva_v3.6'
      : env.QWEN_TTS_VOICE || 'longanhuan_v3.6';
    const response = await post(`https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`, { Authorization: `Bearer ${key}` }, {
      model: env.QWEN_TTS_MODEL || 'qwen-audio-3.0-tts-flash',
      input: { text, voice, format: 'wav', sample_rate: 24000, rate: 0.85, ...(language === 'auto' ? {} : { language_hints: [language] }) },
    });
    const data = await response.json();
    const url = data.output?.audio?.url;
    if (data.code || !url) throw new ServiceError('千问未返回音频，请检查模型、音色和工作空间权限');
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !/(^|\.)(aliyuncs\.com|aliyun\.com)$/.test(parsed.hostname)) throw new ServiceError('千问返回了无效音频地址');
    parsed.protocol = 'https:';
    // 阿里云先返回临时 OSS 地址。下载阶段允许有限重试，避免偶发连接重置
    // 直接暴露给孩子；只重试下载，不重复提交合成请求和消耗额度。
    const audio = await downloadWithRetry(parsed.href, request, signal);
    bytes = Buffer.from(await audio.arrayBuffer());
    type = 'audio/wav';
  } else if (provider === 'minimax') {
    const response = await post('https://api.minimaxi.com/v1/t2a_v2', { Authorization: `Bearer ${required(env, 'MINIMAX_API_KEY')}` }, {
      model: env.MINIMAX_TTS_MODEL || 'speech-2.8-turbo', text, stream: false,
      language_boost: language === 'en' ? 'English' : language === 'zh' ? 'Chinese' : 'auto',
      voice_setting: { voice_id: env.MINIMAX_TTS_VOICE || 'female-shaonv', speed: 0.85, vol: 1, pitch: 0 },
      audio_setting: { format: 'mp3', sample_rate: 24000, bitrate: 128000, channel: 1 },
    });
    const data = await response.json();
    if (data.base_resp?.status_code !== 0 || !/^(?:[a-f0-9]{2})+$/i.test(data.data?.audio || '')) throw new ServiceError('MiniMax 合成失败，请检查音色、模型或余额');
    bytes = Buffer.from(data.data.audio, 'hex');
  } else if (provider === 'doubao') {
    const headers = { 'X-Api-Resource-Id': env.DOUBAO_TTS_RESOURCE_ID || 'seed-tts-2.0', 'X-Api-Request-Id': randomUUID() };
    if (env.DOUBAO_API_KEY) headers['X-Api-Key'] = env.DOUBAO_API_KEY;
    else {
      headers['X-Api-App-Id'] = required(env, 'DOUBAO_APP_ID');
      headers['X-Api-Access-Key'] = required(env, 'DOUBAO_ACCESS_KEY');
    }
    const response = await post('https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse', headers, {
      user: { uid: 'lexue' }, req_params: { text, speaker: env.DOUBAO_TTS_VOICE || 'zh_female_vv_uranus_bigtts', sample_rate: 24000, audio_params: { format: 'mp3', speech_rate: -15 } },
    });
    const chunks = [];
    let complete = false;
    for (const line of (await response.text()).split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = JSON.parse(line.slice(5).trim());
      if (data.code && data.code !== 20000000) throw new ServiceError('豆包合成失败，请检查音色、资源权限或额度');
      if (data.data) chunks.push(Buffer.from(data.data, 'base64'));
      if (data.code === 20000000) complete = true;
    }
    if (!complete) throw new ServiceError('豆包音频传输未完成，请重试');
    bytes = Buffer.concat(chunks);
  } else throw new ServiceError('TTS_PROVIDER 仅支持 qwen、doubao、minimax', 503);
  if (!bytes?.length) throw new ServiceError('语音服务返回了空音频');
  return { bytes, type };
}

export function createTtsMiddleware(env = process.env, request = fetch) {
  const services = arguments[2] || {};
  const usage = services.usage;
  const cache = services.cache;
  const inflight = new Map();
  let active = 0;
  let windowStart = Date.now();
  let calls = 0;
  return async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/api/tts') return next();
    const sendError = (status, error) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error })); } };
    const sendAudio = (audio, cacheState, key) => {
      if (res.destroyed) return;
      res.writeHead(200, {
        'Content-Type': audio.type,
        'Content-Length': audio.bytes.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `"${key}"`,
        'X-Lexue-Audio-Cache': cacheState,
      });
      res.end(audio.bytes);
    };
    if (req.method !== 'POST') return sendError(405, '请使用 POST 请求');
    if (!req.headers['content-type']?.startsWith('application/json')) return sendError(415, '请使用 JSON 请求');
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendError(403, '不允许跨站朗读请求');
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); calls = 0; }
    if (active >= 3 || calls >= 60) return sendError(429, '朗读请求较多，请稍后再试');
    active += 1;
    calls += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const close = () => controller.abort();
    res.on('close', close);
    try {
      req.setEncoding('utf8');
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 24000) throw new ServiceError('朗读内容过长', 413);
      }
      let data;
      try { data = JSON.parse(body); } catch { throw new ServiceError('请求内容不是有效 JSON', 400); }
      if (!data || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 3000) throw new ServiceError('朗读文本需要为 1–3000 个字符', 400);
      if (data.language !== undefined && !['auto', 'zh', 'en'].includes(data.language)) throw new ServiceError('朗读语言不受支持', 400);
      const text = data.text.trim();
      const identity = usage ? await usage.authorize(req, 'tts') : undefined;
      const provider = env.TTS_PROVIDER || 'qwen';
      const model = provider === 'qwen' ? env.QWEN_TTS_MODEL || 'qwen-audio-3.0-tts-flash'
        : provider === 'minimax' ? env.MINIMAX_TTS_MODEL || 'speech-2.8-turbo' : env.DOUBAO_TTS_RESOURCE_ID || 'seed-tts-2.0';
      const voice = provider === 'qwen' ? (data.language === 'en' ? env.QWEN_TTS_EN_VOICE || 'loongeva_v3.6' : env.QWEN_TTS_VOICE || 'longanhuan_v3.6')
        : provider === 'minimax' ? env.MINIMAX_TTS_VOICE || 'female-shaonv' : env.DOUBAO_TTS_VOICE || 'zh_female_vv_uranus_bigtts';
      const key = cache?.keyFor({ provider, model, voice, language: data.language || 'auto', text }) || `${provider}-${Buffer.from(text).toString('base64url').slice(0, 64)}`;
      const cached = cache ? await cache.get(key) : undefined;
      if (cached) {
        if (usage) await usage.record(identity, { tts_requests: 1, tts_cache_hits: 1, tts_characters: text.length });
        sendAudio(cached, cached.source, key);
        return;
      }
      if (usage) await usage.assertGlobalBudget('tts');
      const joined = inflight.has(key);
      if (!joined) {
        const promise = synthesize(text, data.language, env, request, controller.signal)
          .then(async (audio) => { if (cache) await cache.put(key, audio); return audio; })
          .finally(() => inflight.delete(key));
        inflight.set(key, promise);
      }
      const audio = await inflight.get(key);
      if (usage) await usage.record(identity, { tts_requests: 1, tts_upstream: joined ? 0 : 1, tts_cache_hits: joined ? 1 : 0, tts_characters: text.length, tts_upstream_characters: joined ? 0 : text.length });
      sendAudio(audio, joined ? 'coalesced' : 'miss', key);
    } catch (error) {
      sendError(error.status || (controller.signal.aborted ? 504 : 502), error instanceof ServiceError ? error.message : controller.signal.aborted ? '朗读超时，请稍后重试' : '语音服务暂时不可用，请检查网络或服务配置');
    } finally {
      clearTimeout(timer);
      res.off('close', close);
      active -= 1;
    }
  };
}

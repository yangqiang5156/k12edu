import { randomUUID } from 'node:crypto';

const MODULE_KINDS = {
  guoxue: ['poem', 'classic'],
  literacy: ['character'],
  math: ['math-choice'],
  english: ['letter', 'word', 'reader'],
  writing: ['trace'],
  science: ['science'],
};

class ContentGenerationError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const text = (value, maxLength) => typeof value === 'string' && value.trim()
  ? value.trim().slice(0, maxLength)
  : undefined;

export function validateGeneratedContent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ContentGenerationError('大模型没有返回完整的资料对象');
  const module = text(raw.module, 20);
  const kind = text(raw.kind, 30);
  if (!module || !MODULE_KINDS[module]) throw new ContentGenerationError('大模型返回了不支持的所属模块');
  if (!kind || !MODULE_KINDS[module].includes(kind)) throw new ContentGenerationError('大模型返回的资料类型与所属模块不匹配');
  const title = text(raw.title, 80);
  if (!title) throw new ContentGenerationError('大模型没有填写资料名称');
  const ageMin = Number(raw.ageMin);
  const ageMax = Number(raw.ageMax);
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 3 || ageMax > 12 || ageMin > ageMax) {
    throw new ContentGenerationError('大模型返回的适合年龄不完整');
  }

  const item = {
    id: `parent-${module}-${now}-${randomUUID().slice(0, 8)}`,
    module,
    kind,
    title,
    ageMin,
    ageMax,
    source: 'imported',
  };
  for (const [key, maxLength] of [['subtitle', 200], ['body', 6000], ['prompt', 1000], ['answer', 500]]) {
    const value = text(raw[key], maxLength);
    if (value) item[key] = value;
  }
  if (Number.isInteger(Number(raw.stage)) && Number(raw.stage) >= 1 && Number(raw.stage) <= 20) item.stage = Number(raw.stage);
  if (Array.isArray(raw.options)) item.options = raw.options.map((value) => text(value, 300)).filter(Boolean).slice(0, 8);
  if (Array.isArray(raw.tags)) item.tags = [...new Set(raw.tags.map((value) => text(value, 40)).filter(Boolean))].slice(0, 12);
  const url = text(raw.url, 1000);
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new ContentGenerationError('大模型返回的正版资源链接格式不正确'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new ContentGenerationError('正版资源链接仅支持 HTTP 或 HTTPS');
    item.url = parsed.href;
  }

  if (!item.tags?.length) throw new ContentGenerationError('大模型没有填写资料标签');
  if (['poem', 'classic', 'character', 'letter', 'word', 'reader', 'trace'].includes(kind) && !item.subtitle) {
    throw new ContentGenerationError('大模型没有填写副标题、作者或学习提示');
  }
  if (['poem', 'classic', 'character', 'letter', 'word', 'reader', 'science'].includes(kind) && !item.body) {
    throw new ContentGenerationError('大模型没有填写正文或讲解');
  }
  if (kind === 'math-choice') {
    if (!item.prompt || !item.answer || !item.options || item.options.length < 2) throw new ContentGenerationError('数学选择题缺少题目、选项或答案');
    if (new Set(item.options).size !== item.options.length) throw new ContentGenerationError('数学选择题包含重复选项');
    if (!item.options.includes(item.answer)) throw new ContentGenerationError('数学选择题的正确答案不在选项中');
    if (!item.stage || item.stage > 6) throw new ContentGenerationError('数学选择题的学习阶段应为 1–6');
  }
  return item;
}

const SYSTEM_PROMPT = `你是面向 3–12 岁儿童的严谨课程资料编辑。把家长的一句话转换成一条完整资料，并且只输出 json 对象。
可用 module/kind 组合：guoxue=poem|classic；literacy=character；math=math-choice；english=letter|word|reader；writing=trace；science=science。
必须输出这些键：module,kind,title,subtitle,body,prompt,options,answer,stage,ageMin,ageMax,tags,url。无适用内容使用 null，options/tags 使用数组。
质量规则：
1. 根据用户意图自动选择模块和类型，内容准确、适龄、措辞清楚，不能虚构作者、原文、答案、事实或链接。
2. title、ageMin、ageMax、tags 必填；年龄只能是 3–12 的整数。
3. poem/classic 必须有准确作者或出处 subtitle 和完整 body；character 必须有拼音 subtitle 和组词/讲解 body；letter/word 必须有发音或大小写提示 subtitle 和中文讲解 body；reader 必须有来源说明 subtitle 和原创/授权内容简介 body；trace 必须有描写提示 subtitle；science 必须有安全、可执行的步骤 body。
4. math-choice 必须有 prompt、2–6 个互不重复的 options、与某个选项完全一致的 answer，以及 1–6 的 stage；自行复算后再输出。
5. 只有用户原话明确给出正版 http/https 链接时才能填写 url，否则必须为 null。不要声称模型生成内容已经经过权威来源核验。
JSON 示例：{"module":"math","kind":"math-choice","title":"5以内加法","subtitle":null,"body":null,"prompt":"桌上有2个苹果，又放来1个，一共有几个？","options":["2","3","4"],"answer":"3","stage":1,"ageMin":4,"ageMax":5,"tags":["数学","加法"],"url":null}`;

async function requestCompletion(prompt, feedback, env, request, signal, onUsage) {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new ContentGenerationError('智能新增尚未配置：DEEPSEEK_API_KEY', 503);
  const response = await request('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: feedback ? `${prompt}\n\n上一次输出校验失败：${feedback}。请修正后重新输出完整 json。` : prompt },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      temperature: 0.2,
      max_tokens: 2500,
    }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  onUsage?.(data?.usage);
  if (!response.ok) {
    const detail = text(data?.error?.message, 180);
    throw new ContentGenerationError(detail ? `DeepSeek 请求失败：${detail}` : `DeepSeek 请求失败（${response.status}），请检查密钥、模型或额度`, response.status === 401 ? 503 : 502);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new ContentGenerationError('DeepSeek 没有返回资料内容');
  try { return JSON.parse(content); } catch { throw new ContentGenerationError('DeepSeek 返回的资料格式不正确'); }
}

export async function generateContent(prompt, env = process.env, request = fetch, signal = AbortSignal.timeout(60000), onUsage) {
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return validateGeneratedContent(await requestCompletion(prompt, feedback, env, request, signal, onUsage));
    } catch (error) {
      if (error.status === 503 || signal.aborted) throw error;
      feedback = error instanceof Error ? error.message : '返回内容不完整';
      if (attempt === 1) throw error;
    }
  }
  throw new ContentGenerationError('智能生成失败，请换一种说法后重试');
}

export function createContentGeneratorMiddleware(env = process.env, request = fetch, services = {}) {
  const usage = services.usage;
  let active = 0;
  let windowStart = Date.now();
  let calls = 0;
  return async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/api/content/generate') return next();
    const send = (status, data) => {
      if (!res.destroyed) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
      }
    };
    if (req.method !== 'POST') return send(405, { error: '请使用 POST 请求' });
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: '请使用 JSON 请求' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: '不允许跨站智能生成请求' });
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); calls = 0; }
    if (active >= 2 || calls >= 20) return send(429, { error: '智能生成请求较多，请稍后再试' });
    active += 1;
    calls += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const close = () => controller.abort();
    res.on('close', close);
    try {
      req.setEncoding('utf8');
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 8192) throw new ContentGenerationError('输入内容过长', 413);
      }
      let data;
      try { data = JSON.parse(body); } catch { throw new ContentGenerationError('请求内容不是有效 JSON', 400); }
      if (!data || typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.trim().length > 500) {
        throw new ContentGenerationError('请用 1–500 个字符描述要新增的资料', 400);
      }
      const identity = usage ? await usage.authorize(req, 'ai') : undefined;
      if (usage) await usage.assertGlobalBudget('ai');
      let tokens = 0;
      const item = await generateContent(data.prompt.trim(), env, request, controller.signal, (providerUsage) => {
        tokens += Number(providerUsage?.total_tokens || providerUsage?.totalTokens || 0);
      });
      if (usage) await usage.record(identity, { ai_requests: 1, ai_tokens: tokens || Math.ceil(data.prompt.trim().length / 2) });
      send(200, { item });
    } catch (error) {
      send(error.status || (controller.signal.aborted ? 504 : 502), {
        error: error instanceof ContentGenerationError ? error.message : controller.signal.aborted ? '智能生成超时，请稍后重试' : '智能生成暂时不可用，请检查网络或服务配置',
      });
    } finally {
      clearTimeout(timer);
      res.off('close', close);
      active -= 1;
    }
  };
}

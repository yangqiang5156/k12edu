import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createIdentityService } from './identity.mjs';
import { createUsageService } from './usage.mjs';
import { trustedClientIp, createEdgeSecurity } from './edge-security.mjs';
import { createTtsMiddleware } from './tts.mjs';
import { createContentGeneratorMiddleware, generateContent } from './content-generator.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { builtinAudioNames, createStoryAudio } from './story-audio.mjs';
import { boundedResponse } from './http.mjs';

export async function call(middleware, url, body, token, method = body === undefined ? 'GET' : 'POST') {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, { url, method, socket: { remoteAddress: '198.51.100.10' }, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() });
  await middleware(req, res, vi.fn());
  return { status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls[0]?.[0], res };
}
const actor = { type: 'guest', deviceId: 'device-security-12345' }, db = { configured: false };
const localUsage = env => createUsageService(db, { authenticate: async () => actor }, { ALLOW_LOCAL_PAID_SERVICES: 'true', ...env });
const post = { method: 'POST', body: JSON.stringify({ input: { text: '你好' } }) };

describe('公网开放防滥用回归', () => {
  it('伪造代理头不能更换普通连接 IP，仅接受显式可信代理的单个 X-Real-IP', () => {
    const req = { socket: { remoteAddress: '198.51.100.10' }, headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4' } };
    expect(trustedClientIp(req)).toBe('198.51.100.10');
    expect(trustedClientIp({ ...req, socket: { remoteAddress: '127.0.0.1' } })).toBe('1.2.3.4');
    expect(trustedClientIp(req, { TRUSTED_PROXY_IPS: '198.51.100.10' })).toBe('1.2.3.4');
  });
  it('并发业务请求无法越过最后一个每日额度', async () => {
    const usage = createUsageService(db, { authenticate: async () => actor }, { GUEST_TTS_DAILY_LIMIT: '1' });
    const results = await Promise.allSettled([usage.authorizeActor(actor, 'tts'), usage.authorizeActor(actor, 'tts')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.status).toBe(429);
  });
  it('上游失败仍扣预算，下一次不会再次向供应商发起请求', async () => {
    const usage = localUsage({ TTS_GLOBAL_DAILY_UPSTREAM_LIMIT: '1' }), fetcher = vi.fn().mockRejectedValue(new Error('failed'));
    const request = usage.providerRequest(actor, fetcher);
    await expect(request('https://tts.example.com', post)).rejects.toThrow('failed');
    await expect(request('https://tts.example.com', post)).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('全站并发槽保持到供应商响应完成，失败释放后可继续', async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const usage = localUsage({ TTS_GLOBAL_CONCURRENCY: '1' });
    const fetcher = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue(new Response('ok'));
    const request = usage.providerRequest(actor, fetcher);
    const first = request('https://tts.example.com', post);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(request('https://tts.example.com', post)).rejects.toMatchObject({ status: 429 });
    finish(new Response('ok')); await first;
    await expect(request('https://tts.example.com', post)).resolves.toBeInstanceOf(Response);
  });
  it('访客和未启用账号不能新合成或调用 AI', async () => {
    const upstream = vi.fn(), usage = createUsageService(db, { authenticate: async () => actor });
    const tts = createTtsMiddleware({ QWEN_API_KEY: 'test' }, upstream, { usage });
    expect((await call(tts, '/api/tts', { text: '你好' })).status).toBe(403);
    const ai = createContentGeneratorMiddleware({}, upstream, { usage });
    expect((await call(ai, '/api/content/generate', { prompt: '一个数学题' })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('匿名请求不会耗尽生成入口的共享计数器', async () => {
    const identity = createIdentityService(db, { SESSION_SECRET: 'a'.repeat(48) });
    const usage = createUsageService(db, identity, { ALLOW_LOCAL_PAID_SERVICES: 'true' });
    const upstream = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ output: { audio: { url: 'https://audio.aliyuncs.com/test.wav' } } }))).mockResolvedValueOnce(new Response('wave'));
    const tts = createTtsMiddleware({ QWEN_API_KEY: 'test', QWEN_WORKSPACE_ID: 'test' }, upstream, { usage });
    for (let i = 0; i < 65; i++) expect((await call(tts, '/api/tts', { text: '你好' })).status).toBe(401);
    const token = await identity.tokenFor(actor);
    expect((await call(tts, '/api/tts', { text: '你好' }, token)).status).toBe(200);
  });
  it('退出后旧会话立即失效', async () => {
    const identity = createIdentityService(db, { SESSION_SECRET: 'a'.repeat(48) });
    const token = await identity.tokenFor(actor);
    expect((await call(identity.handle, '/api/auth/me', undefined, token)).status).toBe(200);
    expect((await call(identity.handle, '/api/auth/logout', {}, token)).status).toBe(200);
    expect((await call(identity.handle, '/api/auth/me', undefined, token)).status).toBe(401);
  });
  it('更换IP仍受全站音频字节预算限制', async () => {
    const usage = localUsage({ AUDIO_GLOBAL_DAILY_BYTE_LIMIT: '10' });
    await usage.reserveAudio({ socket: { remoteAddress: '1.2.3.4' } }, 6);
    await expect(usage.reserveAudio({ socket: { remoteAddress: '5.6.7.8' } }, 6)).rejects.toMatchObject({ status: 429 });
  });
  it('分钟限流清理过期窗口且限制键数量', async () => {
    let now = 1000; const rate = createRateLimiter(db, { clock: () => now, maxKeys: 1 });
    await rate('one', 1, 60000);
    await expect(rate('two', 1, 60000)).rejects.toMatchObject({ status: 429 });
    now = 61000; await rate('two', 1, 60000);
  });
  it('内置音频白名单与产品当前版本保持一致，猜测旧版本不会访问OSS', async () => {
    const stories = JSON.parse(await readFile(new URL('../src/data/stories.json', import.meta.url)));
    expect([...builtinAudioNames].sort()).toEqual(stories.map(r => `${r.id}-${r.audioVersion}.mp3`).sort());
    const storage = { head: vi.fn() }, service = createStoryAudio({ storage, identity: {}, usage: {}, database: db, env: {} });
    await expect(service.handle({ method: 'GET' }, {}, new URL('http://local/api/stories/builtin/no-such-v1.mp3'))).rejects.toMatchObject({ status: 404 });
    expect(storage.head).not.toHaveBeenCalled();
  });
  it('限制供应商响应大小', async () => {
    await expect(boundedResponse(new Response('12345'), 4)).rejects.toThrow('过大');
  });
  it('跨站写请求被拒绝并附带安全响应头', async () => {
    const middleware = createEdgeSecurity(localUsage({})), next = vi.fn();
    const req = { url: '/api/auth/register', method: 'POST', headers: { origin: 'https://evil.example' }, socket: { remoteAddress: '1.2.3.4' } };
    const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };
    await middleware(req, res, next);
    expect(res.writeHead.mock.calls[0][0]).toBe(403); expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
  });
  it('AI重试也受上游预算限制，额度耗尽不会再次重试', async () => {
    const usage = localUsage({ AI_GLOBAL_DAILY_LIMIT: '1' });
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
    await expect(generateContent('测试', { DEEPSEEK_API_KEY: 'test' }, usage.providerRequest(actor, upstream))).rejects.toMatchObject({ status: 429 });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe('故事音频代理', () => {
  it('只返回请求范围的音频，不公开签名地址且计量实际字节', async () => {
    const { Writable } = await import('node:stream');
    const bytes = Buffer.from('abcdefghij'), chunks = [];
    const storage = {
      enabled: true, builtInKey: name => `builtin/${name}`,
      head: vi.fn().mockResolvedValue({ res: { headers: { 'content-length': '10' } } }),
      getStream: vi.fn().mockImplementation(async (key, options) => {
        const match = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
        return { stream: Readable.from([bytes.subarray(Number(match[1]), Number(match[2]) + 1)]) };
      }),
    };
    const usage = { audioRate: vi.fn(), reserveAudio: vi.fn() };
    const audio = createStoryAudio({ storage, identity: {}, usage, database: db, env: {} });
    const res = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
    res.writeHead = vi.fn();
    await audio.handle({ method: 'GET', headers: { range: 'bytes=2-5' } }, res, new URL(`http://local/api/stories/builtin/${[...builtinAudioNames][0]}`));
    expect(Buffer.concat(chunks).toString()).toBe('cdef');
    expect(res.writeHead).toHaveBeenCalledWith(206, expect.objectContaining({ 'Content-Range': 'bytes 2-5/10', 'Content-Length': 4, 'Cache-Control': 'private, no-store' }));
    expect(res.writeHead.mock.calls[0][1].Location).toBeUndefined();
    expect(usage.reserveAudio.mock.calls.map(args => args.slice(1))).toEqual([[0], [4, 0]]);
  });
});

describe('入口容量保护', () => {
  it('在途请求达到上限时拒绝新请求，完成后恢复容量', async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const middleware = createEdgeSecurity({ rate: vi.fn() }, { API_MAX_CONCURRENCY: '1' });
    const req = () => ({ url: '/api/auth/me', method: 'GET', headers: {}, socket: { remoteAddress: '198.51.100.10' } });
    const res = () => ({ setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() });
    const next = vi.fn(() => pending), first = middleware(req(), res(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    const rejected = res(); await middleware(req(), rejected, vi.fn());
    expect(rejected.writeHead.mock.calls[0][0]).toBe(429);
    finish(); await first;
    const last = vi.fn(); await middleware(req(), res(), last); expect(last).toHaveBeenCalledTimes(1);
  });
  it('非法URL返回400，不造成未处理异常', async () => {
    const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };
    await createEdgeSecurity({ rate: vi.fn() })({ url: 'http://[', headers: {}, socket: {} }, res, vi.fn());
    expect(res.writeHead.mock.calls[0][0]).toBe(400);
  });
});

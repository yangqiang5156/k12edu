import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createLocalServices } from './local-services.mjs';

async function call(middleware, url, body, token) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, { url, method: body === undefined ? 'GET' : 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {})
  } });
  const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn() });
  await middleware(req, res, vi.fn());
  return { status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls[0]?.[0] };
}

describe('本地测试服务会话与语音', () => {
  it('不连接云数据库即可建立访客会话并调用受保护的语音接口', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ output: { audio: { url: 'https://audio.oss-cn-beijing.aliyuncs.com/test.wav' } } })))
      .mockResolvedValueOnce(new Response('wave'));
    const middleware = createLocalServices({ SESSION_SECRET: 'local-test-secret', DATABASE_URL: 'postgres://invalid', DATABASE_REQUIRED: 'true', QWEN_API_KEY: 'test', QWEN_WORKSPACE_ID: 'test' }, request);
    const session = await call(middleware, '/api/session/guest', { deviceId: 'test-local-device-1234' });
    expect(session.status).toBe(200);
    const { token } = JSON.parse(session.body);
    expect(token).toBeTruthy();
    const me = await call(middleware, '/api/auth/me', undefined, token);
    expect(me.status).toBe(200);
    expect(JSON.parse(me.body).authenticated).toBe(false);
    const audio = await call(middleware, '/api/tts', { text: '科学问题，小小天气员。', language: 'zh' }, token);
    expect(audio.status).toBe(200);
    expect(audio.body.toString()).toBe('wave');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('没有有效会话时拒绝语音请求', async () => {
    const request = vi.fn();
    const middleware = createLocalServices({ SESSION_SECRET: 'local-test-secret' }, request);
    expect((await call(middleware, '/api/tts', { text: '科学问题', language: 'zh' })).status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
});

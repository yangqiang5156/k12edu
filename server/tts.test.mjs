import { describe, it, expect, vi } from 'vitest';
import { synthesize, createTtsMiddleware } from './tts.mjs';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
const json = (data) => new Response(JSON.stringify(data));

describe('三家在线语音协议', () => {
  it('千问使用工作空间接口并下载音频，密钥不随下载发送', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ output: { audio: { url: 'https://audio.oss-cn-beijing.aliyuncs.com/test.wav' } } })).mockResolvedValueOnce(new Response('wave'));
    const result = await synthesize('一百零五。One Hundred and Five.', 'auto', { QWEN_API_KEY: 'secret', QWEN_WORKSPACE_ID: 'llm-test' }, request);
    expect(request.mock.calls[0][0]).toContain('llm-test.cn-beijing.maas.aliyuncs.com');
    expect(JSON.parse(request.mock.calls[0][1].body).model).toBe('qwen-audio-3.0-tts-flash');
    expect(request.mock.calls[1][1].headers).toBeUndefined();
    expect(result.type).toBe('audio/wav');
    expect(result.bytes.toString()).toBe('wave');
  });
  it('千问临时音频下载遇到连接重置时自动重试', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(json({ output: { audio: { url: 'https://audio.oss-cn-beijing.aliyuncs.com/test.wav' } } }))
      .mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce(new Response('wave'));
    const result = await synthesize('你好', 'zh', { QWEN_API_KEY: 'secret', QWEN_WORKSPACE_ID: 'llm-test' }, request);
    expect(request).toHaveBeenCalledTimes(3);
    expect(result.bytes.toString()).toBe('wave');
  });
  it('MiniMax 检查业务状态并解码十六进制音频', async () => {
    const request = vi.fn().mockResolvedValue(json({ base_resp: { status_code: 0 }, data: { audio: '494433' } }));
    expect((await synthesize('hello', 'en', { TTS_PROVIDER: 'minimax', MINIMAX_API_KEY: 'secret' }, request)).bytes.toString()).toBe('ID3');
    request.mockResolvedValue(json({ base_resp: { status_code: 1008 }, data: { audio: '494433' } }));
    await expect(synthesize('hello', 'en', { TTS_PROVIDER: 'minimax', MINIMAX_API_KEY: 'secret' }, request)).rejects.toThrow('MiniMax');
  });
  it('豆包解析 SSE、校验完成状态并支持旧版鉴权', async () => {
    const request = vi.fn().mockResolvedValue(new Response('event: message\ndata: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n'));
    const env = { TTS_PROVIDER: 'doubao', DOUBAO_APP_ID: 'app', DOUBAO_ACCESS_KEY: 'secret' };
    expect((await synthesize('你好', 'zh', env, request)).bytes.toString()).toBe('ID3');
    expect(request.mock.calls[0][1].headers['X-Api-App-Id']).toBe('app');
    request.mockResolvedValue(new Response('data: {"code":0,"data":"SUQz"}\n'));
    await expect(synthesize('你好', 'zh', env, request)).rejects.toThrow('未完成');
  });
  it('缺少配置时不访问外网', async () => {
    const request = vi.fn();
    await expect(synthesize('你好', 'auto', {}, request)).rejects.toThrow('QWEN_API_KEY');
    expect(request).not.toHaveBeenCalled();
  });
  it('拒绝空文本和未知语言', async () => {
    const request = vi.fn();
    for (const body of [{ text: '' }, { text: '你好', language: 'bad' }, null]) {
      const req = Readable.from([JSON.stringify(body)]);
      Object.assign(req, { url: '/api/tts', method: 'POST', headers: { 'content-type': 'application/json' } });
      const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn() });
      await createTtsMiddleware({}, request)(req, res, vi.fn());
      expect(res.writeHead.mock.calls[0][0]).toBe(400);
    }
    expect(request).not.toHaveBeenCalled();
  });
});

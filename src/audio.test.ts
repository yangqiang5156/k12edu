import { afterEach, describe, expect, it, vi } from 'vitest';
import { speak, speakSequence, stopSpeech } from './audio';

class FakeAudio {
  static last: FakeAudio;
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(async () => {});
  removeAttribute = vi.fn();
  constructor() { FakeAudio.last = this; }
}

class FakeBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  connect = vi.fn();
}

class FakeAudioContext {
  static last: FakeAudioContext;
  currentTime = 10;
  destination = {};
  sources: FakeBufferSource[] = [];
  resume = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => ({ duration: 0.25 }));
  constructor() { FakeAudioContext.last = this; }
  createBufferSource() {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
}
afterEach(() => { stopSpeech(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
}
describe('在线朗读生命周期', () => {
  it('关闭声音时不请求接口', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await speak('你好', false);
    expect(request).not.toHaveBeenCalled();
  });
  it('播放结束后释放音频 URL', async () => {
    setup(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('audio')));
    const job = speak('你好', true);
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalled());
    FakeAudio.last.onended?.();
    await job;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
  it('停止播放会结束等待，避免旧任务悬挂', async () => {
    setup(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('audio')));
    const job = speak('你好', true);
    const settled = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalled());
    stopSpeech();
    await settled;
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it('服务端错误显示可读提示', async () => {
    setup(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '语音服务尚未配置' }), { status: 503 })));
    await expect(speak('你好', true)).rejects.toThrow('语音服务尚未配置');
  });
  it('分段朗读在相邻内容之间至少停顿1秒', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const request = vi.fn().mockImplementation(async () => new Response('audio'));
    vi.stubGlobal('fetch', request);
    const job = speakSequence(['A', 'A'], true, 'en', 50);
    await vi.waitFor(() => expect(FakeAudioContext.last.sources).toHaveLength(2));
    expect(request).toHaveBeenCalledTimes(2);
    expect(FakeAudioContext.last.resume).toHaveBeenCalledOnce();
    expect(FakeAudioContext.last.sources[0].start).toHaveBeenCalledWith(10.05);
    expect(FakeAudioContext.last.sources[1].start).toHaveBeenCalledWith(11.3);
    FakeAudioContext.last.sources[1].onended?.();
    await job;
  });
});

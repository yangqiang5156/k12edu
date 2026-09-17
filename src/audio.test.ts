import { afterEach, describe, expect, it, vi } from 'vitest';
import { speak, speakSequence, stopSpeech } from './audio';

class FakeAudio {
  static last: FakeAudio;
  static instances: FakeAudio[] = [];
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(async () => {});
  removeAttribute = vi.fn();
  constructor() { FakeAudio.last = this; FakeAudio.instances.push(this); }
}
afterEach(() => { stopSpeech(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() {
  FakeAudio.instances = [];
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
  it('分段朗读复用同一播放器，并在相邻内容之间至少停顿1秒', async () => {
    setup();
    vi.useFakeTimers();
    const request = vi.fn().mockImplementation(async () => new Response('audio'));
    vi.stubGlobal('fetch', request);
    const job = speakSequence(['A', 'A'], true, 'en', 50);
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(2);
    expect(FakeAudio.instances).toHaveLength(1);

    FakeAudio.last.onended?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeAudio.last.play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeAudio.last.play).toHaveBeenCalledTimes(2);
    FakeAudio.last.onended?.();
    await job;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

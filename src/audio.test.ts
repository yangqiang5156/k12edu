import { afterEach, describe, expect, it, vi } from 'vitest';
import { speak, speakMultilingualSequence, speakSequence, stopSpeech } from './audio';

class FakeAudio {
  static last: FakeAudio;
  static instances: FakeAudio[] = [];
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onpause: (() => void) | null = null;
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
  it('科学四段逐个准备语音，避免触发服务并发限制', async () => {
    setup();
    let active = 0;
    let maxActive = 0;
    const request = vi.fn().mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return new Response('audio');
    });
    vi.stubGlobal('fetch', request);
    const job = speakSequence(['问题', '方法', '结果', '解释'], true, 'zh');
    const settled = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalled());
    expect(request).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(1);
    stopSpeech();
    await settled;
  });
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
  it.each([403, 429])('云语音未启用或额度用完时使用设备自带朗读（%s）', async status => {
    setup();
    class FakeUtterance {
      text: string; lang = ''; rate = 1; onend?: () => void; onerror?: (event: { error: string }) => void;
      constructor(text: string) { this.text = text; }
    }
    const deviceSpeech = { cancel: vi.fn(), speak: vi.fn((utterance: FakeUtterance) => queueMicrotask(() => utterance.onend?.())) };
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', deviceSpeech);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '千问免费语音额度已用完' }), { status })));
    await speak('春眠不觉晓。', true, 'zh');
    expect(deviceSpeech.speak).toHaveBeenCalledTimes(1);
    expect(deviceSpeech.speak.mock.calls[0][0]).toMatchObject({ text: '春眠不觉晓。', lang: 'zh-CN', rate: 0.85 });
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
  it('英汉分段分别请求对应语言的语音', async () => {
    setup();
    vi.useFakeTimers();
    const request = vi.fn().mockImplementation(async () => new Response('audio'));
    vi.stubGlobal('fetch', request);
    const job = speakMultilingualSequence([{ text: 'apple', language: 'en' }, { text: '苹果', language: 'zh' }], true);
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalledTimes(1));
    expect(request.mock.calls.map(call => JSON.parse(call[1].body))).toEqual([
      { text: 'apple', language: 'en' }, { text: '苹果', language: 'zh' }
    ]);
    FakeAudio.last.onended?.();
    await vi.advanceTimersByTimeAsync(1000);
    FakeAudio.last.onended?.();
    await job;
    expect(FakeAudio.instances).toHaveLength(1);
  });
  it('高亮只在实际播放时切换，暂停、段间停顿和取消时清除', async () => {
    setup();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('audio')));
    const change = vi.fn();
    const job = speakSequence(['科学问题', '观察方法'], true, 'zh', 1000, change);
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalledTimes(1));
    expect(change).not.toHaveBeenCalled();
    FakeAudio.last.onplaying?.();
    expect(change).toHaveBeenLastCalledWith(0);
    FakeAudio.last.onpause?.();
    expect(change).toHaveBeenLastCalledWith(null);
    FakeAudio.last.onplaying?.();
    expect(change).toHaveBeenLastCalledWith(0);
    FakeAudio.last.onended?.();
    await vi.advanceTimersByTimeAsync(999);
    expect(change).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(1);
    FakeAudio.last.onplaying?.();
    expect(change).toHaveBeenLastCalledWith(1);
    const settled = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    stopSpeech();
    await settled;
    expect(change).toHaveBeenLastCalledWith(null);
    expect(FakeAudio.last.onplaying).toBeNull();
  });
  it('设备朗读也跟随实际开始高亮，并在结束后清除', async () => {
    setup();
    class FakeUtterance {
      onstart?: () => void; onend?: () => void;
      constructor(public text: string) {}
    }
    let utterance: FakeUtterance | undefined;
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: vi.fn((value: FakeUtterance) => { utterance = value; }) });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: '免费语音额度已用完' }), { status: 429 })));
    const change = vi.fn();
    const job = speakSequence(['科学问题'], true, 'zh', 1000, change);
    await vi.waitFor(() => expect(utterance).toBeDefined());
    expect(change).not.toHaveBeenCalled();
    utterance?.onstart?.();
    expect(change).toHaveBeenLastCalledWith(0);
    utterance?.onend?.();
    await job;
    expect(change).toHaveBeenLastCalledWith(null);
  });
});

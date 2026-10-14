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
  it.each([403, 429])('云语音未启用或限额时保留原因，并要求点击后启动设备朗读（%s）', async status => {
    setup();
    const device = { cancel: vi.fn(), speak: vi.fn() };
    vi.stubGlobal('speechSynthesis', device);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '家庭账号尚未启用在线生成' }), { status })));
    await expect(speak('春眠不觉晓。', true, 'zh')).rejects.toThrow('家庭账号尚未启用在线生成');
    expect(device.speak).not.toHaveBeenCalled();
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
    const job = speakSequence(['科学问题'], true, 'zh', 1000, change, true);
    await vi.waitFor(() => expect(utterance).toBeDefined());
    expect(change).not.toHaveBeenCalled();
    utterance?.onstart?.();
    expect(change).toHaveBeenLastCalledWith(0);
    utterance?.onend?.();
    await job;
    expect(change).toHaveBeenLastCalledWith(null);
  });
  it('设备朗读没有事件时提示系统设置问题，不虚报成功', async () => {
    setup(); vi.useFakeTimers();
    class FakeUtterance { constructor(public text: string) {} }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    const device = { cancel: vi.fn(), speak: vi.fn() };
    vi.stubGlobal('speechSynthesis', device);
    const job = speak('设备无事件', true, 'zh', undefined, true);
    const rejected = expect(job).rejects.toThrow('静音开关');
    expect(device.speak).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8000); await rejected;
  });
  it('接口不响应时超时并取消请求，按钮不会无限等待', async () => {
    setup(); vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
    const job = speak('你好', true);
    const rejected = expect(job).rejects.toThrow('准备超时');
    await vi.advanceTimersByTimeAsync(50000);
    await rejected;
    expect(signal?.aborted).toBe(true);
  });
  it('网络等待期间取消也立即完成，不依赖请求返回', async () => {
    setup(); vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const job = speak('你好', true);
    const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    stopSpeech(); await rejected;
  });
  it('音频未开始播放时超时释放资源', async () => {
    setup(); vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('audio')));
    const job = speak('你好', true);
    const rejected = expect(job).rejects.toThrow('再点一次播放在线语音');
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(8000); await rejected;
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(FakeAudio.last.onplaying).toBeNull();
  });
  it('单段和双语朗读都能报告实际开始状态', async () => {
    setup(); vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('audio')));
    const change = vi.fn();
    const first = speak('你好', true, 'zh', change);
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalled());
    FakeAudio.last.onplaying?.(); expect(change).toHaveBeenLastCalledWith(0);
    FakeAudio.last.onended?.(); await first;
    const second = speakMultilingualSequence([{ text: 'apple', language: 'en' }, { text: '苹果', language: 'zh' }], true, 1000, change);
    await vi.waitFor(() => expect(FakeAudio.last.play).toHaveBeenCalled());
    FakeAudio.last.onplaying?.(); expect(change).toHaveBeenLastCalledWith(0);
    FakeAudio.last.onended?.(); await vi.advanceTimersByTimeAsync(1000);
    FakeAudio.last.onplaying?.(); expect(change).toHaveBeenLastCalledWith(1);
    FakeAudio.last.onended?.(); await second;
  });

  it('iOS 拒绝异步播放时保留在线音频，再次点击同步播放且不重复生成', async () => {
    setup();
    const request = vi.fn().mockResolvedValue(new Response('audio'));
    vi.stubGlobal('fetch', request);
    const first = speak('在线重试测试', true, 'zh');
    const rejected = expect(first).rejects.toThrow('再点一次播放在线语音');
    FakeAudio.last.play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    await rejected;
    const second = speak('在线重试测试', true, 'zh');
    expect(FakeAudio.last.play).toHaveBeenCalledOnce(); // 再次点击同步到达 play。
    expect(request).toHaveBeenCalledOnce();
    FakeAudio.last.onplaying?.(); FakeAudio.last.onended?.(); await second;
  });

  it('设备朗读同步选择语言声音并恢复暂停的语音引擎', async () => {
    setup();
    class FakeUtterance { onstart?: () => void; onend?: () => void; constructor(public text: string) {} }
    const english = { lang: 'en-US', name: 'English' };
    const chinese = { lang: 'zh-CN', name: '中文' };
    const device = { paused: true, cancel: vi.fn(), resume: vi.fn(), getVoices: vi.fn(() => [english, chinese]), speak: vi.fn() };
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance); vi.stubGlobal('speechSynthesis', device);
    const job = speak('apple', true, 'auto', undefined, true);
    expect(device.speak).toHaveBeenCalledOnce();
    expect(device.resume).toHaveBeenCalledOnce();
    const utterance = device.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance).toMatchObject({ lang: 'en-US', voice: english });
    utterance.onstart?.(); utterance.onend?.(); await job;
  });
  it('只收到设备结束事件但没有开始事件时不显示朗读成功', async () => {
    setup();
    class FakeUtterance { onend?: () => void; constructor(public text: string) {} }
    const device = { cancel: vi.fn(), speak: vi.fn() };
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance); vi.stubGlobal('speechSynthesis', device);
    const job = speak('未开始朗读', true, 'zh', undefined, true);
    const rejected = expect(job).rejects.toThrow('设备朗读未能启动');
    (device.speak.mock.calls[0][0] as FakeUtterance).onend?.(); await rejected;
  });
  it('支持音频会话的 iOS 使用媒体播放模式，声音错误保留可操作提示', async () => {
    setup();
    const audioSession = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession });
    class FakeUtterance { onerror?: (event: { error: string }) => void; constructor(public text: string) {} }
    const device = { cancel: vi.fn(), speak: vi.fn() };
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance); vi.stubGlobal('speechSynthesis', device);
    const job = speak('声音测试', true, 'zh', undefined, true);
    const rejected = expect(job).rejects.toThrow('下载中文或英文声音');
    expect(audioSession.type).toBe('playback');
    (device.speak.mock.calls[0][0] as FakeUtterance).onerror?.({ error: 'voice-unavailable' }); await rejected;
  });

});

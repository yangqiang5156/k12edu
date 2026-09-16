let context: AudioContext | undefined;
export function playClick(enabled: boolean): void {
  if (!enabled) return;
  context ??= new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(520, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(760, context.currentTime + 0.07);
  gain.gain.setValueAtTime(0.06, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.09);
}

let cancelCurrent: (() => void) | undefined;

export function stopSpeech(): void {
  cancelCurrent?.();
  cancelCurrent = undefined;
}

async function runSpeech(segments: string[], enabled: boolean, language: string, pauseMs: number): Promise<void> {
  stopSpeech();
  const parts = segments.map((part) => part.trim()).filter(Boolean);
  if (!enabled || !parts.length) return;
  const controller = new AbortController();
  let activeAudio: HTMLAudioElement | undefined;
  let rejectPlayback: ((reason: unknown) => void) | undefined;
  let rejectPause: ((reason: unknown) => void) | undefined;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const abortError = () => new DOMException('朗读已取消', 'AbortError');
  const cancel = () => {
    controller.abort();
    activeAudio?.pause();
    rejectPlayback?.(abortError());
    rejectPause?.(abortError());
    if (pauseTimer !== undefined) globalThis.clearTimeout(pauseTimer);
  };
  cancelCurrent = cancel;
  try {
    for (const [index, text] of parts.entries()) {
      controller.signal.throwIfAborted();
      const response = await fetch(`${import.meta.env.BASE_URL}api/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }), signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '语音服务暂时不可用，请稍后再试');
      }
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const audio = new Audio();
      activeAudio = audio;
      audio.src = url;
      try {
        await new Promise<void>((resolve, reject) => {
          rejectPlayback = reject;
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('音频播放失败，请重试'));
          audio.play().catch(reject);
        });
      } finally {
        rejectPlayback = undefined;
        audio.pause();
        audio.onended = null;
        audio.onerror = null;
        audio.removeAttribute('src');
        URL.revokeObjectURL(url);
        if (activeAudio === audio) activeAudio = undefined;
      }
      if (index < parts.length - 1) await new Promise<void>((resolve, reject) => {
        rejectPause = reject;
        pauseTimer = globalThis.setTimeout(() => {
          pauseTimer = undefined;
          rejectPause = undefined;
          resolve();
        }, Math.max(1000, pauseMs));
      });
    }
  } finally {
    if (pauseTimer !== undefined) globalThis.clearTimeout(pauseTimer);
    if (cancelCurrent === cancel) cancelCurrent = undefined;
  }
}

export async function speak(text: string, enabled: boolean, language = 'auto'): Promise<void> {
  return runSpeech([text], enabled, language, 0);
}

let sequenceContext: AudioContext | undefined;

export async function speakSequence(segments: string[], enabled: boolean, language = 'auto', pauseMs = 1000): Promise<void> {
  stopSpeech();
  const parts = segments.map((part) => part.trim()).filter(Boolean);
  if (!enabled || !parts.length) return;

  // iOS 会拦截第二、第三个 HTMLAudioElement 的延迟 play()。
  // 在点击处理期间立即解锁一个 AudioContext，后续把所有分段排到
  // 同一条时间轴，避免每一段都重新申请自动播放权限。
  sequenceContext ??= new AudioContext();
  const audioContext = sequenceContext;
  const resume = audioContext.resume();
  const controller = new AbortController();
  const sources: AudioBufferSourceNode[] = [];
  let rejectPlayback: ((reason: unknown) => void) | undefined;
  const abortError = () => new DOMException('朗读已取消', 'AbortError');
  const cancel = () => {
    controller.abort();
    for (const source of sources) {
      try { source.stop(); } catch { /* 音源可能已自然结束。 */ }
    }
    rejectPlayback?.(abortError());
  };
  cancelCurrent = cancel;

  try {
    const buffers = await Promise.all(parts.map(async (text) => {
      const response = await fetch(`${import.meta.env.BASE_URL}api/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }), signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '语音服务暂时不可用，请稍后再试');
      }
      return audioContext.decodeAudioData(await response.arrayBuffer());
    }));
    controller.signal.throwIfAborted();
    await resume;

    let startAt = audioContext.currentTime + 0.05;
    const gapSeconds = Math.max(1000, pauseMs) / 1000;
    for (const [index, buffer] of buffers.entries()) {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(startAt);
      sources.push(source);
      startAt += buffer.duration + (index < buffers.length - 1 ? gapSeconds : 0);
    }
    await new Promise<void>((resolve, reject) => {
      rejectPlayback = reject;
      sources.at(-1)!.onended = () => resolve();
    });
  } finally {
    rejectPlayback = undefined;
    for (const source of sources) source.onended = null;
    if (cancelCurrent === cancel) cancelCurrent = undefined;
  }
}

export function speechError(error: unknown): string {
  if (!navigator.onLine) return '朗读需要联网，请检查网络连接';
  return error instanceof Error ? error.message : '朗读失败，请稍后重试';
}

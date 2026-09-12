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

export async function speak(text: string, enabled: boolean, language = 'auto'): Promise<void> {
  stopSpeech();
  if (!enabled || !text.trim()) return;
  const controller = new AbortController();
  const audio = new Audio();
  let url: string | undefined;
  let rejectPlayback: ((reason: unknown) => void) | undefined;
  const cancel = () => {
    controller.abort();
    audio.pause();
    rejectPlayback?.(new DOMException('朗读已取消', 'AbortError'));
  };
  cancelCurrent = cancel;
  try {
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
    url = URL.createObjectURL(blob);
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      rejectPlayback = reject;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('音频播放失败，请重试'));
      audio.play().catch(reject);
    });
  } finally {
    audio.pause();
    audio.onended = null;
    audio.onerror = null;
    audio.removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
    if (cancelCurrent === cancel) cancelCurrent = undefined;
  }
}

export function speechError(error: unknown): string {
  if (!navigator.onLine) return '朗读需要联网，请检查网络连接';
  return error instanceof Error ? error.message : '朗读失败，请稍后重试';
}

import { authorizedFetch } from './cloud';

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

class SpeechQuotaError extends Error {}

async function audioCacheKey(text: string, language: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ version: 1, text, language })));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function speechBlob(text: string, language: string, signal: AbortSignal): Promise<Blob> {
  const supportsCache = typeof caches !== 'undefined' && typeof location !== 'undefined';
  const key = supportsCache ? await audioCacheKey(text, language) : '';
  const request = supportsCache ? new Request(`${location.origin}${import.meta.env.BASE_URL}__audio-cache/${key}`) : undefined;
  if (request) {
    const cached = await (await caches.open('lexue-tts-v1')).match(request);
    if (cached) return cached.blob();
  }
  const response = await authorizedFetch(`${import.meta.env.BASE_URL}api/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }), signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 429 && /额度|免费语音/.test(error.error || '')) throw new SpeechQuotaError(error.error);
    throw new Error(error.error || '语音服务暂时不可用，请稍后再试');
  }
  const blob = await response.blob();
  if (request) {
    const cache = await caches.open('lexue-tts-v1');
    await cache.put(request, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } })).catch(() => undefined);
  }
  return blob;
}

export function stopSpeech(): void {
  cancelCurrent?.();
  cancelCurrent = undefined;
}

export interface SpeechSegment { text: string; language: 'auto' | 'zh' | 'en' }

async function runSpeech(segments: SpeechSegment[], enabled: boolean, pauseMs: number): Promise<void> {
  stopSpeech();
  const parts = segments.map((part) => ({ ...part, text: part.text.trim() })).filter(part => Boolean(part.text));
  if (!enabled || !parts.length) return;
  const controller = new AbortController();
  // iOS 会把每个新的 Audio 元素视为一次新的播放请求。整次朗读只创建
  // 一个播放器并反复更换音源，既保留媒体播放通道，也避免第二段被拦截。
  const activeAudio = new Audio();
  const objectUrls: string[] = [];
  let rejectPlayback: ((reason: unknown) => void) | undefined;
  let rejectPause: ((reason: unknown) => void) | undefined;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const abortError = () => new DOMException('朗读已取消', 'AbortError');
  const cancel = () => {
    controller.abort();
    activeAudio?.pause();
    globalThis.speechSynthesis?.cancel();
    rejectPlayback?.(abortError());
    rejectPause?.(abortError());
    if (pauseTimer !== undefined) globalThis.clearTimeout(pauseTimer);
  };
  cancelCurrent = cancel;
  try {
    let urls: string[];
    try {
      urls = await Promise.all(parts.map(async ({ text, language }) => {
        const blob = await speechBlob(text, language, controller.signal);
        controller.signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return url;
      }));
    } catch (error) {
      if (!(error instanceof SpeechQuotaError) || !globalThis.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') throw error;
      for (const [index, { text, language }] of parts.entries()) {
        controller.signal.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = language === 'en' ? 'en-US' : 'zh-CN'; utterance.rate = 0.85;
          utterance.onend = () => resolve(); utterance.onerror = event => reject(new Error(event.error === 'canceled' ? '朗读已取消' : '设备朗读失败'));
          controller.signal.addEventListener('abort', () => { globalThis.speechSynthesis.cancel(); reject(abortError()); }, { once: true });
          globalThis.speechSynthesis.speak(utterance);
        });
        if (index < parts.length - 1) await new Promise<void>((resolve, reject) => {
          rejectPause = reject;
          pauseTimer = globalThis.setTimeout(() => { pauseTimer = undefined; rejectPause = undefined; resolve(); }, Math.max(1000, pauseMs));
        });
      }
      return;
    }

    for (const [index, url] of urls.entries()) {
      controller.signal.throwIfAborted();
      activeAudio.src = url;
      try {
        await new Promise<void>((resolve, reject) => {
          rejectPlayback = reject;
          activeAudio.onended = () => resolve();
          activeAudio.onerror = () => reject(new Error('音频播放失败，请重试'));
          activeAudio.play().catch(reject);
        });
      } finally {
        rejectPlayback = undefined;
        activeAudio.pause();
        activeAudio.onended = null;
        activeAudio.onerror = null;
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
    activeAudio.pause();
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.removeAttribute('src');
    for (const url of objectUrls) URL.revokeObjectURL(url);
    if (cancelCurrent === cancel) cancelCurrent = undefined;
  }
}

export async function speak(text: string, enabled: boolean, language: SpeechSegment['language'] = 'auto'): Promise<void> {
  return runSpeech([{ text, language }], enabled, 0);
}

export async function speakSequence(segments: string[], enabled: boolean, language: SpeechSegment['language'] = 'auto', pauseMs = 1000): Promise<void> {
  return runSpeech(segments.map(text => ({ text, language })), enabled, pauseMs);
}

export async function speakMultilingualSequence(segments: SpeechSegment[], enabled: boolean, pauseMs = 1000): Promise<void> {
  return runSpeech(segments, enabled, pauseMs);
}

export function speechError(error: unknown): string {
  if (!navigator.onLine) return '朗读需要联网，请检查网络连接';
  return error instanceof Error ? error.message : '朗读失败，请稍后重试';
}

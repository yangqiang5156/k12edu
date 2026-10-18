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
export class DeviceSpeechRequiredError extends Error {
  constructor(reason = '在线朗读暂不可用') { super(`${reason}；请点“使用设备朗读”`); }
}

export class OnlinePlaybackRequiredError extends Error {
  constructor() { super('在线语音已准备好，请再点一次播放在线语音'); }
}
let preparedOnline: { key: string; blobs: Blob[]; expires: number } | undefined;

function prepareAudioSession() {
  // 新版 Safari 可显式使用媒体播放会话；旧浏览器不支持时保持默认行为。
  if (typeof navigator === 'undefined') return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  try { if (session) session.type = 'playback'; } catch { /* 系统可能不允许修改会话。 */ }
}

function deviceSpeechError(code?: string) {
  if (code === 'language-unavailable' || code === 'voice-unavailable') return new Error('设备缺少此语言的朗读声音，请在 iPhone 设置 → 辅助功能 → 朗读内容 → 声音中下载中文或英文声音');
  if (code === 'not-allowed') return new Error('设备朗读被系统阻止，请用 Safari 打开并点击朗读；也请检查静音开关与媒体音量');
  return new Error('设备朗读未能启动，请检查静音开关、媒体音量及系统朗读声音，或改用在线朗读');
}

// 网络请求、缓存和浏览器播放事件都可能不返回；取消必须立即结束等待。
function bounded<T>(work: Promise<T>, signal: AbortSignal, milliseconds: number, error: Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(signal.reason ?? new DOMException('朗读已取消', 'AbortError')));
    const timer = setTimeout(() => finish(() => reject(error)), milliseconds);
    const finish = (settle: () => void) => { clearTimeout(timer); signal.removeEventListener('abort', abort); settle(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    work.then(value => finish(() => resolve(value)), reason => finish(() => reject(reason)));
  });
}

async function audioCacheKey(text: string, language: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ version: 1, text, language })));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function speechBlob(text: string, language: string, signal: AbortSignal): Promise<Blob> {
  const supportsCache = typeof caches !== 'undefined' && typeof location !== 'undefined';
  const key = supportsCache ? await audioCacheKey(text, language) : '';
  const request = supportsCache ? new Request(new URL(`${import.meta.env.BASE_URL}__audio-cache/${key}`, location.href)) : undefined;
  if (request) {
    try {
      const cached = await (await caches.open('lexue-tts-v1')).match(request);
      if (cached) return cached.blob();
    } catch { /* 隐私模式下缓存不可用，仍可请求在线朗读。 */ }
  }
  const response = await authorizedFetch(`${import.meta.env.BASE_URL}api/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }), signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 403 || response.status === 429) throw new SpeechQuotaError(error.error);
    throw new Error(error.error || '语音服务暂时不可用，请稍后再试');
  }
  const blob = await response.blob();
  if (request) {
    void caches.open('lexue-tts-v1').then(cache => cache.put(request, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } }))).catch(() => undefined);
  }
  return blob;
}

export function stopSpeech(): void {
  preparedOnline = undefined;
  cancelCurrent?.();
  cancelCurrent = undefined;
}

export interface SpeechSegment { text: string; language: 'auto' | 'zh' | 'en' }

export type SpeechSegmentChange = (index: number | null) => void;

async function runSpeech(segments: SpeechSegment[], enabled: boolean, pauseMs: number, onSegmentChange?: SpeechSegmentChange, deviceOnly = false): Promise<void> {
  const retryPrepared = preparedOnline;
  stopSpeech();
  const parts = segments.map((part) => ({ ...part, text: part.text.trim() })).filter(part => Boolean(part.text));
  if (!enabled || !parts.length) return;
  prepareAudioSession();
  const key = JSON.stringify(parts);
  const prepared = !deviceOnly && retryPrepared?.key === key && retryPrepared.expires > Date.now() ? retryPrepared.blobs : undefined;
  preparedOnline = undefined;
  const blobs: Blob[] = [];
  const controller = new AbortController();
  // iOS 会把每个新的 Audio 元素视为一次新的播放请求。整次朗读只创建
  // 一个播放器并反复更换音源，既保留媒体播放通道，也避免第二段被拦截。
  const activeAudio = new Audio();
  const objectUrls: string[] = [];
  let rejectPlayback: ((reason: unknown) => void) | undefined;
  let playbackStartTimer: ReturnType<typeof setTimeout> | undefined;
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
      if (deviceOnly) throw new SpeechQuotaError();
      urls = [];
      // 分段逐个准备，避免科学四段同时请求超过语音服务的并发上限。
      for (const { text, language } of parts) {
        controller.signal.throwIfAborted();
        const blob = prepared ? prepared[blobs.length] : await bounded(speechBlob(text, language, controller.signal), controller.signal, 50000, new Error('在线语音准备超时，请检查网络后重试'));
        blobs.push(blob);
        controller.signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        urls.push(url);
      }
    } catch (error) {
      if (!(error instanceof SpeechQuotaError)) throw error;
      // 付费权限不足时，下一次点击同步启动设备朗读，避免丢失 iOS 用户操作。
      if (!deviceOnly) throw new DeviceSpeechRequiredError(error.message || '在线生成尚未开通或额度已用完');
      if (!globalThis.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('此浏览器不支持设备朗读，请换用系统浏览器');
      const synthesis = globalThis.speechSynthesis;
      synthesis.cancel();
      if (synthesis.paused) synthesis.resume();
      for (const [index, { text, language }] of parts.entries()) {
        controller.signal.throwIfAborted();
        const utterance = new SpeechSynthesisUtterance(text);
        try {
          await new Promise<void>((resolve, reject) => {
            let started = false;
            let timer: ReturnType<typeof setTimeout>;
            const finish = (error?: Error) => {
              clearTimeout(timer);
              controller.signal.removeEventListener('abort', abort);
              utterance.onstart = utterance.onend = utterance.onerror = null;
              error ? reject(error) : resolve();
            };
            const abort = () => finish(abortError());
            timer = setTimeout(() => finish(deviceSpeechError()), 8000);
            const english = language === 'en' || (language === 'auto' && /[a-z]/i.test(text) && !/[\u4e00-\u9fff]/.test(text));
            utterance.lang = english ? 'en-US' : 'zh-CN'; utterance.rate = 0.85; utterance.volume = 1;
            const voices = synthesis.getVoices?.() ?? [];
            const voice = voices.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase())
              ?? voices.find(voice => voice.lang.toLowerCase().startsWith(english ? 'en' : 'zh'));
            if (voice) utterance.voice = voice;
            utterance.onstart = () => {
              started = true;
              clearTimeout(timer);
              timer = setTimeout(() => finish(new Error('设备朗读中断，请重试')), Math.max(30000, text.length * 1000));
              if (!controller.signal.aborted) onSegmentChange?.(index);
            };
            utterance.onend = () => finish(started ? undefined : deviceSpeechError());
            utterance.onerror = event => finish(deviceSpeechError(event.error));
            controller.signal.addEventListener('abort', abort, { once: true });
            try {
              // deviceOnly 从点击处理函数同步到达此处，保留浏览器要求的用户操作。
              synthesis.speak(utterance);
            } catch { finish(deviceSpeechError()); }
          });
        } catch (error) {
          if (cancelCurrent === cancel) globalThis.speechSynthesis.cancel();
          throw error;
        }
        onSegmentChange?.(null);
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
        await bounded(new Promise<void>((resolve, reject) => {
          rejectPlayback = reject;
          playbackStartTimer = setTimeout(() => reject(new OnlinePlaybackRequiredError()), 8000);
          activeAudio.onplaying = () => {
            clearTimeout(playbackStartTimer);
            if (!controller.signal.aborted) onSegmentChange?.(index);
          };
          activeAudio.onpause = () => onSegmentChange?.(null);
          activeAudio.onended = () => resolve();
          activeAudio.onerror = () => reject(new Error('音频播放失败，请重试'));
          activeAudio.play().catch(error => reject(error?.name === 'NotAllowedError' ? new OnlinePlaybackRequiredError() : error));
        }), controller.signal, Math.max(30000, parts[index].text.length * 1000), new Error('在线音频播放中断，请重试'));
      } catch (error) {
        if (error instanceof OnlinePlaybackRequiredError && blobs.reduce((bytes, blob) => bytes + blob.size, 0) <= 25 * 1024 * 1024) {
          preparedOnline = { key, blobs, expires: Date.now() + 120000 };
        }
        throw error;
      } finally {
        clearTimeout(playbackStartTimer);
        rejectPlayback = undefined;
        activeAudio.pause();
        activeAudio.onended = null;
        activeAudio.onerror = null;
        activeAudio.onplaying = null;
        activeAudio.onpause = null;
        onSegmentChange?.(null);
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
    controller.abort();
    clearTimeout(playbackStartTimer);
    if (pauseTimer !== undefined) globalThis.clearTimeout(pauseTimer);
    activeAudio.pause();
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.onplaying = null;
    activeAudio.onpause = null;
    onSegmentChange?.(null);
    activeAudio.removeAttribute('src');
    for (const url of objectUrls) URL.revokeObjectURL(url);
    if (cancelCurrent === cancel) cancelCurrent = undefined;
  }
}

export async function speak(text: string, enabled: boolean, language: SpeechSegment['language'] = 'auto', onSegmentChange?: SpeechSegmentChange, deviceOnly = false): Promise<void> {
  return runSpeech([{ text, language }], enabled, 0, onSegmentChange, deviceOnly);
}

export async function speakSequence(segments: string[], enabled: boolean, language: SpeechSegment['language'] = 'auto', pauseMs = 1000, onSegmentChange?: SpeechSegmentChange, deviceOnly = false): Promise<void> {
  return runSpeech(segments.map(text => ({ text, language })), enabled, pauseMs, onSegmentChange, deviceOnly);
}

export async function speakMultilingualSequence(segments: SpeechSegment[], enabled: boolean, pauseMs = 1000, onSegmentChange?: SpeechSegmentChange, deviceOnly = false): Promise<void> {
  return runSpeech(segments, enabled, pauseMs, onSegmentChange, deviceOnly);
}

export function speechError(error: unknown): string {
  if (!navigator.onLine) return '朗读需要联网，请检查网络连接';
  return error instanceof Error ? error.message : '朗读失败，请稍后重试';
}

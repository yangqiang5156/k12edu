let context: AudioContext | undefined;
let numberAudio: HTMLAudioElement | undefined;
let numberAudioJob = 0;
let lessonAudio: HTMLAudioElement | undefined;
let lessonAudioJob = 0;

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

export function speak(text: string, enabled: boolean, lang = 'zh-CN'): void {
  if (!enabled || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.78;
  utterance.pitch = 1.15;
  speechSynthesis.speak(utterance);
}

export async function playOfflineNumberTokens(tokens: string[], enabled: boolean): Promise<void> {
  if (!enabled || !tokens.length) return;
  const job = ++numberAudioJob;
  numberAudio ??= new Audio();
  numberAudio.preload = 'auto';
  numberAudio.pause();

  for (let index = 0; index < tokens.length; index += 1) {
    if (job !== numberAudioJob) return;
    const token = tokens[index];
    numberAudio.src = `${import.meta.env.BASE_URL}audio/numbers/${token}.mp3`;
    numberAudio.currentTime = 0;
    await new Promise<void>((resolve, reject) => {
      const finish = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error(`无法播放离线语音：${token}`)); };
      const cleanup = () => {
        numberAudio?.removeEventListener('ended', finish);
        numberAudio?.removeEventListener('error', fail);
      };
      numberAudio?.addEventListener('ended', finish, { once: true });
      numberAudio?.addEventListener('error', fail, { once: true });
      numberAudio?.play().catch(fail);
    });
    if (index < tokens.length - 1) await new Promise((resolve) => window.setTimeout(resolve, token.startsWith('zh_') && tokens[index + 1]?.startsWith('en_') ? 180 : 25));
  }
}

export function stopOfflineNumberAudio(): void {
  numberAudioJob += 1;
  numberAudio?.pause();
}

export async function playOfflineLessonAudio(relativePath: string, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const job = ++lessonAudioJob;
  lessonAudio ??= new Audio();
  lessonAudio.preload = 'auto';
  lessonAudio.pause();
  lessonAudio.src = `${import.meta.env.BASE_URL}${relativePath}`;
  lessonAudio.currentTime = 0;
  await new Promise<void>((resolve, reject) => {
    const finish = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`无法播放离线语音：${relativePath}`)); };
    const cleanup = () => {
      lessonAudio?.removeEventListener('ended', finish);
      lessonAudio?.removeEventListener('error', fail);
    };
    lessonAudio?.addEventListener('ended', finish, { once: true });
    lessonAudio?.addEventListener('error', fail, { once: true });
    lessonAudio?.play().catch(fail);
  });
  if (job !== lessonAudioJob) return;
}

export function stopOfflineLessonAudio(): void {
  lessonAudioJob += 1;
  lessonAudio?.pause();
}

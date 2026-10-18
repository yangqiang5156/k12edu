import { useEffect, useMemo, useRef, useState } from 'react';
import { speak, stopSpeech, speechError, DeviceSpeechRequiredError } from '../audio';
import { numberSpeechText, numberToChinese, numberToEnglish, type NumberAudioLanguage } from '../logic';

import { SpeechInfo } from './SpeechInfo';

const decorations = ['🐼', '🚗', '🦖', '🚀', '🐳', '🌈', '🦊', '⚽', '🐯', '🎈', '🐙', '🦁'];
const accents = ['#745fd7', '#e97083', '#43a785', '#e59b30', '#4e98cc', '#9a65c7'];

export function NumberLab({ soundEnabled, authenticated }: { soundEnabled: boolean; authenticated: boolean }) {
  const readJob = useRef(0);
  const [number, setNumber] = useState(0);
  const [deviceRead, setDeviceRead] = useState(false);
  const useDeviceRead = !authenticated || deviceRead;
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState('点数字听中英文朗读');
  const [celebration, setCelebration] = useState(0);
  const chinese = useMemo(() => numberToChinese(number), [number]);
  const english = useMemo(() => numberToEnglish(number), [number]);

  useEffect(() => () => { readJob.current += 1; stopSpeech(); }, []);

  const read = async (value = number, language: NumberAudioLanguage = 'both') => {
    if (!soundEnabled) {
      setStatus('声音已由家长关闭');
      return;
    }
    const job = ++readJob.current;
    setReading(true);
    setStatus(language === 'zh' ? '正在读中文…' : language === 'en' ? 'Reading in English…' : '正在读中文和英文…');
    try {
      await speak(numberSpeechText(value, language), true, language === 'both' ? 'auto' : language, undefined, useDeviceRead);
      if (job !== readJob.current) return;
      setStatus('读完啦，再点一次可以重听');
    } catch (error) {
      if (job !== readJob.current) return;
      if (error instanceof DeviceSpeechRequiredError) setDeviceRead(true);
      setStatus(speechError(error));
    } finally {
      if (job === readJob.current) setReading(false);
    }
  };

  const selectNumber = (value: number, autoRead = false) => {
    const next = Math.max(0, Math.min(1000, Math.round(value)));
    setNumber(next);
    if (next > 0 && next % 100 === 0) setCelebration((current) => current + 1);
    if (autoRead) void read(next);
    else { readJob.current += 1; stopSpeech(); setReading(false); setStatus('点数字听中英文朗读'); }
  };

  return (
    <div className="number-lab" style={{ '--number-accent': accents[Math.floor(number / 50) % accents.length] } as React.CSSProperties}>
      <div className="number-lab-heading">
        <span className="eyebrow">0–1000 数字探索</span>
        <span className="number-audio-mode"><span className="online-audio-badge">● {useDeviceRead ? '设备朗读' : '在线朗读'}</span>{!authenticated && <SpeechInfo />}</span>
      </div>
      <button className="number-stage" onClick={() => void read()} aria-label={`朗读数字 ${number}`}>
        <span className="number-decoration">{decorations[number % decorations.length]}</span>
        <strong key={number}>{number}</strong>
        <small>点数字听中英文</small>
      </button>
      <div className="number-words">
        <button onClick={() => void read(number, 'zh')}><strong>{chinese}</strong><span>🔊 中文</span></button>
        <button onClick={() => void read(number, 'en')}><strong>{english}</strong><span>🔊 English</span></button>
      </div>
      <div className="number-step-controls">
        <button onClick={() => selectNumber(number - 10, true)}>−10</button>
        <button onClick={() => selectNumber(number - 1, true)}>−1</button>
        <button className={`number-play ${reading ? 'is-reading' : ''}`} onClick={() => void read()} disabled={reading}>🔊</button>
        <button onClick={() => selectNumber(number + 1, true)}>+1</button>
        <button onClick={() => selectNumber(number + 10, true)}>+10</button>
      </div>
      <div className="number-jump-row">
        <label>拖一拖找数字<input type="range" min="0" max="1000" step="1" value={number} onChange={(event) => selectNumber(Number(event.target.value))} /></label>
        <button onClick={() => selectNumber(Math.floor(Math.random() * 1001), true)}>🎲 随机</button>
      </div>
      <div className="number-status" role="status">{status}</div>
      {authenticated && !reading && <button onClick={() => { setDeviceRead(!deviceRead); setStatus('已切换朗读方式，请点数字播放'); }}>{deviceRead ? '切换在线朗读' : '改用设备朗读'}</button>}
      {celebration > 0 && <div className="number-celebration" key={celebration} aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ left: `${5 + index * 8}%`, animationDelay: `${index * 30}ms`, '--star-rise': `${-90 + index % 3 * 45}px` } as React.CSSProperties}>⭐</i>)}</div>}
    </div>
  );
}

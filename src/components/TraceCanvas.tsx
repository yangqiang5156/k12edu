import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { speak, speechError, stopSpeech } from '../audio';

interface Props {
  glyph: string;
  soundEnabled: boolean;
  onDone: () => void;
}

function stepInstruction(glyph: string, step: number): string {
  const latinOrNumber = /^[A-Za-z0-9]$/.test(glyph);
  if (step === 1) return latinOrNumber
    ? `第一步，找到 ${glyph} 的起点，看准方向，沿着浅色线描第一笔。`
    : '第一步，先找最上方或最左边的起点，沿着浅色笔画描第一笔。';
  return `第${step}步，找到还没描过的下一笔，按从上到下、从左到右的顺序，一次只描一笔。`;
}

function knownStrokeCount(glyph: string): number | undefined {
  const counts: Record<string, number> = {
    '0': 1, '1': 1, '2': 1, '3': 1, '4': 2, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1,
    A: 3, B: 2, C: 1, D: 2, E: 4, F: 3, G: 1, H: 3, I: 1, J: 1, K: 3, L: 2, M: 4,
    N: 3, O: 1, P: 2, Q: 2, R: 3, S: 1, T: 2, U: 1, V: 1, W: 1, X: 2, Y: 2, Z: 1,
    a: 1, b: 1, c: 1, d: 1, e: 1, f: 2, g: 1, h: 1, i: 2, j: 2, k: 3, l: 1, m: 1,
    n: 1, o: 1, p: 1, q: 1, r: 1, s: 1, t: 2, u: 1, v: 1, w: 1, x: 2, y: 2, z: 1
  };
  return counts[glyph];
}

export function TraceCanvas({ glyph, soundEnabled, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const beforeStroke = useRef<ImageData | undefined>(undefined);
  const [step, setStep] = useState(1);
  const [stepHasInk, setStepHasInk] = useState(false);
  const [audioStatus, setAudioStatus] = useState('');
  const [audioPlaying, setAudioPlaying] = useState(false);
  const totalSteps = knownStrokeCount(glyph);
  const isLastKnownStep = totalSteps !== undefined && step >= totalSteps;
  const instruction = stepInstruction(glyph, step);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    beforeStroke.current = undefined;
    setStep(1);
    setStepHasInk(false);
    setAudioStatus('');
  };

  useEffect(clear, [glyph]);
  useEffect(() => () => stopSpeech(), []);

  useEffect(() => {
    const canvas = guideCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e7e0ec';
    ctx.font = '800 180px "Noto Sans SC", "Roboto", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(glyph);
    const left = metrics.actualBoundingBoxLeft || 0;
    const right = metrics.actualBoundingBoxRight || metrics.width;
    const ascent = metrics.actualBoundingBoxAscent || 135;
    const descent = metrics.actualBoundingBoxDescent || 35;
    const x = canvas.width / 2 + (left - right) / 2;
    const y = canvas.height / 2 + (ascent - descent) / 2;
    ctx.fillText(glyph, x, y);
  }, [glyph]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (stepHasInk) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const ctx = event.currentTarget.getContext('2d')!;
    beforeStroke.current = ctx.getImageData(0, 0, event.currentTarget.width, event.currentTarget.height);
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#735fd8';
    ctx.stroke();
    setStepHasInk(true);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext('2d')!;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const redoStep = () => {
    const canvas = canvasRef.current;
    const snapshot = beforeStroke.current;
    if (canvas && snapshot) canvas.getContext('2d')?.putImageData(snapshot, 0, 0);
    beforeStroke.current = undefined;
    setStepHasInk(false);
  };

  const nextStep = () => {
    if (!stepHasInk || isLastKnownStep) return;
    beforeStroke.current = undefined;
    setStep((value) => value + 1);
    setStepHasInk(false);
    setAudioStatus('');
  };

  const readInstruction = async () => {
    if (!soundEnabled) return setAudioStatus('声音已由家长关闭');
    setAudioPlaying(true);
    setAudioStatus('正在朗读本步指引…');
    try {
      await speak(instruction, true, 'zh');
      setAudioStatus('请按指引描这一笔');
    } catch (error) {
      setAudioStatus(speechError(error));
    } finally {
      setAudioPlaying(false);
    }
  };

  return (
    <div className="trace-area">
      <div className="trace-instruction" role="status">
        <div><b>第 {step} 笔{totalSteps ? ` / 共 ${totalSteps} 笔` : ''}</b><span>指引一步，描一笔</span></div>
        <p>{instruction}</p>
        <button className="trace-audio-button" disabled={audioPlaying} onClick={() => void readInstruction()}>{audioPlaying ? '🔊 正在朗读…' : '🔊 朗读本步'}</button>
        <small>{audioStatus}</small>
      </div>
      <div className={`trace-board ${stepHasInk ? 'step-finished' : ''}`} aria-label={`第 ${step} 笔：${instruction}`}>
        <canvas className="trace-guide" ref={guideCanvasRef} width="300" height="260" aria-hidden="true" />
        <canvas className="trace-ink" ref={canvasRef} width="300" height="260" onPointerDown={start} onPointerMove={move}
          onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
      </div>
      <p className={`trace-step-status ${stepHasInk ? 'done' : ''}`}>{stepHasInk ? (isLastKnownStep ? '最后一笔描好了，可以完成整字' : '这一笔描好了，可以继续下一笔') : '请只描完当前这一笔'}</p>
      <div className="button-row trace-controls">
        <button className="soft-button" onClick={stepHasInk ? redoStep : clear}>{stepHasInk ? '↻ 重描这一笔' : '↻ 整字重写'}</button>
        <button className="soft-button" disabled={!stepHasInk || isLastKnownStep} onClick={nextStep}>下一笔 →</button>
        <button className="primary-button" disabled={!stepHasInk} onClick={onDone}>整字描好 ✓</button>
      </div>
    </div>
  );
}

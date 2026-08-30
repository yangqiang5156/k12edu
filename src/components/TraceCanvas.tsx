import { useEffect, useRef, useState, type PointerEvent } from 'react';

interface Props {
  glyph: string;
  onDone: () => void;
}

export function TraceCanvas({ glyph, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  useEffect(clear, [glyph]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const ctx = event.currentTarget.getContext('2d')!;
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext('2d')!;
    const p = point(event);
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#735fd8';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  };

  return (
    <div className="trace-area">
      <div className="trace-board" aria-label={`描写 ${glyph}`}>
        <span className="trace-glyph">{glyph}</span>
        <canvas ref={canvasRef} width="300" height="260" onPointerDown={start} onPointerMove={move}
          onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
      </div>
      <div className="button-row">
        <button className="soft-button" onClick={clear}>↻ 重写</button>
        <button className="primary-button" disabled={!hasInk} onClick={onDone}>描好啦 ✓</button>
      </div>
    </div>
  );
}

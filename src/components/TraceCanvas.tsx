import { useEffect, useRef, useState, type PointerEvent } from 'react';

interface Props {
  glyph: string;
  onDone: () => void;
}

export function TraceCanvas({ glyph, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  useEffect(clear, [glyph]);

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
        <canvas className="trace-guide" ref={guideCanvasRef} width="300" height="260" aria-hidden="true" />
        <canvas className="trace-ink" ref={canvasRef} width="300" height="260" onPointerDown={start} onPointerMove={move}
          onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
      </div>
      <div className="button-row">
        <button className="soft-button" onClick={clear}>↻ 重写</button>
        <button className="primary-button" disabled={!hasInk} onClick={onDone}>描好啦 ✓</button>
      </div>
    </div>
  );
}

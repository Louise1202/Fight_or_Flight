"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Finger / mouse signature. Strokes are kept as points relative to the
// pad's size (0..1), so the pad can be redrawn after a rotation or resize
// and exported crisply: black ink on white, at most 600 x 200 px.

type Point = { x: number; y: number };
type Stroke = Point[];

const EXPORT_W = 600;
const EXPORT_H = 200;
// The on-screen pad keeps the export's 3:1 shape so nothing is squashed.
const ASPECT = EXPORT_W / EXPORT_H;

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  w: number,
  h: number,
  color: string,
  lineWidth: number
) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.length === 0) continue;
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x * w, s[0].y * h, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s[0].x * w, s[0].y * h);
    for (let i = 1; i < s.length - 1; i++) {
      const mx = ((s[i].x + s[i + 1].x) / 2) * w;
      const my = ((s[i].y + s[i + 1].y) / 2) * h;
      ctx.quadraticCurveTo(s[i].x * w, s[i].y * h, mx, my);
    }
    const last = s[s.length - 1];
    ctx.lineTo(last.x * w, last.y * h);
    ctx.stroke();
  }
}

function exportPng(strokes: Stroke[]): string {
  const c = document.createElement("canvas");
  c.width = EXPORT_W;
  c.height = EXPORT_H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
  drawStrokes(ctx, strokes, EXPORT_W, EXPORT_H, "#000000", 3.5);
  return c.toDataURL("image/png");
}

export default function SignaturePad({
  label,
  onChange,
  hasSignature,
  describedBy,
}: {
  /** Accessible name, e.g. "Signature for Thandi Mokoena". */
  label: string;
  /** PNG data URL after each stroke, or null when cleared. */
  onChange: (png: string | null) => void;
  hasSignature: boolean;
  describedBy?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    // White ink on the dark pad (the export is black on white).
    drawStrokes(ctx, strokesRef.current, size.w, size.h, "#ffffff", 2.5);
  }, [size]);

  // Keep the canvas sized to its box (rotation, resize).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const w = Math.round(wrap.clientWidth);
      setSize({ w, h: Math.round(w / ASPECT) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    redraw();
  }, [size, redraw]);

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    strokesRef.current.push([pointFrom(e)]);
    redraw();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    const p = pointFrom(e);
    const prev = stroke[stroke.length - 1];
    // Skip tiny moves: smaller PNG, smoother line.
    if (Math.abs(p.x - prev.x) * size.w < 1.5 && Math.abs(p.y - prev.y) * size.h < 1.5) return;
    stroke.push(p);
    redraw();
  }

  function finish() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(strokesRef.current.length ? exportPng(strokesRef.current) : null);
  }

  function clear() {
    strokesRef.current = [];
    redraw();
    onChange(null);
  }

  return (
    <div>
      <div
        ref={wrapRef}
        className={`relative w-full overflow-hidden rounded-md border-2 bg-fofSunk ${
          hasSignature ? "border-fofGunmetal" : "border-dashed border-fofGunmetal"
        }`}
        style={{ height: size.h || undefined, aspectRatio: size.h ? undefined : `${ASPECT}` }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          aria-describedby={describedBy}
          className="block h-full w-full cursor-crosshair"
          style={{ touchAction: "none", width: size.w || "100%", height: size.h || "100%" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onPointerLeave={finish}
        />
        {!hasSignature && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-fofGunmetal"
          >
            Sign here with your finger
          </span>
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 bottom-10 border-t border-dashed border-fofCharcoal"
        />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={clear}
          className="tap-target rounded-md border border-fofGunmetal px-5 text-sm text-fofPaper hover:border-fofRed"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

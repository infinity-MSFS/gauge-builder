import { useEffect, useRef } from "react";
import {
  useSceneStore,
  type SceneElement,
  type BoundValue,
  type NvgStyle,
  type BoundColor,
  type PathCmd,
} from "../store/sceneStore";

function resolveBV(
  bv: BoundValue,
  vars: Map<string, number>,
): number {
  switch (bv.type) {
    case "Literal":
      return bv.value;
    case "LVar":
      return vars.get(bv.name) ?? 0;
    case "AVar":
      return vars.get(bv.name) ?? 0;
    case "Expr":
      return 0;
  }
}

function colorToCSS(c: BoundColor | null): string | null {
  if (!c) return null;
  const [r, g, b, a] = c.Rgba;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

function applyStyle(
  ctx: CanvasRenderingContext2D,
  style: NvgStyle,
) {
  const fill = colorToCSS(style.fill);
  const stroke = colorToCSS(style.stroke);
  if (fill) ctx.fillStyle = fill;
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = style.stroke_width;
  }
  ctx.lineCap = style.line_cap.toLowerCase() as CanvasLineCap;
  ctx.lineJoin = style.line_join.toLowerCase() as CanvasLineJoin;
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  el: SceneElement,
  vars: Map<string, number>,
) {
  if (!el.visible) return;

  const k = el.kind;
  ctx.save();

  switch (k.type) {
    case "Rect": {
      applyStyle(ctx, k.style);
      const x = resolveBV(k.x, vars);
      const y = resolveBV(k.y, vars);
      const w = resolveBV(k.w, vars);
      const h = resolveBV(k.h, vars);
      if (k.style.fill) ctx.fillRect(x, y, w, h);
      if (k.style.stroke) ctx.strokeRect(x, y, w, h);
      break;
    }
    case "Circle": {
      applyStyle(ctx, k.style);
      const cx = resolveBV(k.cx, vars);
      const cy = resolveBV(k.cy, vars);
      const r = resolveBV(k.r, vars);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (k.style.fill) ctx.fill();
      if (k.style.stroke) ctx.stroke();
      break;
    }
    case "Arc": {
      applyStyle(ctx, k.style);
      const cx = resolveBV(k.cx, vars);
      const cy = resolveBV(k.cy, vars);
      const r = resolveBV(k.r, vars);
      const a0 = resolveBV(k.a0, vars);
      const a1 = resolveBV(k.a1, vars);
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1, k.dir === "Ccw");
      if (k.style.fill) ctx.fill();
      if (k.style.stroke) ctx.stroke();
      break;
    }
    case "Line": {
      applyStyle(ctx, k.style);
      ctx.beginPath();
      ctx.moveTo(resolveBV(k.x1, vars), resolveBV(k.y1, vars));
      ctx.lineTo(resolveBV(k.x2, vars), resolveBV(k.y2, vars));
      ctx.stroke();
      break;
    }
    case "Text": {
      applyStyle(ctx, k.style);
      const x = resolveBV(k.x, vars);
      const y = resolveBV(k.y, vars);
      const fontSize = resolveBV(k.font_size, vars);
      const content = k.content.type === "Literal"
        ? String(k.content.value)
        : String(resolveBV(k.content, vars));
      ctx.font = `${fontSize}px ${k.font || "sans-serif"}`;
      if (k.style.fill) ctx.fillText(content, x, y);
      if (k.style.stroke) ctx.strokeText(content, x, y);
      break;
    }
    case "Path": {
      applyStyle(ctx, k.style);
      ctx.beginPath();
      for (const cmd of k.commands) {
        drawPathCmd(ctx, cmd, vars);
      }
      if (k.style.fill) ctx.fill();
      if (k.style.stroke) ctx.stroke();
      break;
    }
    case "Group": {
      for (const child of k.children) {
        drawElement(ctx, child, vars);
      }
      break;
    }
  }

  ctx.restore();
}

function drawPathCmd(
  ctx: CanvasRenderingContext2D,
  cmd: PathCmd,
  vars: Map<string, number>,
) {
  switch (cmd.type) {
    case "MoveTo":
      ctx.moveTo(resolveBV(cmd.x, vars), resolveBV(cmd.y, vars));
      break;
    case "LineTo":
      ctx.lineTo(resolveBV(cmd.x, vars), resolveBV(cmd.y, vars));
      break;
    case "BezierTo":
      ctx.bezierCurveTo(
        resolveBV(cmd.c1x, vars),
        resolveBV(cmd.c1y, vars),
        resolveBV(cmd.c2x, vars),
        resolveBV(cmd.c2y, vars),
        resolveBV(cmd.x, vars),
        resolveBV(cmd.y, vars),
      );
      break;
    case "ClosePath":
      ctx.closePath();
      break;
  }
}

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useSceneStore((s) => s.scene);
  const vars = useSceneStore((s) => s.vars);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = scene.width;
    canvas.height = scene.height;

    // Build var preview map
    const varMap = new Map<string, number>();
    for (const v of vars) {
      varMap.set(v.id, v.preview_value);
    }

    // Clear
    ctx.clearRect(0, 0, scene.width, scene.height);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, scene.width, scene.height);

    // Draw all elements
    for (const el of scene.elements) {
      drawElement(ctx, el, varMap);
    }
  }, [scene, vars]);

  return (
    <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#0a0a0a]">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full"
        style={{
          imageRendering: "auto",
          border: "1px solid #2a2a4a",
        }}
      />
    </div>
  );
}

import { useEffect, useRef, useReducer } from "react";
import {
  useSceneStore,
  type SceneElement,
  type ElementKind,
  type BoundValue,
  type NvgStyle,
  type BoundColor,
} from "../store/sceneStore";

// ─── Types ────────────────────────────────────────────────────────────

interface Viewport { panX: number; panY: number; zoom: number }
interface BBox     { x: number; y: number; w: number; h: number }

type ResizeHandle = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

interface BgImage {
  id: string;
  el: HTMLImageElement;
  x: number; y: number; w: number; h: number;
}

type DragMode =
  | { t: 'none' }
  | { t: 'pan';        sx0: number; sy0: number; px0: number; py0: number }
  | { t: 'move-el';    id: string; sx0: number; sy0: number; k0: ElementKind }
  | { t: 'resize-el';  id: string; h: ResizeHandle; sx0: number; sy0: number; k0: ElementKind; bbox0: BBox }
  | { t: 'move-img';   id: string; sx0: number; sy0: number; x0: number; y0: number }
  | { t: 'resize-img'; id: string; h: ResizeHandle; sx0: number; sy0: number; img0: BgImage };

// ─── BoundValue helpers ───────────────────────────────────────────────

function rv(bv: BoundValue, vars: Map<string, number>): number {
  switch (bv.type) {
    case "Literal": return bv.value;
    case "LVar":    return vars.get(bv.name) ?? 0;
    case "AVar":    return vars.get(bv.name) ?? 0;
    case "Expr":    return 0;
  }
}

const litAdd = (bv: BoundValue, d: number): BoundValue =>
  bv.type === "Literal" ? { type: "Literal", value: bv.value + d } : bv;

const litSet = (bv: BoundValue, v: number): BoundValue =>
  bv.type === "Literal" ? { type: "Literal", value: v } : bv;

// ─── Element bounding box ─────────────────────────────────────────────

function getElementBBox(el: SceneElement, vars: Map<string, number>): BBox | null {
  const k = el.kind;
  switch (k.type) {
    case "Rect": {
      const x = rv(k.x, vars), y = rv(k.y, vars), w = rv(k.w, vars), h = rv(k.h, vars);
      return { x: Math.min(x, x+w), y: Math.min(y, y+h), w: Math.abs(w), h: Math.abs(h) };
    }
    case "Circle": {
      const r = Math.abs(rv(k.r, vars)), cx = rv(k.cx, vars), cy = rv(k.cy, vars);
      return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
    }
    case "Arc": {
      const r = Math.abs(rv(k.r, vars)), cx = rv(k.cx, vars), cy = rv(k.cy, vars);
      return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
    }
    case "Line": {
      const x1 = rv(k.x1, vars), y1 = rv(k.y1, vars), x2 = rv(k.x2, vars), y2 = rv(k.y2, vars);
      return {
        x: Math.min(x1, x2), y: Math.min(y1, y2),
        w: Math.max(Math.abs(x2 - x1), 8), h: Math.max(Math.abs(y2 - y1), 8),
      };
    }
    case "Text": {
      const x = rv(k.x, vars), y = rv(k.y, vars), fs = rv(k.font_size, vars);
      return { x, y: y - fs * 1.1, w: fs * 6, h: fs * 1.4 };
    }
    default: return null;
  }
}

// ─── Element transform helpers ────────────────────────────────────────

function moveElementKind(kind: ElementKind, dx: number, dy: number): ElementKind {
  switch (kind.type) {
    case "Rect":   return { ...kind, x: litAdd(kind.x, dx), y: litAdd(kind.y, dy) };
    case "Circle": return { ...kind, cx: litAdd(kind.cx, dx), cy: litAdd(kind.cy, dy) };
    case "Arc":    return { ...kind, cx: litAdd(kind.cx, dx), cy: litAdd(kind.cy, dy) };
    case "Line":   return { ...kind, x1: litAdd(kind.x1, dx), y1: litAdd(kind.y1, dy), x2: litAdd(kind.x2, dx), y2: litAdd(kind.y2, dy) };
    case "Text":   return { ...kind, x: litAdd(kind.x, dx), y: litAdd(kind.y, dy) };
    case "Path": {
      return {
        ...kind,
        commands: kind.commands.map(cmd => {
          if (cmd.type === "MoveTo" || cmd.type === "LineTo")
            return { ...cmd, x: litAdd(cmd.x, dx), y: litAdd(cmd.y, dy) };
          if (cmd.type === "BezierTo")
            return { ...cmd, x: litAdd(cmd.x, dx), y: litAdd(cmd.y, dy), c1x: litAdd(cmd.c1x, dx), c1y: litAdd(cmd.c1y, dy), c2x: litAdd(cmd.c2x, dx), c2y: litAdd(cmd.c2y, dy) };
          return cmd;
        }),
      };
    }
    default: return kind;
  }
}

function resizeElementKind(kind: ElementKind, handle: ResizeHandle, dx: number, dy: number, bbox0: BBox): ElementKind {
  switch (kind.type) {
    case "Rect": {
      let { x, y, w, h } = bbox0;
      if (handle === 'tl' || handle === 'tc' || handle === 'tr') { y += dy; h -= dy; }
      if (handle === 'bl' || handle === 'bc' || handle === 'br') { h += dy; }
      if (handle === 'tl' || handle === 'ml' || handle === 'bl') { x += dx; w -= dx; }
      if (handle === 'tr' || handle === 'mr' || handle === 'br') { w += dx; }
      w = Math.max(2, w); h = Math.max(2, h);
      return { ...kind, x: litSet(kind.x, x), y: litSet(kind.y, y), w: litSet(kind.w, w), h: litSet(kind.h, h) };
    }
    case "Circle":
    case "Arc": {
      const newR = Math.max(1, bbox0.w / 2 + dx);
      return { ...kind, r: litSet(kind.r, newR) };
    }
    case "Line": {
      if (handle === 'tl') return { ...kind, x1: litAdd(kind.x1, dx), y1: litAdd(kind.y1, dy) };
      if (handle === 'br') return { ...kind, x2: litAdd(kind.x2, dx), y2: litAdd(kind.y2, dy) };
      return kind;
    }
    default: return kind;
  }
}

// ─── Viewport utils ───────────────────────────────────────────────────

function toScene(mx: number, my: number, vp: Viewport) {
  return { x: (mx - vp.panX) / vp.zoom, y: (my - vp.panY) / vp.zoom };
}

const HANDLE_R = 5;

function getHandles(bbox: BBox, vp: Viewport) {
  const { x, y, w, h } = bbox;
  const p = (sx: number, sy: number) => ({ sx: sx * vp.zoom + vp.panX, sy: sy * vp.zoom + vp.panY });
  return [
    { handle: 'tl' as ResizeHandle, ...p(x,       y      ) },
    { handle: 'tc' as ResizeHandle, ...p(x + w/2, y      ) },
    { handle: 'tr' as ResizeHandle, ...p(x + w,   y      ) },
    { handle: 'ml' as ResizeHandle, ...p(x,       y + h/2) },
    { handle: 'mr' as ResizeHandle, ...p(x + w,   y + h/2) },
    { handle: 'bl' as ResizeHandle, ...p(x,       y + h  ) },
    { handle: 'bc' as ResizeHandle, ...p(x + w/2, y + h  ) },
    { handle: 'br' as ResizeHandle, ...p(x + w,   y + h  ) },
  ];
}

function hitHandle(mx: number, my: number, bbox: BBox, vp: Viewport): ResizeHandle | null {
  for (const { handle, sx, sy } of getHandles(bbox, vp)) {
    if (Math.hypot(mx - sx, my - sy) <= HANDLE_R + 4) return handle;
  }
  return null;
}

const handleCursors: Record<ResizeHandle, string> = {
  tl: 'nw-resize', tc: 'n-resize',  tr: 'ne-resize',
  ml: 'w-resize',                    mr: 'e-resize',
  bl: 'sw-resize', bc: 's-resize',  br: 'se-resize',
};

// ─── Drawing ──────────────────────────────────────────────────────────

function colorToCSS(c: BoundColor | null): string | null {
  if (!c) return null;
  const [r, g, b, a] = c.Rgba;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

function applyStyle(ctx: CanvasRenderingContext2D, style: NvgStyle) {
  const fill   = colorToCSS(style.fill);
  const stroke = colorToCSS(style.stroke);
  if (fill)   ctx.fillStyle   = fill;
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = style.stroke_width; }
  ctx.lineCap  = style.line_cap.toLowerCase()  as CanvasLineCap;
  ctx.lineJoin = style.line_join.toLowerCase() as CanvasLineJoin;
}

function drawElement(ctx: CanvasRenderingContext2D, el: SceneElement, vars: Map<string, number>) {
  if (!el.visible) return;
  const k = el.kind;
  ctx.save();
  switch (k.type) {
    case "Rect": {
      applyStyle(ctx, k.style);
      const x = rv(k.x, vars), y = rv(k.y, vars), w = rv(k.w, vars), h = rv(k.h, vars);
      if (k.style.fill)   ctx.fillRect(x, y, w, h);
      if (k.style.stroke) ctx.strokeRect(x, y, w, h);
      break;
    }
    case "Circle": {
      applyStyle(ctx, k.style);
      ctx.beginPath();
      ctx.arc(rv(k.cx, vars), rv(k.cy, vars), Math.max(0, rv(k.r, vars)), 0, Math.PI * 2);
      if (k.style.fill)   ctx.fill();
      if (k.style.stroke) ctx.stroke();
      break;
    }
    case "Arc": {
      applyStyle(ctx, k.style);
      ctx.beginPath();
      ctx.arc(rv(k.cx, vars), rv(k.cy, vars), Math.max(0, rv(k.r, vars)), rv(k.a0, vars), rv(k.a1, vars), k.dir === "Ccw");
      if (k.style.fill)   ctx.fill();
      if (k.style.stroke) ctx.stroke();
      break;
    }
    case "Line": {
      applyStyle(ctx, k.style);
      ctx.beginPath();
      ctx.moveTo(rv(k.x1, vars), rv(k.y1, vars));
      ctx.lineTo(rv(k.x2, vars), rv(k.y2, vars));
      ctx.stroke();
      break;
    }
    case "Text": {
      applyStyle(ctx, k.style);
      const x = rv(k.x, vars), y = rv(k.y, vars), fs = rv(k.font_size, vars);
      const content = k.content.type === "Literal"
        ? String(k.content.value)
        : String(rv(k.content as BoundValue, vars));
      ctx.font = `${fs}px ${k.font || "sans-serif"}`;
      if (k.style.fill)   ctx.fillText(content, x, y);
      if (k.style.stroke) ctx.strokeText(content, x, y);
      break;
    }
    case "Path": {
      applyStyle(ctx, k.style);
      ctx.beginPath();
      for (const cmd of k.commands) {
        switch (cmd.type) {
          case "MoveTo":   ctx.moveTo(rv(cmd.x, vars), rv(cmd.y, vars)); break;
          case "LineTo":   ctx.lineTo(rv(cmd.x, vars), rv(cmd.y, vars)); break;
          case "BezierTo": ctx.bezierCurveTo(rv(cmd.c1x, vars), rv(cmd.c1y, vars), rv(cmd.c2x, vars), rv(cmd.c2y, vars), rv(cmd.x, vars), rv(cmd.y, vars)); break;
          case "ClosePath": ctx.closePath(); break;
        }
      }
      if (k.style.fill)   ctx.fill();
      if (k.style.stroke) ctx.stroke();
      break;
    }
    case "Group": {
      for (const child of k.children) drawElement(ctx, child, vars);
      break;
    }
  }
  ctx.restore();
}

function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  bbox: BBox,
  vp: Viewport,
  kind: ElementKind | null,
) {
  const sx = bbox.x * vp.zoom + vp.panX;
  const sy = bbox.y * vp.zoom + vp.panY;
  const sw = bbox.w * vp.zoom;
  const sh = bbox.h * vp.zoom;

  ctx.save();
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(sx, sy, sw, sh);
  ctx.setLineDash([]);

  // Which handles to show per shape
  let handles = getHandles(bbox, vp);
  if (kind?.type === 'Circle' || kind?.type === 'Arc') {
    handles = handles.filter(h => h.handle === 'mr');
  } else if (kind?.type === 'Line') {
    handles = handles.filter(h => h.handle === 'tl' || h.handle === 'br');
  } else if (kind?.type === 'Text' || kind?.type === 'Path') {
    handles = [];
  }

  for (const { sx: hx, sy: hy } of handles) {
    ctx.beginPath();
    ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Canvas component ─────────────────────────────────────────────────

export default function Canvas() {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);

  // ── All mutable state in refs (no stale closures, no re-renders on every frame) ──

  // Mirror store state into refs
  const sceneRef      = useRef(useSceneStore.getState().scene);
  const varsRef       = useRef(useSceneStore.getState().vars);
  const selectedIdRef = useRef(useSceneStore.getState().selectedId);

  // Viewport
  const vpRef   = useRef<Viewport>({ panX: 0, panY: 0, zoom: 1 });
  // Interaction
  const dragRef      = useRef<DragMode>({ t: 'none' });
  const localKindRef = useRef<ElementKind | null>(null);  // live override during element drag
  const localBgRef   = useRef<BgImage | null>(null);       // live override during image drag
  const spaceRef     = useRef(false);
  // Background images (purely local, not in scene store)
  const bgImgsRef    = useRef<BgImage[]>([]);

  // Only used to force a React re-render for overlay buttons (rare)
  const [, forceUpdate] = useReducer(x => x + 1, 0);

  // ── Draw ─────────────────────────────────────────────────────────────

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scene      = sceneRef.current;
    const vp         = vpRef.current;
    const selectedId = selectedIdRef.current;
    const W = canvas.width, H = canvas.height;

    const varMap = new Map<string, number>();
    for (const v of varsRef.current) varMap.set(v.id, v.preview_value);

    // ── Background ──
    ctx.clearRect(0, 0, W, H);

    // Subtle checkerboard outside scene area
    const tileSize = Math.max(8, 24 * vp.zoom);
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a0a';
    for (let tx = 0; tx * tileSize < W + tileSize; tx++) {
      for (let ty = 0; ty * tileSize < H + tileSize; ty++) {
        if ((tx + ty) % 2 === 0) {
          ctx.fillRect(tx * tileSize, ty * tileSize, tileSize, tileSize);
        }
      }
    }

    ctx.save();
    ctx.translate(vp.panX, vp.panY);
    ctx.scale(vp.zoom, vp.zoom);

    // Scene canvas background
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, scene.width, scene.height);

    // Reference images (behind scene elements)
    for (const img of bgImgsRef.current) {
      const live = localBgRef.current?.id === img.id ? localBgRef.current! : img;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(live.el, live.x, live.y, live.w, live.h);
      ctx.restore();
    }

    // Scene elements
    for (const el of scene.elements) {
      if (!el.visible) continue;
      const overrideKind = localKindRef.current !== null && el.id === selectedId
        ? localKindRef.current
        : null;
      drawElement(ctx, overrideKind ? { ...el, kind: overrideKind } : el, varMap);
    }

    ctx.restore();

    // ── Selection overlay (screen-space, outside transform) ──
    if (selectedId) {
      const bgImg = bgImgsRef.current.find(i => i.id === selectedId);
      if (bgImg) {
        const live = localBgRef.current?.id === bgImg.id ? localBgRef.current! : bgImg;
        drawSelectionOverlay(ctx, { x: live.x, y: live.y, w: live.w, h: live.h }, vp, null);
      } else {
        const el = scene.elements.find(e => e.id === selectedId);
        if (el) {
          const kind = localKindRef.current ?? el.kind;
          const bbox = getElementBBox({ ...el, kind }, varMap);
          if (bbox) drawSelectionOverlay(ctx, bbox, vp, kind);
        }
      }
    }

    // Update zoom label directly (avoids React re-render)
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(vp.zoom * 100)}%`;
    }
  };

  // ── Store subscription ────────────────────────────────────────────────

  useEffect(() => {
    return useSceneStore.subscribe(state => {
      sceneRef.current      = state.scene;
      varsRef.current       = state.vars;
      selectedIdRef.current = state.selectedId;
      draw();
    });
  }, []);

  // ── ResizeObserver ────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = width; canvas.height = height; }
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Fit & initial layout ──────────────────────────────────────────────

  const fitScene = () => {
    const container = containerRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    const scene = sceneRef.current;
    const zoom  = Math.min(width / scene.width, height / scene.height) * 0.85;
    vpRef.current = {
      panX: (width  - scene.width  * zoom) / 2,
      panY: (height - scene.height * zoom) / 2,
      zoom,
    };
    draw();
  };

  useEffect(() => {
    const id = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const { width, height } = container.getBoundingClientRect();
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = width; canvas.height = height; }
      fitScene();
    }, 50);
    return () => clearTimeout(id);
  }, []);

  // ── Wheel zoom (needs non-passive listener for preventDefault) ────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect   = canvas.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      const vp     = vpRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz     = Math.max(0.03, Math.min(20, vp.zoom * factor));
      vpRef.current = {
        zoom: nz,
        panX: mx - (mx - vp.panX) * (nz / vp.zoom),
        panY: my - (my - vp.panY) * (nz / vp.zoom),
      };
      draw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ── Mouse helpers ─────────────────────────────────────────────────────

  const getMousePos = (e: MouseEvent | React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { x: sx, y: sy } = toScene(mx, my, vpRef.current);
    return { mx, my, sx, sy };
  };

  const hitElement = (sx: number, sy: number): string | null => {
    const varMap = new Map<string, number>();
    for (const v of varsRef.current) varMap.set(v.id, v.preview_value);
    const elements = sceneRef.current.elements;
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (!el.visible) continue;
      const bbox = getElementBBox(el, varMap);
      if (!bbox) continue;
      if (sx >= bbox.x && sx <= bbox.x + bbox.w && sy >= bbox.y && sy <= bbox.y + bbox.h) return el.id;
    }
    return null;
  };

  const hitBgImage = (sx: number, sy: number): string | null => {
    const imgs = bgImgsRef.current;
    for (let i = imgs.length - 1; i >= 0; i--) {
      const img = imgs[i];
      if (sx >= img.x && sx <= img.x + img.w && sy >= img.y && sy <= img.y + img.h) return img.id;
    }
    return null;
  };

  const getBBoxForSelected = (id: string): BBox | null => {
    const varMap = new Map<string, number>();
    for (const v of varsRef.current) varMap.set(v.id, v.preview_value);
    const bgImg = bgImgsRef.current.find(i => i.id === id);
    if (bgImg) return { x: bgImg.x, y: bgImg.y, w: bgImg.w, h: bgImg.h };
    const el = sceneRef.current.elements.find(e => e.id === id);
    if (el) return getElementBBox(el, varMap);
    return null;
  };

  const setCursor = (c: string) => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = c;
  };

  const updateHoverCursor = (mx: number, my: number, sx: number, sy: number) => {
    if (spaceRef.current) { setCursor('grab'); return; }
    const selId = selectedIdRef.current;
    if (selId) {
      const bbox = getBBoxForSelected(selId);
      if (bbox) {
        const handle = hitHandle(mx, my, bbox, vpRef.current);
        if (handle) { setCursor(handleCursors[handle]); return; }
        if (sx >= bbox.x && sx <= bbox.x + bbox.w && sy >= bbox.y && sy <= bbox.y + bbox.h) {
          setCursor('move'); return;
        }
      }
    }
    if (hitElement(sx, sy) || hitBgImage(sx, sy)) { setCursor('pointer'); return; }
    setCursor('default');
  };

  // ── Mouse event handlers ──────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const { mx, my, sx, sy } = getMousePos(e);
    const vp = vpRef.current;

    // Middle button or space → pan
    if (e.button === 1 || spaceRef.current) {
      dragRef.current = { t: 'pan', sx0: mx, sy0: my, px0: vp.panX, py0: vp.panY };
      setCursor('grabbing');
      return;
    }

    const selId  = selectedIdRef.current;
    const varMap = new Map<string, number>();
    for (const v of varsRef.current) varMap.set(v.id, v.preview_value);

    // Check resize/move handles on currently selected item first
    if (selId) {
      const bgImg = bgImgsRef.current.find(i => i.id === selId);
      if (bgImg) {
        const bbox = { x: bgImg.x, y: bgImg.y, w: bgImg.w, h: bgImg.h };
        const handle = hitHandle(mx, my, bbox, vp);
        if (handle) {
          dragRef.current = { t: 'resize-img', id: selId, h: handle, sx0: sx, sy0: sy, img0: { ...bgImg } };
          return;
        }
        if (sx >= bgImg.x && sx <= bgImg.x + bgImg.w && sy >= bgImg.y && sy <= bgImg.y + bgImg.h) {
          dragRef.current = { t: 'move-img', id: selId, sx0: sx, sy0: sy, x0: bgImg.x, y0: bgImg.y };
          return;
        }
      } else {
        const el = sceneRef.current.elements.find(e => e.id === selId);
        if (el) {
          const bbox = getElementBBox(el, varMap);
          if (bbox) {
            const handle = hitHandle(mx, my, bbox, vp);
            if (handle) {
              dragRef.current = { t: 'resize-el', id: selId, h: handle, sx0: sx, sy0: sy, k0: el.kind, bbox0: bbox };
              return;
            }
            if (sx >= bbox.x && sx <= bbox.x + bbox.w && sy >= bbox.y && sy <= bbox.y + bbox.h) {
              dragRef.current = { t: 'move-el', id: selId, sx0: sx, sy0: sy, k0: el.kind };
              return;
            }
          }
        }
      }
    }

    // Hit-test for new selection
    const bgHit = hitBgImage(sx, sy);
    if (bgHit) {
      useSceneStore.getState().setSelectedId(bgHit);
      const img = bgImgsRef.current.find(i => i.id === bgHit)!;
      dragRef.current = { t: 'move-img', id: bgHit, sx0: sx, sy0: sy, x0: img.x, y0: img.y };
      return;
    }

    const elHit = hitElement(sx, sy);
    if (elHit) {
      useSceneStore.getState().setSelectedId(elHit);
      const el = sceneRef.current.elements.find(e => e.id === elHit)!;
      dragRef.current = { t: 'move-el', id: elHit, sx0: sx, sy0: sy, k0: el.kind };
      return;
    }

    // Clicked empty space → deselect
    useSceneStore.getState().setSelectedId(null);
  };

  // Use a ref so global listeners always call the latest function body
  const globalMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  const globalUpRef   = useRef<(e: MouseEvent) => void>(() => {});

  globalMoveRef.current = (e: MouseEvent) => {
    const drag = dragRef.current;
    if (drag.t === 'none') return;

    const { mx, my, sx, sy } = getMousePos(e);
    const vp = vpRef.current;

    if (drag.t === 'pan') {
      vpRef.current = { ...vp, panX: drag.px0 + (mx - drag.sx0), panY: drag.py0 + (my - drag.sy0) };
      draw();
      return;
    }
    if (drag.t === 'move-el') {
      localKindRef.current = moveElementKind(drag.k0, sx - drag.sx0, sy - drag.sy0);
      draw();
      return;
    }
    if (drag.t === 'resize-el') {
      localKindRef.current = resizeElementKind(drag.k0, drag.h, sx - drag.sx0, sy - drag.sy0, drag.bbox0);
      draw();
      return;
    }
    if (drag.t === 'move-img') {
      const img = bgImgsRef.current.find(i => i.id === drag.id)!;
      localBgRef.current = { ...img, x: drag.x0 + (sx - drag.sx0), y: drag.y0 + (sy - drag.sy0) };
      draw();
      return;
    }
    if (drag.t === 'resize-img') {
      const init = drag.img0;
      let { x, y, w, h } = init;
      const dx = sx - drag.sx0, dy = sy - drag.sy0;
      if (drag.h === 'tl' || drag.h === 'tc' || drag.h === 'tr') { y += dy; h -= dy; }
      if (drag.h === 'bl' || drag.h === 'bc' || drag.h === 'br') { h += dy; }
      if (drag.h === 'tl' || drag.h === 'ml' || drag.h === 'bl') { x += dx; w -= dx; }
      if (drag.h === 'tr' || drag.h === 'mr' || drag.h === 'br') { w += dx; }
      w = Math.max(10, w); h = Math.max(10, h);
      localBgRef.current = { ...init, x, y, w, h };
      draw();
      return;
    }
  };

  globalUpRef.current = async (_e: MouseEvent) => {
    const drag = dragRef.current;
    dragRef.current = { t: 'none' };

    if (drag.t === 'move-el' || drag.t === 'resize-el') {
      const finalKind = localKindRef.current;
      if (finalKind) {
        // Optimistic local update to avoid flash while Tauri round-trips
        sceneRef.current = {
          ...sceneRef.current,
          elements: sceneRef.current.elements.map(el =>
            el.id === drag.id ? { ...el, kind: finalKind } : el
          ),
        };
        localKindRef.current = null;
        draw();
        await useSceneStore.getState().updateElement(drag.id, finalKind);
      }
    }

    if (drag.t === 'move-img' || drag.t === 'resize-img') {
      if (localBgRef.current) {
        bgImgsRef.current = bgImgsRef.current.map(img =>
          img.id === drag.id ? localBgRef.current! : img
        );
        localBgRef.current = null;
        draw();
      }
    }

    setCursor(spaceRef.current ? 'grab' : 'default');
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => globalMoveRef.current(e);
    const onUp   = (e: MouseEvent) => globalUpRef.current(e);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, []);

  // Hover cursor (only when not actively dragging)
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current.t === 'none') {
      const { mx, my, sx, sy } = getMousePos(e);
      updateHoverCursor(mx, my, sx, sy);
    }
  };

  // ── Keyboard ──────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.matches('input,textarea,[contenteditable]');

      if (e.code === 'Space' && !e.repeat && !inInput) {
        e.preventDefault();
        spaceRef.current = true;
        if (dragRef.current.t === 'none') setCursor('grab');
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && !inInput) {
        const selId = selectedIdRef.current;
        if (!selId) return;
        const isBg = bgImgsRef.current.some(i => i.id === selId);
        if (isBg) {
          bgImgsRef.current = bgImgsRef.current.filter(i => i.id !== selId);
          useSceneStore.getState().setSelectedId(null);
          draw();
          forceUpdate();
        } else {
          useSceneStore.getState().deleteElement(selId);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !inInput) {
        e.preventDefault();
        fitScene();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        if (dragRef.current.t === 'none') setCursor('default');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, []);

  // ── Background image loader ───────────────────────────────────────────

  const loadImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target!.result as string;
      const img = new Image();
      img.onload = () => {
        const scene  = sceneRef.current;
        const scale  = Math.min(scene.width / img.width, scene.height / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        const bgImg: BgImage = {
          id: `bgimg_${Date.now()}`,
          el: img,
          x: (scene.width  - w) / 2,
          y: (scene.height - h) / 2,
          w, h,
        };
        bgImgsRef.current = [...bgImgsRef.current, bgImg];
        useSceneStore.getState().setSelectedId(bgImg.id);
        draw();
        forceUpdate();
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      if (e.dataTransfer.files[i].type.startsWith('image/')) {
        loadImageFile(e.dataTransfer.files[i]);
        break;
      }
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden"
      style={{ background: '#000000' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Canvas overlay toolbar */}
      <div className="absolute top-2 right-2 flex gap-1.5 pointer-events-auto">
        <button
          className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
          style={{ background: 'rgba(8,8,8,0.9)', border: '1px solid #1c1c1c', color: '#606060', backdropFilter: 'blur(8px)' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#e8e8e8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#606060')}
          onClick={fitScene}
          title="Fit scene to viewport (Ctrl+F)"
        >
          ⊡ Fit
        </button>
        <label
          className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors cursor-pointer"
          style={{ background: 'rgba(8,8,8,0.9)', border: '1px solid #1c1c1c', color: '#606060', backdropFilter: 'blur(8px)' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#e8e8e8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#606060')}
          title="Load reference image (or drag & drop onto canvas)"
        >
          🖼 Image
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              if (e.target.files?.[0]) loadImageFile(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {/* Zoom level */}
      <span
        ref={zoomLabelRef}
        className="absolute bottom-2 right-3 text-[11px] font-mono select-none pointer-events-none"
        style={{ color: '#2c2c2c' }}
      >
        100%
      </span>

      {/* Hint */}
      <span
        className="absolute bottom-2 left-3 text-[11px] select-none pointer-events-none"
        style={{ color: '#1e1e1e' }}
      >
        Scroll to zoom · Middle-click or Space+drag to pan · Delete to remove
      </span>
    </div>
  );
}

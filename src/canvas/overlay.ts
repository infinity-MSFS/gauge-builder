import {
	bboxCorners,
	matApply,
	matMul,
	type BBox,
	type Mat,
	type Pt,
	type PathShape,
} from "./geometry";
import type { SnapGuide } from "./snap";

// ─── Palette ──────────────────────────────────────────────────────────

export const UI = {
	accent: "#6366f1",
	accentSoft: "rgba(99,102,241,0.35)",
	ref: "#f59e0b",
	guide: "#f0398b",
	guideGrid: "#2dd4bf",
	node: "#ffffff",
	nodeSel: "#6366f1",
	handle: "#38bdf8",
	hover: "#818cf8",
	grid: "rgba(255,255,255,0.045)",
	gridMajor: "rgba(255,255,255,0.09)",
	ruler: "#0a0a0a",
	rulerLine: "#1c1c1c",
	rulerText: "#5a5a5a",
};

export const HANDLE_R = 4.5;
export const NODE_R = 4;
export const RULER_SIZE = 18;

// ─── Viewport ─────────────────────────────────────────────────────────

export interface Viewport {
	panX: number;
	panY: number;
	zoom: number;
}

export const viewportMat = (vp: Viewport): Mat => ({
	a: vp.zoom,
	b: 0,
	c: 0,
	d: vp.zoom,
	e: vp.panX,
	f: vp.panY,
});

export const toScene = (mx: number, my: number, vp: Viewport): Pt => ({
	x: (mx - vp.panX) / vp.zoom,
	y: (my - vp.panY) / vp.zoom,
});

export const toScreen = (sx: number, sy: number, vp: Viewport): Pt => ({
	x: sx * vp.zoom + vp.panX,
	y: sy * vp.zoom + vp.panY,
});

// ─── Handles ──────────────────────────────────────────────────────────

export type ScaleHandle =
	| "tl"
	| "tc"
	| "tr"
	| "ml"
	| "mr"
	| "bl"
	| "bc"
	| "br";

export type Handle =
	| { t: "scale"; h: ScaleHandle }
	| { t: "rotate"; h: ScaleHandle }
	| { t: "pivot" }
	| { t: "radius" }
	| { t: "arcAngle"; i: 0 | 1 }
	| { t: "lineEnd"; i: 0 | 1 }
	| { t: "node"; i: number }
	| { t: "handleIn"; i: number }
	| { t: "handleOut"; i: number };

export interface PlacedHandle {
	handle: Handle;
	/** Screen-space position. */
	p: Pt;
	cursor: string;
}

const SCALE_ORDER: ScaleHandle[] = ["tl", "tc", "tr", "mr", "br", "bc", "bl", "ml"];

/** Local-space anchor for each scale handle within a bbox. */
export function handleAnchor(b: BBox, h: ScaleHandle): Pt {
	const cx = b.x + b.w / 2;
	const cy = b.y + b.h / 2;
	const r = b.x + b.w;
	const bt = b.y + b.h;
	switch (h) {
		case "tl":
			return { x: b.x, y: b.y };
		case "tc":
			return { x: cx, y: b.y };
		case "tr":
			return { x: r, y: b.y };
		case "ml":
			return { x: b.x, y: cy };
		case "mr":
			return { x: r, y: cy };
		case "bl":
			return { x: b.x, y: bt };
		case "bc":
			return { x: cx, y: bt };
		case "br":
			return { x: r, y: bt };
	}
}

/** The bbox corner that stays put while `h` is dragged. */
export function handleOpposite(b: BBox, h: ScaleHandle): Pt {
	const opp: Record<ScaleHandle, ScaleHandle> = {
		tl: "br",
		tc: "bc",
		tr: "bl",
		ml: "mr",
		mr: "ml",
		bl: "tr",
		bc: "tc",
		br: "tl",
	};
	return handleAnchor(b, opp[h]);
}

/** Cursor for a handle, rotated to match the element's on-screen orientation. */
function scaleCursor(h: ScaleHandle, angleDeg: number): string {
	const base: Record<ScaleHandle, number> = {
		tl: 135,
		tc: 90,
		tr: 45,
		mr: 0,
		br: 135,
		bc: 90,
		bl: 45,
		ml: 0,
	};
	const a = (((base[h] + angleDeg) % 180) + 180) % 180;
	if (a < 22.5 || a >= 157.5) return "ew-resize";
	if (a < 67.5) return "nesw-resize";
	if (a < 112.5) return "ns-resize";
	return "nwse-resize";
}

/**
 * Screen-space handles for a single element, expressed through its full
 * local→screen matrix so a rotated group gets rotated handles.
 */
export function buildScaleHandles(
	bbox: BBox,
	m: Mat,
	opts: { rotate?: boolean; only?: ScaleHandle[] } = {},
): PlacedHandle[] {
	const angle = (Math.atan2(m.b, m.a) * 180) / Math.PI;
	const list = opts.only ?? SCALE_ORDER;
	const out: PlacedHandle[] = [];
	for (const h of list) {
		const a = handleAnchor(bbox, h);
		out.push({
			handle: { t: "scale", h },
			p: matApply(m, a.x, a.y),
			cursor: scaleCursor(h, angle),
		});
	}
	if (opts.rotate) {
		for (const h of ["tl", "tr", "bl", "br"] as ScaleHandle[]) {
			const a = handleAnchor(bbox, h);
			const c = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
			// Sit the rotate zone just outside the corner.
			const outward = { x: a.x + (a.x - c.x) * 0.14, y: a.y + (a.y - c.y) * 0.14 };
			out.push({
				handle: { t: "rotate", h },
				p: matApply(m, outward.x, outward.y),
				cursor: "grab",
			});
		}
	}
	return out;
}

export function hitHandles(
	handles: PlacedHandle[],
	mx: number,
	my: number,
	radius = HANDLE_R + 4,
): PlacedHandle | null {
	let best: PlacedHandle | null = null;
	let bestD = radius;
	for (const h of handles) {
		const d = Math.hypot(mx - h.p.x, my - h.p.y);
		if (d <= bestD) {
			bestD = d;
			best = h;
		}
	}
	return best;
}

// ─── Drawing primitives ───────────────────────────────────────────────

function dot(
	ctx: CanvasRenderingContext2D,
	p: Pt,
	r: number,
	fill: string,
	stroke: string,
) {
	ctx.beginPath();
	ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.lineWidth = 1.25;
	ctx.strokeStyle = stroke;
	ctx.stroke();
}

function square(
	ctx: CanvasRenderingContext2D,
	p: Pt,
	r: number,
	fill: string,
	stroke: string,
) {
	ctx.beginPath();
	ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.lineWidth = 1.25;
	ctx.strokeStyle = stroke;
	ctx.stroke();
}

/** Outline of a local-space bbox pushed through `m` (handles rotation). */
export function strokeQuad(
	ctx: CanvasRenderingContext2D,
	bbox: BBox,
	m: Mat,
	color: string,
	dash: number[] = [],
	width = 1.25,
) {
	const pts = bboxCorners(bbox).map((p) => matApply(m, p.x, p.y));
	ctx.save();
	ctx.setLineDash(dash);
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
	ctx.closePath();
	ctx.stroke();
	ctx.restore();
}

export function drawHandles(
	ctx: CanvasRenderingContext2D,
	handles: PlacedHandle[],
	accent = UI.accent,
) {
	ctx.save();
	for (const h of handles) {
		if (h.handle.t === "rotate") continue; // invisible affordance
		if (h.handle.t === "scale") square(ctx, h.p, HANDLE_R, "#ffffff", accent);
		else dot(ctx, h.p, HANDLE_R, "#ffffff", accent);
	}
	ctx.restore();
}

// ─── Path nodes ───────────────────────────────────────────────────────

export interface PathHandleSet {
	handles: PlacedHandle[];
}

/**
 * Anchors, control handles and their tethers for a path being node-edited.
 * `m` is the path's local→screen matrix.
 */
export function drawPathNodes(
	ctx: CanvasRenderingContext2D,
	shape: PathShape,
	m: Mat,
	selected: number[],
	hover: Handle | null,
): PathHandleSet {
	const handles: PlacedHandle[] = [];
	const sp = (p: Pt) => matApply(m, p.x, p.y);
	const selSet = new Set(selected);

	ctx.save();

	// Tethers first, so anchors draw over them.
	ctx.strokeStyle = UI.handle;
	ctx.lineWidth = 1;
	for (let i = 0; i < shape.nodes.length; i++) {
		const n = shape.nodes[i];
		// Handles are shown for selected anchors, matching Illustrator.
		if (!selSet.has(i)) continue;
		const a = sp({ x: n.x, y: n.y });
		for (const h of [n.hIn, n.hOut]) {
			if (!h) continue;
			const hp = sp(h);
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(hp.x, hp.y);
			ctx.stroke();
		}
	}

	for (let i = 0; i < shape.nodes.length; i++) {
		const n = shape.nodes[i];
		const a = sp({ x: n.x, y: n.y });
		const isSel = selSet.has(i);
		const isHover = hover?.t === "node" && hover.i === i;
		square(
			ctx,
			a,
			NODE_R + (isHover ? 1.5 : 0),
			isSel ? UI.nodeSel : "#ffffff",
			isSel ? "#ffffff" : UI.accent,
		);
		handles.push({ handle: { t: "node", i }, p: a, cursor: "pointer" });

		if (isSel) {
			if (n.hIn) {
				const hp = sp(n.hIn);
				dot(ctx, hp, NODE_R - 0.5, UI.handle, "#0a0a0a");
				handles.push({ handle: { t: "handleIn", i }, p: hp, cursor: "crosshair" });
			}
			if (n.hOut) {
				const hp = sp(n.hOut);
				dot(ctx, hp, NODE_R - 0.5, UI.handle, "#0a0a0a");
				handles.push({ handle: { t: "handleOut", i }, p: hp, cursor: "crosshair" });
			}
		}
	}

	ctx.restore();
	return { handles };
}

// ─── Snap guides ──────────────────────────────────────────────────────

export function drawSnapGuides(
	ctx: CanvasRenderingContext2D,
	guides: SnapGuide[],
	vp: Viewport,
) {
	if (guides.length === 0) return;
	ctx.save();
	ctx.setLineDash([4, 3]);
	ctx.lineWidth = 1;
	for (const g of guides) {
		ctx.strokeStyle = g.source === "grid" ? UI.guideGrid : UI.guide;
		ctx.beginPath();
		if (g.axis === "x") {
			const x = g.v * vp.zoom + vp.panX;
			const y0 = g.from * vp.zoom + vp.panY;
			const y1 = g.to * vp.zoom + vp.panY;
			ctx.moveTo(Math.round(x) + 0.5, y0 - 14);
			ctx.lineTo(Math.round(x) + 0.5, y1 + 14);
		} else {
			const y = g.v * vp.zoom + vp.panY;
			const x0 = g.from * vp.zoom + vp.panX;
			const x1 = g.to * vp.zoom + vp.panX;
			ctx.moveTo(x0 - 14, Math.round(y) + 0.5);
			ctx.lineTo(x1 + 14, Math.round(y) + 0.5);
		}
		ctx.stroke();
	}
	ctx.restore();
}

// ─── Grid ─────────────────────────────────────────────────────────────

export function drawGrid(
	ctx: CanvasRenderingContext2D,
	vp: Viewport,
	sceneW: number,
	sceneH: number,
	gridSize: number,
) {
	if (gridSize <= 0) return;
	// Step up in powers of two until lines are at least 6px apart on screen.
	let step = gridSize;
	while (step * vp.zoom < 6) step *= 2;

	ctx.save();
	ctx.lineWidth = 1 / vp.zoom;
	for (let x = 0; x <= sceneW + 0.001; x += step) {
		const major = Math.abs(x % (step * 8)) < 1e-6;
		ctx.strokeStyle = major ? UI.gridMajor : UI.grid;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, sceneH);
		ctx.stroke();
	}
	for (let y = 0; y <= sceneH + 0.001; y += step) {
		const major = Math.abs(y % (step * 8)) < 1e-6;
		ctx.strokeStyle = major ? UI.gridMajor : UI.grid;
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(sceneW, y);
		ctx.stroke();
	}
	ctx.restore();
}

// ─── Rulers ───────────────────────────────────────────────────────────

/** Choose a tick spacing that keeps labels ~60px apart. */
function tickStep(zoom: number): number {
	const target = 60 / zoom;
	const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1e-6))));
	for (const m of [1, 2, 5, 10]) {
		if (pow * m >= target) return pow * m;
	}
	return pow * 10;
}

export function drawRulers(
	ctx: CanvasRenderingContext2D,
	vp: Viewport,
	W: number,
	H: number,
	cursor: Pt | null,
	selection: BBox | null,
) {
	const S = RULER_SIZE;
	const step = tickStep(vp.zoom);

	ctx.save();
	ctx.fillStyle = UI.ruler;
	ctx.fillRect(0, 0, W, S);
	ctx.fillRect(0, 0, S, H);
	ctx.strokeStyle = UI.rulerLine;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(0, S + 0.5);
	ctx.lineTo(W, S + 0.5);
	ctx.moveTo(S + 0.5, 0);
	ctx.lineTo(S + 0.5, H);
	ctx.stroke();

	// Selection extent shading
	if (selection) {
		ctx.fillStyle = "rgba(99,102,241,0.28)";
		const x0 = selection.x * vp.zoom + vp.panX;
		const x1 = (selection.x + selection.w) * vp.zoom + vp.panX;
		ctx.fillRect(x0, 0, Math.max(1, x1 - x0), S);
		const y0 = selection.y * vp.zoom + vp.panY;
		const y1 = (selection.y + selection.h) * vp.zoom + vp.panY;
		ctx.fillRect(0, y0, S, Math.max(1, y1 - y0));
	}

	ctx.font = "9px ui-monospace, monospace";
	ctx.fillStyle = UI.rulerText;
	ctx.strokeStyle = "#2a2a2a";

	const sceneLeft = (S - vp.panX) / vp.zoom;
	const sceneRight = (W - vp.panX) / vp.zoom;
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	for (
		let v = Math.ceil(sceneLeft / step) * step;
		v <= sceneRight;
		v += step
	) {
		const x = Math.round(v * vp.zoom + vp.panX) + 0.5;
		ctx.beginPath();
		ctx.moveTo(x, S - 5);
		ctx.lineTo(x, S);
		ctx.stroke();
		ctx.fillText(String(Math.round(v)), x + 2, S - 7);
	}

	const sceneTop = (S - vp.panY) / vp.zoom;
	const sceneBottom = (H - vp.panY) / vp.zoom;
	for (let v = Math.ceil(sceneTop / step) * step; v <= sceneBottom; v += step) {
		const y = Math.round(v * vp.zoom + vp.panY) + 0.5;
		ctx.beginPath();
		ctx.moveTo(S - 5, y);
		ctx.lineTo(S, y);
		ctx.stroke();
		ctx.save();
		ctx.translate(S - 7, y - 2);
		ctx.rotate(-Math.PI / 2);
		ctx.fillText(String(Math.round(v)), 0, 0);
		ctx.restore();
	}

	// Cursor crosshair markers
	if (cursor) {
		ctx.fillStyle = UI.accent;
		const cx = cursor.x * vp.zoom + vp.panX;
		const cy = cursor.y * vp.zoom + vp.panY;
		ctx.fillRect(cx, 0, 1, S);
		ctx.fillRect(0, cy, S, 1);
	}

	// Corner square
	ctx.fillStyle = UI.ruler;
	ctx.fillRect(0, 0, S, S);
	ctx.strokeStyle = UI.rulerLine;
	ctx.strokeRect(0.5, 0.5, S, S);
	ctx.restore();
}

// ─── Marquee ──────────────────────────────────────────────────────────

export function drawMarquee(ctx: CanvasRenderingContext2D, r: BBox) {
	ctx.save();
	ctx.fillStyle = "rgba(99,102,241,0.10)";
	ctx.strokeStyle = UI.accent;
	ctx.lineWidth = 1;
	ctx.setLineDash([3, 2]);
	ctx.fillRect(r.x, r.y, r.w, r.h);
	ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
	ctx.restore();
}

// ─── Measurement badge ────────────────────────────────────────────────

export function drawBadge(
	ctx: CanvasRenderingContext2D,
	text: string,
	p: Pt,
	accent = UI.accent,
) {
	ctx.save();
	ctx.font = "10px ui-monospace, monospace";
	const w = ctx.measureText(text).width + 10;
	const h = 16;
	const x = p.x;
	const y = p.y;
	ctx.fillStyle = accent;
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, 3);
	ctx.fill();
	ctx.fillStyle = "#ffffff";
	ctx.textBaseline = "middle";
	ctx.fillText(text, x + 5, y + h / 2 + 0.5);
	ctx.restore();
}

/** Combined local→screen matrix for an element. */
export const screenMat = (elementMat: Mat, vp: Viewport): Mat =>
	matMul(viewportMat(vp), elementMat);

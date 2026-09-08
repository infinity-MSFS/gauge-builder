import type {
	BoundValue,
	ElementKind,
	GroupKind,
	PathCmd,
	PathKind,
	SceneElement,
	VarEntry,
} from "../store/sceneStore";

// ─── Affine matrix (a c e / b d f / 0 0 1) ────────────────────────────

export interface Mat {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** m ∘ n — applies `n` first, then `m`. */
export function matMul(m: Mat, n: Mat): Mat {
	return {
		a: m.a * n.a + m.c * n.b,
		b: m.b * n.a + m.d * n.b,
		c: m.a * n.c + m.c * n.d,
		d: m.b * n.c + m.d * n.d,
		e: m.a * n.e + m.c * n.f + m.e,
		f: m.b * n.e + m.d * n.f + m.f,
	};
}

export function matApply(m: Mat, x: number, y: number): Pt {
	return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Transform a direction (ignores translation). */
export function matApplyVec(m: Mat, x: number, y: number): Pt {
	return { x: m.a * x + m.c * y, y: m.b * x + m.d * y };
}

export function matInvert(m: Mat): Mat {
	const det = m.a * m.d - m.b * m.c;
	if (Math.abs(det) < 1e-12) return IDENTITY;
	return {
		a: m.d / det,
		b: -m.b / det,
		c: -m.c / det,
		d: m.a / det,
		e: (m.c * m.f - m.d * m.e) / det,
		f: (m.b * m.e - m.a * m.f) / det,
	};
}

/** Translate → rotate(deg) → scale, about `pivot` in the local frame. */
export function matTRS(
	tx: number,
	ty: number,
	rotDeg: number,
	sx: number,
	sy: number,
	px = 0,
	py = 0,
): Mat {
	const r = (rotDeg * Math.PI) / 180;
	const cos = Math.cos(r);
	const sin = Math.sin(r);
	// T(t) · T(p) · R · S · T(-p)
	const rs: Mat = { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, e: 0, f: 0 };
	const pre = matMul({ a: 1, b: 0, c: 0, d: 1, e: tx + px, f: ty + py }, rs);
	return matMul(pre, { a: 1, b: 0, c: 0, d: 1, e: -px, f: -py });
}

/** Uniform-ish scale factor of a matrix, for sizing screen-space affordances. */
export function matScale(m: Mat): number {
	return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

// ─── Points and boxes ─────────────────────────────────────────────────

export interface Pt {
	x: number;
	y: number;
}

export interface BBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const bboxCenter = (b: BBox): Pt => ({
	x: b.x + b.w / 2,
	y: b.y + b.h / 2,
});

export function bboxUnion(a: BBox | null, b: BBox | null): BBox | null {
	if (!a) return b;
	if (!b) return a;
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		w: Math.max(a.x + a.w, b.x + b.w) - x,
		h: Math.max(a.y + a.h, b.y + b.h) - y,
	};
}

export function bboxFromPts(pts: Pt[]): BBox | null {
	if (pts.length === 0) return null;
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const p of pts) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const bboxContains = (b: BBox, p: Pt): boolean =>
	p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

export const bboxIntersects = (a: BBox, b: BBox): boolean =>
	a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The four corners of a box, in TL, TR, BR, BL order. */
export const bboxCorners = (b: BBox): Pt[] => [
	{ x: b.x, y: b.y },
	{ x: b.x + b.w, y: b.y },
	{ x: b.x + b.w, y: b.y + b.h },
	{ x: b.x, y: b.y + b.h },
];

/** Axis-aligned box enclosing `b` after `m` — used for snapping and marquee. */
export function bboxTransform(b: BBox, m: Mat): BBox {
	return bboxFromPts(bboxCorners(b).map((p) => matApply(m, p.x, p.y)))!;
}

// ─── BoundValue helpers ───────────────────────────────────────────────

export function rv(bv: BoundValue | undefined, vars: Map<string, number>): number {
	if (!bv) return 0;
	switch (bv.type) {
		case "Literal":
			return bv.value;
		case "LVar":
		case "AVar":
			return vars.get(bv.name) ?? 0;
		case "Expr":
			return 0;
	}
}

export const lit = (v: number): BoundValue => ({ type: "Literal", value: v });

/** Nudge a literal; bound values are left alone so bindings survive dragging. */
export const litAdd = (bv: BoundValue, d: number): BoundValue =>
	bv.type === "Literal" ? { type: "Literal", value: bv.value + d } : bv;

export const litSet = (bv: BoundValue, v: number): BoundValue =>
	bv.type === "Literal" ? { type: "Literal", value: v } : bv;

export const isLiteral = (bv: BoundValue | undefined): boolean =>
	!!bv && bv.type === "Literal";

export const varMapOf = (vars: VarEntry[]): Map<string, number> =>
	new Map(vars.map((v) => [v.id, v.preview_value]));

// ─── Path node model ──────────────────────────────────────────────────
//
// PathCmd is a flat NanoVG command list; editing wants anchors with in/out
// handles. These two functions round-trip between them, preserving each
// coordinate's original BoundValue so bindings are not flattened to literals.

export interface PathNode {
	x: number;
	y: number;
	/** Original bound values, kept so a binding survives an edit elsewhere. */
	xbv: BoundValue;
	ybv: BoundValue;
	/** Incoming control point (absolute), or null for a corner. */
	hIn: Pt | null;
	/** Outgoing control point (absolute), or null for a corner. */
	hOut: Pt | null;
}

export interface PathShape {
	nodes: PathNode[];
	closed: boolean;
}

export function pathToNodes(
	commands: PathCmd[],
	vars: Map<string, number>,
): PathShape {
	const nodes: PathNode[] = [];
	let closed = false;
	for (const cmd of commands) {
		switch (cmd.type) {
			case "MoveTo":
			case "LineTo": {
				nodes.push({
					x: rv(cmd.x, vars),
					y: rv(cmd.y, vars),
					xbv: cmd.x,
					ybv: cmd.y,
					hIn: null,
					hOut: null,
				});
				break;
			}
			case "BezierTo": {
				const prev = nodes[nodes.length - 1];
				if (prev) {
					prev.hOut = { x: rv(cmd.c1x, vars), y: rv(cmd.c1y, vars) };
				}
				nodes.push({
					x: rv(cmd.x, vars),
					y: rv(cmd.y, vars),
					xbv: cmd.x,
					ybv: cmd.y,
					hIn: { x: rv(cmd.c2x, vars), y: rv(cmd.c2y, vars) },
					hOut: null,
				});
				break;
			}
			case "ClosePath":
				closed = true;
				break;
		}
	}
	// A closed path usually ends by drawing back onto its start point. That
	// trailing command is the same anchor as node 0, so fold it in — otherwise
	// every edit round-trip would grow the path by one anchor.
	if (closed && nodes.length > 1) {
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-6) {
			first.hIn = last.hIn;
			nodes.pop();
		}
	}
	return { nodes, closed };
}

/** Emit the BoundValue for a node coordinate, keeping a binding if unmoved. */
function coord(orig: BoundValue, value: number): BoundValue {
	if (orig.type !== "Literal") {
		// A bound coordinate cannot be expressed as a moved literal — keep it.
		return orig;
	}
	return { type: "Literal", value };
}

export function nodesToPath(shape: PathShape): PathCmd[] {
	const { nodes, closed } = shape;
	if (nodes.length === 0) return [];
	const cmds: PathCmd[] = [
		{
			type: "MoveTo",
			x: coord(nodes[0].xbv, nodes[0].x),
			y: coord(nodes[0].ybv, nodes[0].y),
		},
	];

	const segment = (from: PathNode, to: PathNode) => {
		if (from.hOut || to.hIn) {
			const c1 = from.hOut ?? { x: from.x, y: from.y };
			const c2 = to.hIn ?? { x: to.x, y: to.y };
			cmds.push({
				type: "BezierTo",
				c1x: lit(c1.x),
				c1y: lit(c1.y),
				c2x: lit(c2.x),
				c2y: lit(c2.y),
				x: coord(to.xbv, to.x),
				y: coord(to.ybv, to.y),
			});
		} else {
			cmds.push({
				type: "LineTo",
				x: coord(to.xbv, to.x),
				y: coord(to.ybv, to.y),
			});
		}
	};

	for (let i = 1; i < nodes.length; i++) segment(nodes[i - 1], nodes[i]);
	if (closed && nodes.length > 1) {
		const last = nodes[nodes.length - 1];
		// ClosePath already draws a straight line home; only a curved closing
		// segment needs an explicit command.
		if (last.hOut || nodes[0].hIn) segment(last, nodes[0]);
		cmds.push({ type: "ClosePath" });
	}
	return cmds;
}

/** Build a fresh node with no handles. */
export const cornerNode = (x: number, y: number): PathNode => ({
	x,
	y,
	xbv: lit(x),
	ybv: lit(y),
	hIn: null,
	hOut: null,
});

/** True when both handles sit opposite each other — a smooth anchor. */
export function isSmooth(n: PathNode): boolean {
	if (!n.hIn || !n.hOut) return false;
	const ix = n.x - n.hIn.x;
	const iy = n.y - n.hIn.y;
	const ox = n.hOut.x - n.x;
	const oy = n.hOut.y - n.y;
	const li = Math.hypot(ix, iy);
	const lo = Math.hypot(ox, oy);
	if (li < 1e-6 || lo < 1e-6) return false;
	// Colinear and same direction.
	return Math.abs((ix / li) * (oy / lo) - (iy / li) * (ox / lo)) < 0.02;
}

// ─── Cubic bezier bounds ──────────────────────────────────────────────

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number) {
	const mt = 1 - t;
	return (
		mt * mt * mt * p0 +
		3 * mt * mt * t * p1 +
		3 * mt * t * t * p2 +
		t * t * t * p3
	);
}

/** Exact extrema of one cubic axis, clamped to the [0,1] parameter range. */
function cubicExtrema(
	p0: number,
	p1: number,
	p2: number,
	p3: number,
): number[] {
	const out = [p0, p3];
	const a = -p0 + 3 * p1 - 3 * p2 + p3;
	const b = 2 * (p0 - 2 * p1 + p2);
	const c = p1 - p0;
	const push = (t: number) => {
		if (t > 0 && t < 1) out.push(cubicAt(p0, p1, p2, p3, t));
	};
	if (Math.abs(a) < 1e-9) {
		if (Math.abs(b) > 1e-9) push(-c / b);
	} else {
		const disc = b * b - 4 * a * c;
		if (disc >= 0) {
			const sq = Math.sqrt(disc);
			push((-b + sq) / (2 * a));
			push((-b - sq) / (2 * a));
		}
	}
	return out;
}

export function pathBBox(shape: PathShape): BBox | null {
	const { nodes, closed } = shape;
	if (nodes.length === 0) return null;
	if (nodes.length === 1) {
		return { x: nodes[0].x, y: nodes[0].y, w: 0, h: 0 };
	}
	const xs: number[] = [];
	const ys: number[] = [];
	const seg = (from: PathNode, to: PathNode) => {
		if (from.hOut || to.hIn) {
			const c1 = from.hOut ?? { x: from.x, y: from.y };
			const c2 = to.hIn ?? { x: to.x, y: to.y };
			xs.push(...cubicExtrema(from.x, c1.x, c2.x, to.x));
			ys.push(...cubicExtrema(from.y, c1.y, c2.y, to.y));
		} else {
			xs.push(from.x, to.x);
			ys.push(from.y, to.y);
		}
	};
	for (let i = 1; i < nodes.length; i++) seg(nodes[i - 1], nodes[i]);
	if (closed) seg(nodes[nodes.length - 1], nodes[0]);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return {
		x: minX,
		y: minY,
		w: Math.max(...xs) - minX,
		h: Math.max(...ys) - minY,
	};
}

/** A Path2D in the element's local space, for hit-testing and drawing. */
export function pathToPath2D(commands: PathCmd[], vars: Map<string, number>): Path2D {
	const p = new Path2D();
	for (const cmd of commands) {
		switch (cmd.type) {
			case "MoveTo":
				p.moveTo(rv(cmd.x, vars), rv(cmd.y, vars));
				break;
			case "LineTo":
				p.lineTo(rv(cmd.x, vars), rv(cmd.y, vars));
				break;
			case "BezierTo":
				p.bezierCurveTo(
					rv(cmd.c1x, vars),
					rv(cmd.c1y, vars),
					rv(cmd.c2x, vars),
					rv(cmd.c2y, vars),
					rv(cmd.x, vars),
					rv(cmd.y, vars),
				);
				break;
			case "ClosePath":
				p.closePath();
				break;
		}
	}
	return p;
}

// ─── Element bounding boxes (in the element's own parent space) ───────

/**
 * Text width for bounding boxes. Falls back to an average-glyph estimate when
 * there is no DOM to measure with (tests, or any headless consumer).
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureText(text: string, fontSize: number, font: string): number {
	if (measureCtx === undefined) {
		measureCtx =
			typeof document === "undefined"
				? null
				: document.createElement("canvas").getContext("2d");
	}
	if (!measureCtx) return text.length * fontSize * 0.55;
	measureCtx.font = `${fontSize}px ${font || "sans-serif"}`;
	return measureCtx.measureText(text).width;
}

export function textOf(
	kind: Extract<ElementKind, { type: "Text" }>,
	vars: Map<string, number>,
): string {
	if (kind.text) return kind.text;
	const n = rv(kind.content, vars);
	return n.toFixed(kind.decimals ?? 0);
}

export function getLocalBBox(
	el: SceneElement,
	vars: Map<string, number>,
): BBox | null {
	const k = el.kind;
	switch (k.type) {
		case "Rect": {
			const x = rv(k.x, vars),
				y = rv(k.y, vars),
				w = rv(k.w, vars),
				h = rv(k.h, vars);
			return {
				x: Math.min(x, x + w),
				y: Math.min(y, y + h),
				w: Math.abs(w),
				h: Math.abs(h),
			};
		}
		case "Circle":
		case "Arc": {
			const r = Math.abs(rv(k.r, vars)),
				cx = rv(k.cx, vars),
				cy = rv(k.cy, vars);
			return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
		}
		case "Line": {
			const x1 = rv(k.x1, vars),
				y1 = rv(k.y1, vars),
				x2 = rv(k.x2, vars),
				y2 = rv(k.y2, vars);
			return {
				x: Math.min(x1, x2),
				y: Math.min(y1, y2),
				w: Math.abs(x2 - x1),
				h: Math.abs(y2 - y1),
			};
		}
		case "Text": {
			const x = rv(k.x, vars),
				y = rv(k.y, vars),
				fs = rv(k.font_size, vars);
			const w = measureText(textOf(k, vars), fs, k.font);
			const h = fs * 1.2;
			// Place the box according to the nvg alignment flags.
			let bx = x;
			if (k.align_h === "Center") bx = x - w / 2;
			else if (k.align_h === "Right") bx = x - w;
			let by = y;
			if (k.align_v === "Top") by = y;
			else if (k.align_v === "Middle") by = y - h / 2;
			else by = y - fs * 0.92; // Bottom and Baseline are close enough here
			return { x: bx, y: by, w, h };
		}
		case "Path":
			return pathBBox(pathToNodes(k.commands, vars));
		case "Group": {
			let acc: BBox | null = null;
			for (const child of k.children) {
				const cb = getLocalBBox(child, vars);
				if (!cb) continue;
				acc = bboxUnion(acc, bboxTransform(cb, childMatrix(child, vars)));
			}
			const self = groupMatrix(k, vars);
			if (!acc) {
				const o = matApply(self, 0, 0);
				return { x: o.x, y: o.y, w: 0, h: 0 };
			}
			return bboxTransform(acc, self);
		}
	}
}

/** A group's own local→parent transform. */
export function groupMatrix(k: GroupKind, vars: Map<string, number>): Mat {
	return matTRS(
		rv(k.translate_x, vars),
		rv(k.translate_y, vars),
		rv(k.rotate, vars),
		rv(k.scale_x, vars) || 1,
		rv(k.scale_y, vars) || 1,
		rv(k.pivot_x, vars),
		rv(k.pivot_y, vars),
	);
}

/** Transform contributed by an element itself (identity for leaf shapes). */
function childMatrix(el: SceneElement, vars: Map<string, number>): Mat {
	return el.kind.type === "Group" ? groupMatrix(el.kind, vars) : IDENTITY;
}

// ─── Flattened scene ─────────────────────────────────────────────────

export interface SceneNode {
	el: SceneElement;
	/** Local → scene transform of the element's own coordinate space. */
	mat: Mat;
	/** Ancestor ids, outermost first. */
	ancestors: string[];
	depth: number;
	/** True when the element or any ancestor is hidden. */
	hidden: boolean;
	/** True when the element or any ancestor is locked. */
	locked: boolean;
	/** Local-space bbox (already includes a group's own transform). */
	bbox: BBox | null;
	/** Scene-space axis-aligned bbox. */
	sceneBBox: BBox | null;
}

/**
 * Walk the tree once and produce a flat, render-ordered list carrying each
 * element's accumulated transform. Everything else (hit-testing, snapping,
 * overlays, align) reads from this.
 */
export function flattenScene(
	elements: SceneElement[],
	vars: Map<string, number>,
): SceneNode[] {
	const out: SceneNode[] = [];
	const walk = (
		list: SceneElement[],
		parentMat: Mat,
		ancestors: string[],
		hidden: boolean,
		locked: boolean,
	) => {
		for (const el of list) {
			const h = hidden || !el.visible;
			const l = locked || el.locked;
			const bbox = getLocalBBox(el, vars);
			// A group's own transform is folded into `mat` for its children, but
			// its bbox is already expressed in the parent frame.
			const node: SceneNode = {
				el,
				mat: parentMat,
				ancestors,
				depth: ancestors.length,
				hidden: h,
				locked: l,
				bbox,
				sceneBBox: bbox ? bboxTransform(bbox, parentMat) : null,
			};
			out.push(node);
			if (el.kind.type === "Group") {
				walk(
					el.kind.children,
					matMul(parentMat, groupMatrix(el.kind, vars)),
					[...ancestors, el.id],
					h,
					l,
				);
			}
		}
	};
	walk(elements, IDENTITY, [], false, false);
	return out;
}

export const nodeById = (nodes: SceneNode[], id: string): SceneNode | null =>
	nodes.find((n) => n.el.id === id) ?? null;

// ─── Hit testing ──────────────────────────────────────────────────────

/**
 * Precise hit test in the element's own local space. `tol` is a scene-space
 * tolerance so thin strokes stay clickable at any zoom.
 */
export function hitElement(
	ctx: CanvasRenderingContext2D,
	node: SceneNode,
	scenePt: Pt,
	vars: Map<string, number>,
	tol: number,
): boolean {
	const inv = matInvert(node.mat);
	const p = matApply(inv, scenePt.x, scenePt.y);
	const k = node.el.kind;
	const style = "style" in k ? k.style : null;
	const strokeW = style?.stroke ? style.stroke_width : 0;
	const pad = tol + strokeW / 2;

	switch (k.type) {
		case "Rect": {
			const b = node.bbox;
			if (!b) return false;
			if (style?.fill) return bboxContains(pad0(b, pad), p);
			return onRectEdge(b, p, pad);
		}
		case "Circle": {
			const cx = rv(k.cx, vars),
				cy = rv(k.cy, vars),
				r = Math.abs(rv(k.r, vars));
			const d = Math.hypot(p.x - cx, p.y - cy);
			return style?.fill ? d <= r + pad : Math.abs(d - r) <= pad;
		}
		case "Arc": {
			const cx = rv(k.cx, vars),
				cy = rv(k.cy, vars),
				r = Math.abs(rv(k.r, vars));
			const d = Math.hypot(p.x - cx, p.y - cy);
			if (Math.abs(d - r) > pad && !style?.fill) return false;
			if (style?.fill && d > r + pad) return false;
			// Angular span check
			let a = Math.atan2(p.y - cy, p.x - cx);
			const a0 = rv(k.a0, vars);
			const a1 = rv(k.a1, vars);
			const norm = (v: number) => ((v % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
			const s = norm(k.dir === "Ccw" ? a1 : a0);
			const e = norm(k.dir === "Ccw" ? a0 : a1);
			a = norm(a);
			const span = e >= s ? e - s : e - s + Math.PI * 2;
			const rel = a >= s ? a - s : a - s + Math.PI * 2;
			return rel <= span + 1e-6;
		}
		case "Line": {
			return (
				distToSegment(
					p,
					{ x: rv(k.x1, vars), y: rv(k.y1, vars) },
					{ x: rv(k.x2, vars), y: rv(k.y2, vars) },
				) <= pad
			);
		}
		case "Text":
			return node.bbox ? bboxContains(pad0(node.bbox, tol), p) : false;
		case "Path": {
			const p2d = pathToPath2D(k.commands, vars);
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.lineWidth = Math.max(strokeW, tol * 2);
			const hit =
				(!!style?.fill && ctx.isPointInPath(p2d, p.x, p.y)) ||
				ctx.isPointInStroke(p2d, p.x, p.y);
			ctx.restore();
			return hit;
		}
		case "Group": {
			// Groups are only hit through their children.
			return false;
		}
	}
}

const pad0 = (b: BBox, p: number): BBox => ({
	x: b.x - p,
	y: b.y - p,
	w: b.w + 2 * p,
	h: b.h + 2 * p,
});

function onRectEdge(b: BBox, p: Pt, pad: number): boolean {
	if (!bboxContains(pad0(b, pad), p)) return false;
	const inner = { x: b.x + pad, y: b.y + pad, w: b.w - 2 * pad, h: b.h - 2 * pad };
	if (inner.w <= 0 || inner.h <= 0) return true;
	return !bboxContains(inner, p);
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ─── Element transforms ───────────────────────────────────────────────

export function moveElementKind(
	kind: ElementKind,
	dx: number,
	dy: number,
): ElementKind {
	switch (kind.type) {
		case "Rect":
		case "Text":
			return { ...kind, x: litAdd(kind.x, dx), y: litAdd(kind.y, dy) };
		case "Circle":
		case "Arc":
			return { ...kind, cx: litAdd(kind.cx, dx), cy: litAdd(kind.cy, dy) };
		case "Line":
			return {
				...kind,
				x1: litAdd(kind.x1, dx),
				y1: litAdd(kind.y1, dy),
				x2: litAdd(kind.x2, dx),
				y2: litAdd(kind.y2, dy),
			};
		case "Path":
			return {
				...kind,
				commands: kind.commands.map((cmd) => {
					if (cmd.type === "MoveTo" || cmd.type === "LineTo")
						return { ...cmd, x: litAdd(cmd.x, dx), y: litAdd(cmd.y, dy) };
					if (cmd.type === "BezierTo")
						return {
							...cmd,
							x: litAdd(cmd.x, dx),
							y: litAdd(cmd.y, dy),
							c1x: litAdd(cmd.c1x, dx),
							c1y: litAdd(cmd.c1y, dy),
							c2x: litAdd(cmd.c2x, dx),
							c2y: litAdd(cmd.c2y, dy),
						};
					return cmd;
				}),
			};
		case "Group":
			return {
				...kind,
				translate_x: litAdd(kind.translate_x, dx),
				translate_y: litAdd(kind.translate_y, dy),
			};
	}
}

/**
 * Scale an element so its local bbox maps from `from` to `to`. Used by both
 * single-element resize handles and multi-selection scaling.
 */
export function scaleElementKind(
	kind: ElementKind,
	from: BBox,
	to: BBox,
	vars: Map<string, number>,
): ElementKind {
	const sx = from.w > 1e-6 ? to.w / from.w : 1;
	const sy = from.h > 1e-6 ? to.h / from.h : 1;
	const mapX = (x: number) => to.x + (x - from.x) * sx;
	const mapY = (y: number) => to.y + (y - from.y) * sy;

	switch (kind.type) {
		case "Rect": {
			const x = rv(kind.x, vars),
				y = rv(kind.y, vars),
				w = rv(kind.w, vars),
				h = rv(kind.h, vars);
			return {
				...kind,
				x: litSet(kind.x, mapX(x)),
				y: litSet(kind.y, mapY(y)),
				w: litSet(kind.w, w * sx),
				h: litSet(kind.h, h * sy),
			};
		}
		case "Circle":
		case "Arc": {
			const cx = rv(kind.cx, vars),
				cy = rv(kind.cy, vars),
				r = rv(kind.r, vars);
			// Circles and arcs stay round; take the smaller axis so they fit.
			return {
				...kind,
				cx: litSet(kind.cx, mapX(cx)),
				cy: litSet(kind.cy, mapY(cy)),
				r: litSet(kind.r, Math.max(0.5, r * Math.min(Math.abs(sx), Math.abs(sy)))),
			};
		}
		case "Line":
			return {
				...kind,
				x1: litSet(kind.x1, mapX(rv(kind.x1, vars))),
				y1: litSet(kind.y1, mapY(rv(kind.y1, vars))),
				x2: litSet(kind.x2, mapX(rv(kind.x2, vars))),
				y2: litSet(kind.y2, mapY(rv(kind.y2, vars))),
			};
		case "Text": {
			const fs = rv(kind.font_size, vars);
			return {
				...kind,
				x: litSet(kind.x, mapX(rv(kind.x, vars))),
				y: litSet(kind.y, mapY(rv(kind.y, vars))),
				font_size: litSet(
					kind.font_size,
					Math.max(1, fs * Math.min(Math.abs(sx), Math.abs(sy))),
				),
			};
		}
		case "Path":
			return {
				...kind,
				commands: kind.commands.map((cmd) => {
					if (cmd.type === "MoveTo" || cmd.type === "LineTo")
						return {
							...cmd,
							x: litSet(cmd.x, mapX(rv(cmd.x, vars))),
							y: litSet(cmd.y, mapY(rv(cmd.y, vars))),
						};
					if (cmd.type === "BezierTo")
						return {
							...cmd,
							c1x: litSet(cmd.c1x, mapX(rv(cmd.c1x, vars))),
							c1y: litSet(cmd.c1y, mapY(rv(cmd.c1y, vars))),
							c2x: litSet(cmd.c2x, mapX(rv(cmd.c2x, vars))),
							c2y: litSet(cmd.c2y, mapY(rv(cmd.c2y, vars))),
							x: litSet(cmd.x, mapX(rv(cmd.x, vars))),
							y: litSet(cmd.y, mapY(rv(cmd.y, vars))),
						};
					return cmd;
				}),
			};
		case "Group": {
			const tx = rv(kind.translate_x, vars);
			const ty = rv(kind.translate_y, vars);
			return {
				...kind,
				translate_x: litSet(kind.translate_x, mapX(tx)),
				translate_y: litSet(kind.translate_y, mapY(ty)),
				scale_x: litSet(kind.scale_x, rv(kind.scale_x, vars) * sx),
				scale_y: litSet(kind.scale_y, rv(kind.scale_y, vars) * sy),
			};
		}
	}
}

/** Can this element be dragged at all? Fully-bound geometry cannot. */
export function isMovable(kind: ElementKind): boolean {
	switch (kind.type) {
		case "Rect":
		case "Text":
			return isLiteral(kind.x) || isLiteral(kind.y);
		case "Circle":
		case "Arc":
			return isLiteral(kind.cx) || isLiteral(kind.cy);
		case "Line":
			return isLiteral(kind.x1) || isLiteral(kind.y1);
		case "Path":
			return true;
		case "Group":
			return isLiteral(kind.translate_x) || isLiteral(kind.translate_y);
	}
}

// ─── Tree edits (local, pre-commit) ───────────────────────────────────

export function updateElementInTree(
	elements: SceneElement[],
	patches: Map<string, ElementKind>,
): SceneElement[] {
	return elements.map((el) => {
		const patch = patches.get(el.id);
		const next = patch ? { ...el, kind: patch } : el;
		if (next.kind.type === "Group") {
			return {
				...next,
				kind: {
					...next.kind,
					children: updateElementInTree(next.kind.children, patches),
				},
			};
		}
		return next;
	});
}

export function pathKindFromShape(kind: PathKind, shape: PathShape): PathKind {
	return { ...kind, commands: nodesToPath(shape) };
}

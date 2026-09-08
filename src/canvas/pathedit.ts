import {
	cornerNode,
	isSmooth,
	lit,
	type PathNode,
	type PathShape,
	type Pt,
} from "./geometry";

// ─── Segment sampling ─────────────────────────────────────────────────

export interface Segment {
	/** Index of the node the segment starts at. */
	i: number;
	a: PathNode;
	b: PathNode;
	c1: Pt;
	c2: Pt;
	curved: boolean;
}

export function segments(shape: PathShape): Segment[] {
	const out: Segment[] = [];
	const push = (i: number, a: PathNode, b: PathNode) => {
		const c1 = a.hOut ?? { x: a.x, y: a.y };
		const c2 = b.hIn ?? { x: b.x, y: b.y };
		out.push({ i, a, b, c1, c2, curved: !!(a.hOut || b.hIn) });
	};
	for (let i = 1; i < shape.nodes.length; i++)
		push(i - 1, shape.nodes[i - 1], shape.nodes[i]);
	if (shape.closed && shape.nodes.length > 1)
		push(shape.nodes.length - 1, shape.nodes[shape.nodes.length - 1], shape.nodes[0]);
	return out;
}

export function pointOnSegment(s: Segment, t: number): Pt {
	if (!s.curved) {
		return {
			x: s.a.x + (s.b.x - s.a.x) * t,
			y: s.a.y + (s.b.y - s.a.y) * t,
		};
	}
	const mt = 1 - t;
	const w0 = mt * mt * mt;
	const w1 = 3 * mt * mt * t;
	const w2 = 3 * mt * t * t;
	const w3 = t * t * t;
	return {
		x: w0 * s.a.x + w1 * s.c1.x + w2 * s.c2.x + w3 * s.b.x,
		y: w0 * s.a.y + w1 * s.c1.y + w2 * s.c2.y + w3 * s.b.y,
	};
}

/** Nearest point on the path to `p`, by sampling each segment. */
export function closestOnPath(
	shape: PathShape,
	p: Pt,
	samples = 24,
): { seg: Segment; t: number; pt: Pt; dist: number } | null {
	let best: { seg: Segment; t: number; pt: Pt; dist: number } | null = null;
	for (const s of segments(shape)) {
		for (let k = 0; k <= samples; k++) {
			const t = k / samples;
			const q = pointOnSegment(s, t);
			const d = Math.hypot(q.x - p.x, q.y - p.y);
			if (!best || d < best.dist) best = { seg: s, t, pt: q, dist: d };
		}
	}
	return best;
}

// ─── Editing ──────────────────────────────────────────────────────────

const clone = (n: PathNode): PathNode => ({
	...n,
	hIn: n.hIn ? { ...n.hIn } : null,
	hOut: n.hOut ? { ...n.hOut } : null,
});

export const cloneShape = (s: PathShape): PathShape => ({
	nodes: s.nodes.map(clone),
	closed: s.closed,
});

/** Split a segment at `t` with de Casteljau, preserving the curve exactly. */
export function insertNode(shape: PathShape, seg: Segment, t: number): PathShape {
	const next = cloneShape(shape);
	const ai = seg.i;
	const bi = (seg.i + 1) % shape.nodes.length;
	const a = next.nodes[ai];
	const b = next.nodes[bi];

	if (!seg.curved) {
		const p = pointOnSegment(seg, t);
		const nn = cornerNode(p.x, p.y);
		next.nodes.splice(ai + 1, 0, nn);
		return next;
	}

	const lerp = (p: Pt, q: Pt): Pt => ({
		x: p.x + (q.x - p.x) * t,
		y: p.y + (q.y - p.y) * t,
	});
	const p0 = { x: seg.a.x, y: seg.a.y };
	const p3 = { x: seg.b.x, y: seg.b.y };
	const q0 = lerp(p0, seg.c1);
	const q1 = lerp(seg.c1, seg.c2);
	const q2 = lerp(seg.c2, p3);
	const r0 = lerp(q0, q1);
	const r1 = lerp(q1, q2);
	const mid = lerp(r0, r1);

	a.hOut = q0;
	b.hIn = q2;
	const nn: PathNode = {
		x: mid.x,
		y: mid.y,
		xbv: lit(mid.x),
		ybv: lit(mid.y),
		hIn: r0,
		hOut: r1,
	};
	next.nodes.splice(ai + 1, 0, nn);
	return next;
}

export function deleteNodes(shape: PathShape, idxs: number[]): PathShape {
	const drop = new Set(idxs);
	const nodes = shape.nodes.filter((_, i) => !drop.has(i)).map(clone);
	return { nodes, closed: nodes.length > 2 ? shape.closed : false };
}

/** Corner ⇄ smooth. Smoothing derives handles from the neighbouring anchors. */
export function toggleSmooth(shape: PathShape, idx: number): PathShape {
	const next = cloneShape(shape);
	const n = next.nodes[idx];
	if (!n) return next;
	if (n.hIn || n.hOut) {
		n.hIn = null;
		n.hOut = null;
		return next;
	}
	const count = next.nodes.length;
	const prev = next.nodes[(idx - 1 + count) % count];
	const nxt = next.nodes[(idx + 1) % count];
	if (!prev || !nxt || count < 2) return next;
	// Tangent along the neighbours, a third of the way out either side.
	const tx = (nxt.x - prev.x) / 2;
	const ty = (nxt.y - prev.y) / 2;
	const len = Math.hypot(tx, ty) || 1;
	const inLen = Math.min(Math.hypot(n.x - prev.x, n.y - prev.y) / 3, len);
	const outLen = Math.min(Math.hypot(nxt.x - n.x, nxt.y - n.y) / 3, len);
	n.hIn = { x: n.x - (tx / len) * inLen, y: n.y - (ty / len) * inLen };
	n.hOut = { x: n.x + (tx / len) * outLen, y: n.y + (ty / len) * outLen };
	return next;
}

/**
 * Move one control handle. Unless `breakSymmetry`, the opposite handle mirrors
 * the new direction (keeping its own length), which is how Illustrator behaves
 * on a smooth anchor.
 */
export function moveHandle(
	shape: PathShape,
	idx: number,
	which: "in" | "out",
	to: Pt,
	breakSymmetry: boolean,
): PathShape {
	const next = cloneShape(shape);
	const n = next.nodes[idx];
	if (!n) return next;
	const wasSmooth = isSmooth(shape.nodes[idx]);
	if (which === "in") n.hIn = { ...to };
	else n.hOut = { ...to };

	if (breakSymmetry || !wasSmooth) return next;

	const other = which === "in" ? n.hOut : n.hIn;
	if (!other) return next;
	const dx = to.x - n.x;
	const dy = to.y - n.y;
	const len = Math.hypot(dx, dy);
	if (len < 1e-6) return next;
	const otherLen = Math.hypot(other.x - n.x, other.y - n.y);
	const mirrored = {
		x: n.x - (dx / len) * otherLen,
		y: n.y - (dy / len) * otherLen,
	};
	if (which === "in") n.hOut = mirrored;
	else n.hIn = mirrored;
	return next;
}

/** Translate whole anchors (and their handles) by a delta. */
export function moveNodes(
	shape: PathShape,
	idxs: number[],
	dx: number,
	dy: number,
): PathShape {
	const set = new Set(idxs);
	const next = cloneShape(shape);
	next.nodes = next.nodes.map((n, i) => {
		if (!set.has(i)) return n;
		return {
			...n,
			x: n.x + dx,
			y: n.y + dy,
			xbv: n.xbv.type === "Literal" ? lit(n.x + dx) : n.xbv,
			ybv: n.ybv.type === "Literal" ? lit(n.y + dy) : n.ybv,
			hIn: n.hIn ? { x: n.hIn.x + dx, y: n.hIn.y + dy } : null,
			hOut: n.hOut ? { x: n.hOut.x + dx, y: n.hOut.y + dy } : null,
		};
	});
	return next;
}

/** Place an anchor at an absolute position, dragging its handles along. */
export function setNodePos(shape: PathShape, idx: number, to: Pt): PathShape {
	const n = shape.nodes[idx];
	if (!n) return shape;
	return moveNodes(shape, [idx], to.x - n.x, to.y - n.y);
}

export function reversePath(shape: PathShape): PathShape {
	const nodes = [...shape.nodes].reverse().map((n) => ({
		...clone(n),
		hIn: n.hOut ? { ...n.hOut } : null,
		hOut: n.hIn ? { ...n.hIn } : null,
	}));
	return { nodes, closed: shape.closed };
}

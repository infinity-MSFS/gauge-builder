import type { BBox, Pt, SceneNode } from "./geometry";
import { pathToNodes, rv } from "./geometry";
import type { Scene } from "../store/sceneStore";

// ─── Settings ─────────────────────────────────────────────────────────

export interface SnapSettings {
	/** Master switch. Holding Ctrl/Cmd bypasses snapping without changing it. */
	enabled: boolean;
	grid: boolean;
	gridSize: number;
	/** Element edges, centers and anchor points. */
	objects: boolean;
	/** Artboard edges, center and quarter lines. */
	artboard: boolean;
	/** Constrain angles to 15° steps while dragging with Shift. */
	angleStep: number;
	/** Screen-space snap radius in pixels. */
	tolerancePx: number;
}

export const DEFAULT_SNAP: SnapSettings = {
	enabled: true,
	grid: true,
	gridSize: 8,
	objects: true,
	artboard: true,
	angleStep: 15,
	tolerancePx: 7,
};

// ─── Candidates ───────────────────────────────────────────────────────

export type SnapSource = "grid" | "object" | "artboard" | "anchor";

interface Candidate {
	v: number;
	source: SnapSource;
	/** Extent along the other axis, so the guide can be drawn to the match. */
	from: number;
	to: number;
}

export interface SnapTargets {
	xs: Candidate[];
	ys: Candidate[];
	/** Point targets (path anchors, shape centers) for pen/node snapping. */
	pts: Pt[];
}

export interface SnapGuide {
	axis: "x" | "y";
	/** Scene-space coordinate of the guide line. */
	v: number;
	from: number;
	to: number;
	source: SnapSource;
}

/**
 * Collect everything worth snapping to. `excludeIds` skips the elements being
 * dragged (and their descendants) so they never snap to themselves.
 */
export function buildSnapTargets(
	nodes: SceneNode[],
	scene: Scene,
	excludeIds: Set<string>,
	settings: SnapSettings,
	vars: Map<string, number>,
): SnapTargets {
	const xs: Candidate[] = [];
	const ys: Candidate[] = [];
	const pts: Pt[] = [];

	if (settings.artboard) {
		const full = { from: 0, to: scene.height } as const;
		const fullX = { from: 0, to: scene.width } as const;
		for (const v of [0, scene.width / 2, scene.width])
			xs.push({ v, source: "artboard", ...full });
		for (const v of [0, scene.height / 2, scene.height])
			ys.push({ v, source: "artboard", ...fullX });
	}

	if (settings.objects) {
		for (const n of nodes) {
			if (n.hidden || !n.sceneBBox) continue;
			if (excludeIds.has(n.el.id)) continue;
			if (n.ancestors.some((a) => excludeIds.has(a))) continue;
			const b = n.sceneBBox;
			const yFrom = b.y;
			const yTo = b.y + b.h;
			const xFrom = b.x;
			const xTo = b.x + b.w;
			for (const v of [b.x, b.x + b.w / 2, b.x + b.w])
				xs.push({ v, source: "object", from: yFrom, to: yTo });
			for (const v of [b.y, b.y + b.h / 2, b.y + b.h])
				ys.push({ v, source: "object", from: xFrom, to: xTo });

			// Path anchors make good point targets when tracing a reference.
			if (n.el.kind.type === "Path") {
				const shape = pathToNodes(n.el.kind.commands, vars);
				for (const node of shape.nodes) {
					const p = { x: node.x, y: node.y };
					const sp = {
						x: n.mat.a * p.x + n.mat.c * p.y + n.mat.e,
						y: n.mat.b * p.x + n.mat.d * p.y + n.mat.f,
					};
					pts.push(sp);
				}
			} else if (n.el.kind.type === "Circle" || n.el.kind.type === "Arc") {
				const k = n.el.kind;
				const cx = rv(k.cx, vars);
				const cy = rv(k.cy, vars);
				pts.push({
					x: n.mat.a * cx + n.mat.c * cy + n.mat.e,
					y: n.mat.b * cx + n.mat.d * cy + n.mat.f,
				});
			}
		}
	}

	return { xs, ys, pts };
}

// ─── Snap resolution ──────────────────────────────────────────────────

interface AxisHit {
	delta: number;
	guide: SnapGuide | null;
}

const NO_HIT: AxisHit = { delta: 0, guide: null };

/**
 * Object and artboard alignment always beat the grid. With an 8px grid the
 * worst-case grid error is 4px, so a nearest-wins contest would let the grid
 * swallow almost every object snap and the smart guides would never fire.
 */
function snapAxis(
	values: { v: number; from: number; to: number }[],
	candidates: Candidate[],
	tol: number,
	axis: "x" | "y",
	gridSize: number | null,
): AxisHit {
	let best: AxisHit = NO_HIT;
	let bestDist = tol;

	for (const val of values) {
		for (const c of candidates) {
			const d = c.v - val.v;
			if (Math.abs(d) < bestDist) {
				bestDist = Math.abs(d);
				best = {
					delta: d,
					guide: {
						axis,
						v: c.v,
						from: Math.min(c.from, val.from),
						to: Math.max(c.to, val.to),
						source: c.source,
					},
				};
			}
		}
	}
	if (best.guide) return best;

	if (gridSize && gridSize > 0) {
		let gridDist = tol;
		for (const val of values) {
			const g = Math.round(val.v / gridSize) * gridSize;
			const d = g - val.v;
			if (Math.abs(d) < gridDist) {
				gridDist = Math.abs(d);
				best = {
					delta: d,
					guide: { axis, v: g, from: val.from, to: val.to, source: "grid" },
				};
			}
		}
	}
	return best;
}

export interface SnapResult {
	dx: number;
	dy: number;
	guides: SnapGuide[];
}

/**
 * Snap a moving bounding box. Its left/center/right and top/middle/bottom are
 * all offered, and the closest match on each axis wins — the same model
 * Illustrator's smart guides use.
 */
export function snapBBox(
	moved: BBox,
	targets: SnapTargets,
	settings: SnapSettings,
	zoom: number,
	bypass: boolean,
): SnapResult {
	if (!settings.enabled || bypass) return { dx: 0, dy: 0, guides: [] };
	const tol = settings.tolerancePx / zoom;
	const yFrom = moved.y;
	const yTo = moved.y + moved.h;
	const xFrom = moved.x;
	const xTo = moved.x + moved.w;

	const hx = snapAxis(
		[
			{ v: moved.x, from: yFrom, to: yTo },
			{ v: moved.x + moved.w / 2, from: yFrom, to: yTo },
			{ v: moved.x + moved.w, from: yFrom, to: yTo },
		],
		targets.xs,
		tol,
		"x",
		settings.grid ? settings.gridSize : null,
	);
	const hy = snapAxis(
		[
			{ v: moved.y, from: xFrom, to: xTo },
			{ v: moved.y + moved.h / 2, from: xFrom, to: xTo },
			{ v: moved.y + moved.h, from: xFrom, to: xTo },
		],
		targets.ys,
		tol,
		"y",
		settings.grid ? settings.gridSize : null,
	);

	const guides: SnapGuide[] = [];
	if (hx.guide) guides.push(hx.guide);
	if (hy.guide) guides.push(hy.guide);
	return { dx: hx.delta, dy: hy.delta, guides };
}

/**
 * Snap a single point — used by the drawing tools, the pen and node editing.
 * Point targets (anchors, centers) win over axis lines when both are in range.
 */
export function snapPoint(
	p: Pt,
	targets: SnapTargets,
	settings: SnapSettings,
	zoom: number,
	bypass: boolean,
): { pt: Pt; guides: SnapGuide[] } {
	if (!settings.enabled || bypass) return { pt: p, guides: [] };
	const tol = settings.tolerancePx / zoom;

	if (settings.objects) {
		let best: Pt | null = null;
		let bestD = tol;
		for (const t of targets.pts) {
			const d = Math.hypot(t.x - p.x, t.y - p.y);
			if (d < bestD) {
				bestD = d;
				best = t;
			}
		}
		if (best) {
			return {
				pt: { ...best },
				guides: [
					{ axis: "x", v: best.x, from: best.y - 12 / zoom, to: best.y + 12 / zoom, source: "anchor" },
					{ axis: "y", v: best.y, from: best.x - 12 / zoom, to: best.x + 12 / zoom, source: "anchor" },
				],
			};
		}
	}

	const hx = snapAxis(
		[{ v: p.x, from: p.y, to: p.y }],
		targets.xs,
		tol,
		"x",
		settings.grid ? settings.gridSize : null,
	);
	const hy = snapAxis(
		[{ v: p.y, from: p.x, to: p.x }],
		targets.ys,
		tol,
		"y",
		settings.grid ? settings.gridSize : null,
	);
	const guides: SnapGuide[] = [];
	if (hx.guide) guides.push(hx.guide);
	if (hy.guide) guides.push(hy.guide);
	return { pt: { x: p.x + hx.delta, y: p.y + hy.delta }, guides };
}

/** Constrain a vector to the nearest multiple of `stepDeg`. */
export function constrainAngle(
	from: Pt,
	to: Pt,
	stepDeg: number,
): Pt {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const len = Math.hypot(dx, dy);
	if (len < 1e-6) return to;
	const step = (stepDeg * Math.PI) / 180;
	const a = Math.round(Math.atan2(dy, dx) / step) * step;
	return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

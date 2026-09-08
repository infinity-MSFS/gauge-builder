/**
 * Math checks for the editor's geometry layer. Run with `bun test`.
 *
 * These cover the parts that are hard to eyeball on canvas: matrix round
 * trips, path command round trips (which used to grow the path), bezier
 * bounds, and snapping resolution.
 */
import { describe, expect, test } from "bun:test";
import {
	bboxTransform,
	cornerNode,
	flattenScene,
	getLocalBBox,
	IDENTITY,
	lit,
	matApply,
	matInvert,
	matMul,
	matTRS,
	nodesToPath,
	pathBBox,
	pathToNodes,
	rv,
	scaleElementKind,
	type PathShape,
} from "./geometry";
import { insertNode, moveHandle, segments, toggleSmooth } from "./pathedit";
import { buildSnapTargets, DEFAULT_SNAP, snapBBox, snapPoint } from "./snap";
import { toPathKind } from "./convert";
import type { GroupKind, PathCmd, Scene, SceneElement } from "../store/sceneStore";

const V = new Map<string, number>();

const style = {
	fill: null,
	stroke: { Rgba: [1, 1, 1, 1] as [number, number, number, number] },
	stroke_width: 1,
	line_cap: "Butt" as const,
	line_join: "Miter" as const,
};

const el = (id: string, kind: SceneElement["kind"]): SceneElement => ({
	id,
	name: id,
	visible: true,
	locked: false,
	kind,
});

const rect = (id: string, x: number, y: number, w: number, h: number) =>
	el(id, {
		type: "Rect",
		x: lit(x),
		y: lit(y),
		w: lit(w),
		h: lit(h),
		radius: lit(0),
		style,
	});

const group = (id: string, children: SceneElement[], over: Partial<GroupKind> = {}) =>
	el(id, {
		type: "Group",
		name: id,
		children,
		translate_x: lit(0),
		translate_y: lit(0),
		rotate: lit(0),
		scale_x: lit(1),
		scale_y: lit(1),
		opacity: lit(1),
		pivot_x: lit(0),
		pivot_y: lit(0),
		clip_modifier: null,
		array_modifier: null,
		...over,
	});

// ─── Matrices ─────────────────────────────────────────────────────────

describe("matrices", () => {
	test("invert round-trips a point", () => {
		const m = matTRS(30, -12, 37, 1.4, 0.6, 5, 9);
		const p = matApply(m, 17, 23);
		const back = matApply(matInvert(m), p.x, p.y);
		expect(back.x).toBeCloseTo(17, 6);
		expect(back.y).toBeCloseTo(23, 6);
	});

	test("pivot is the fixed point of rotation", () => {
		const m = matTRS(0, 0, 90, 1, 1, 40, 40);
		const p = matApply(m, 40, 40);
		expect(p.x).toBeCloseTo(40, 6);
		expect(p.y).toBeCloseTo(40, 6);
	});

	test("translation without rotation is a plain offset", () => {
		const m = matTRS(10, 20, 0, 1, 1);
		const p = matApply(m, 3, 4);
		expect(p.x).toBeCloseTo(13, 6);
		expect(p.y).toBeCloseTo(24, 6);
	});

	test("composition applies the right-hand matrix first", () => {
		const outer = matTRS(100, 0, 0, 1, 1);
		const inner = matTRS(0, 50, 0, 2, 2);
		const p = matApply(matMul(outer, inner), 10, 0);
		expect(p.x).toBeCloseTo(120, 6);
		expect(p.y).toBeCloseTo(50, 6);
	});
});

// ─── Scene flattening ─────────────────────────────────────────────────

describe("flattenScene", () => {
	test("accumulates ancestor transforms", () => {
		const scene = [group("g", [rect("r", 0, 0, 10, 10)], { translate_x: lit(100), translate_y: lit(50) })];
		const flat = flattenScene(scene, V);
		const r = flat.find((n) => n.el.id === "r")!;
		expect(r.ancestors).toEqual(["g"]);
		expect(r.sceneBBox!.x).toBeCloseTo(100, 6);
		expect(r.sceneBBox!.y).toBeCloseTo(50, 6);
	});

	test("a rotated group reports an enclosing axis-aligned box", () => {
		const scene = [
			group("g", [rect("r", -10, -10, 20, 20)], { rotate: lit(45) }),
		];
		const flat = flattenScene(scene, V);
		const g = flat.find((n) => n.el.id === "g")!;
		// A 20×20 square turned 45° spans 20·√2.
		expect(g.sceneBBox!.w).toBeCloseTo(20 * Math.SQRT2, 4);
		expect(g.sceneBBox!.h).toBeCloseTo(20 * Math.SQRT2, 4);
	});

	test("hidden and locked state is inherited", () => {
		const g = group("g", [rect("r", 0, 0, 10, 10)]);
		g.locked = true;
		g.visible = false;
		const flat = flattenScene([g], V);
		const r = flat.find((n) => n.el.id === "r")!;
		expect(r.locked).toBe(true);
		expect(r.hidden).toBe(true);
	});

	test("group bbox is the union of its children", () => {
		const scene = [group("g", [rect("a", 0, 0, 10, 10), rect("b", 90, 40, 10, 10)])];
		const b = getLocalBBox(scene[0], V)!;
		expect(b).toEqual({ x: 0, y: 0, w: 100, h: 50 });
	});
});

// ─── Path round trips ─────────────────────────────────────────────────

const cmdCount = (c: PathCmd[]) => c.length;

describe("path command round trips", () => {
	test("an open polyline is stable", () => {
		const cmds: PathCmd[] = [
			{ type: "MoveTo", x: lit(0), y: lit(0) },
			{ type: "LineTo", x: lit(10), y: lit(0) },
			{ type: "LineTo", x: lit(10), y: lit(10) },
		];
		const once = nodesToPath(pathToNodes(cmds, V));
		const twice = nodesToPath(pathToNodes(once, V));
		expect(cmdCount(once)).toBe(3);
		expect(twice).toEqual(once);
	});

	test("a closed polygon does not grow on repeated edits", () => {
		const cmds: PathCmd[] = [
			{ type: "MoveTo", x: lit(0), y: lit(0) },
			{ type: "LineTo", x: lit(10), y: lit(0) },
			{ type: "LineTo", x: lit(10), y: lit(10) },
			{ type: "ClosePath" },
		];
		let cur = cmds;
		for (let i = 0; i < 5; i++) cur = nodesToPath(pathToNodes(cur, V));
		expect(pathToNodes(cur, V).nodes.length).toBe(3);
		expect(pathToNodes(cur, V).closed).toBe(true);
		expect(cmdCount(cur)).toBe(4);
	});

	test("a closed bezier loop does not grow on repeated edits", () => {
		const circle = toPathKind(
			{
				type: "Circle",
				cx: lit(50),
				cy: lit(50),
				r: lit(20),
				style,
			},
			V,
		)!;
		let cur = circle.commands;
		const first = pathToNodes(cur, V).nodes.length;
		for (let i = 0; i < 5; i++) cur = nodesToPath(pathToNodes(cur, V));
		expect(pathToNodes(cur, V).nodes.length).toBe(first);
		expect(first).toBe(4);
	});

	test("bound coordinates survive a round trip", () => {
		const cmds: PathCmd[] = [
			{ type: "MoveTo", x: { type: "LVar", name: "tape" }, y: lit(0) },
			{ type: "LineTo", x: lit(10), y: lit(0) },
		];
		const out = nodesToPath(pathToNodes(cmds, V));
		expect(out[0]).toMatchObject({ x: { type: "LVar", name: "tape" } });
	});
});

// ─── Bezier geometry ──────────────────────────────────────────────────

describe("bezier geometry", () => {
	test("pathBBox uses true extrema, not the control hull", () => {
		// A single cubic bulging to y = 0.75 · 100 at its apex.
		const shape: PathShape = {
			closed: false,
			nodes: [
				{ ...cornerNode(0, 0), hOut: { x: 0, y: 100 } },
				{ ...cornerNode(100, 0), hIn: { x: 100, y: 100 } },
			],
		};
		const b = pathBBox(shape)!;
		expect(b.x).toBeCloseTo(0, 6);
		expect(b.w).toBeCloseTo(100, 6);
		expect(b.h).toBeCloseTo(75, 4); // not 100 — the hull overestimates
	});

	test("inserting an anchor keeps the curve in place", () => {
		const shape: PathShape = {
			closed: false,
			nodes: [
				{ ...cornerNode(0, 0), hOut: { x: 0, y: 100 } },
				{ ...cornerNode(100, 0), hIn: { x: 100, y: 100 } },
			],
		};
		const before = pathBBox(shape)!;
		const seg = segments(shape)[0];
		const next = insertNode(shape, seg, 0.5);
		expect(next.nodes.length).toBe(3);
		const after = pathBBox(next)!;
		expect(after.x).toBeCloseTo(before.x, 4);
		expect(after.y).toBeCloseTo(before.y, 4);
		expect(after.w).toBeCloseTo(before.w, 4);
		expect(after.h).toBeCloseTo(before.h, 4);
	});

	test("toggleSmooth adds then removes handles", () => {
		const shape: PathShape = {
			closed: false,
			nodes: [cornerNode(0, 0), cornerNode(50, 30), cornerNode(100, 0)],
		};
		const smooth = toggleSmooth(shape, 1);
		expect(smooth.nodes[1].hIn).not.toBeNull();
		expect(smooth.nodes[1].hOut).not.toBeNull();
		const corner = toggleSmooth(smooth, 1);
		expect(corner.nodes[1].hIn).toBeNull();
		expect(corner.nodes[1].hOut).toBeNull();
	});

	test("dragging one handle mirrors the other on a smooth anchor", () => {
		const base: PathShape = {
			closed: false,
			nodes: [cornerNode(0, 0), cornerNode(50, 0), cornerNode(100, 0)],
		};
		const smooth = toggleSmooth(base, 1);
		const inLen0 = Math.hypot(
			smooth.nodes[1].hIn!.x - smooth.nodes[1].x,
			smooth.nodes[1].hIn!.y - smooth.nodes[1].y,
		);
		const moved = moveHandle(smooth, 1, "out", { x: 50, y: 40 }, false);
		const n = moved.nodes[1];
		// The handles stay opposite in direction; each keeps its own length.
		const inV = { x: n.hIn!.x - n.x, y: n.hIn!.y - n.y };
		const outV = { x: n.hOut!.x - n.x, y: n.hOut!.y - n.y };
		const cross = inV.x * outV.y - inV.y * outV.x;
		const dot = inV.x * outV.x + inV.y * outV.y;
		expect(cross).toBeCloseTo(0, 6);
		expect(dot).toBeLessThan(0);
		expect(Math.hypot(inV.x, inV.y)).toBeCloseTo(inLen0, 6);
	});

	test("alt-drag breaks handle symmetry", () => {
		const base: PathShape = {
			closed: false,
			nodes: [cornerNode(0, 0), cornerNode(50, 0), cornerNode(100, 0)],
		};
		const smooth = toggleSmooth(base, 1);
		const before = { ...smooth.nodes[1].hIn! };
		const moved = moveHandle(smooth, 1, "out", { x: 50, y: 40 }, true);
		expect(moved.nodes[1].hIn).toEqual(before);
	});
});

// ─── Shape conversion ─────────────────────────────────────────────────

describe("toPathKind", () => {
	test("a circle converts to a path with the same bounds", () => {
		const p = toPathKind(
			{ type: "Circle", cx: lit(60), cy: lit(40), r: lit(25), style },
			V,
		)!;
		const b = pathBBox(pathToNodes(p.commands, V))!;
		expect(b.x).toBeCloseTo(35, 3);
		expect(b.y).toBeCloseTo(15, 3);
		expect(b.w).toBeCloseTo(50, 3);
		expect(b.h).toBeCloseTo(50, 3);
	});

	test("a rounded rect converts to a path with the same bounds", () => {
		const p = toPathKind(
			{
				type: "Rect",
				x: lit(10),
				y: lit(20),
				w: lit(80),
				h: lit(40),
				radius: lit(8),
				style,
			},
			V,
		)!;
		const b = pathBBox(pathToNodes(p.commands, V))!;
		expect(b.x).toBeCloseTo(10, 3);
		expect(b.y).toBeCloseTo(20, 3);
		expect(b.w).toBeCloseTo(80, 3);
		expect(b.h).toBeCloseTo(40, 3);
	});

	test("a half arc converts to a path spanning its diameter", () => {
		const p = toPathKind(
			{
				type: "Arc",
				cx: lit(0),
				cy: lit(0),
				r: lit(50),
				a0: lit(0),
				a1: lit(Math.PI),
				dir: "Cw",
				style,
			},
			V,
		)!;
		const b = pathBBox(pathToNodes(p.commands, V))!;
		expect(b.w).toBeCloseTo(100, 2);
		expect(b.y).toBeCloseTo(0, 2);
		expect(b.h).toBeCloseTo(50, 2);
	});

	test("groups and text are not convertible", () => {
		expect(toPathKind(group("g", []).kind, V)).toBeNull();
	});
});

// ─── Scaling ──────────────────────────────────────────────────────────

describe("scaleElementKind", () => {
	test("a rect maps exactly onto the target box", () => {
		const k = rect("r", 10, 10, 40, 20).kind;
		const next = scaleElementKind(k, { x: 10, y: 10, w: 40, h: 20 }, { x: 0, y: 0, w: 80, h: 60 }, V);
		expect(next.type).toBe("Rect");
		if (next.type !== "Rect") return;
		expect(rv(next.x, V)).toBeCloseTo(0, 6);
		expect(rv(next.y, V)).toBeCloseTo(0, 6);
		expect(rv(next.w, V)).toBeCloseTo(80, 6);
		expect(rv(next.h, V)).toBeCloseTo(60, 6);
	});

	test("a circle stays round, taking the smaller axis", () => {
		const k = el("c", {
			type: "Circle",
			cx: lit(50),
			cy: lit(50),
			r: lit(10),
			style,
		}).kind;
		const next = scaleElementKind(k, { x: 40, y: 40, w: 20, h: 20 }, { x: 40, y: 40, w: 60, h: 20 }, V);
		if (next.type !== "Circle") throw new Error("wrong kind");
		expect(rv(next.r, V)).toBeCloseTo(10, 6);
	});

	test("bound geometry is left alone", () => {
		const k = el("r", {
			type: "Rect",
			x: { type: "LVar", name: "x" },
			y: lit(0),
			w: lit(10),
			h: lit(10),
			radius: lit(0),
			style,
		}).kind;
		const next = scaleElementKind(k, { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 20, h: 20 }, V);
		if (next.type !== "Rect") throw new Error("wrong kind");
		expect(next.x).toEqual({ type: "LVar", name: "x" });
	});
});

// ─── Snapping ─────────────────────────────────────────────────────────

const scene: Scene = {
	width: 512,
	height: 512,
	gauge_name: "t",
	elements: [rect("a", 100, 100, 50, 50)],
};

describe("snapping", () => {
	const flat = flattenScene(scene.elements, V);

	test("edges snap to a neighbouring element", () => {
		const targets = buildSnapTargets(flat, scene, new Set(["moving"]), DEFAULT_SNAP, V);
		// Moving box sits 3px left of element "a" — inside the 7px radius.
		const res = snapBBox({ x: 97, y: 300, w: 20, h: 20 }, targets, DEFAULT_SNAP, 1, false);
		expect(res.dx).toBeCloseTo(3, 6);
		expect(res.guides.length).toBeGreaterThan(0);
	});

	test("holding the bypass key disables snapping", () => {
		const targets = buildSnapTargets(flat, scene, new Set(), DEFAULT_SNAP, V);
		const res = snapBBox({ x: 97, y: 300, w: 20, h: 20 }, targets, DEFAULT_SNAP, 1, true);
		expect(res.dx).toBe(0);
		expect(res.guides).toEqual([]);
	});

	test("the element being dragged is not a snap target for itself", () => {
		const targets = buildSnapTargets(flat, scene, new Set(["a"]), DEFAULT_SNAP, V);
		const objectXs = targets.xs.filter((c) => c.source === "object");
		expect(objectXs.length).toBe(0);
	});

	test("descendants of a dragged group are excluded too", () => {
		const nested: Scene = {
			...scene,
			elements: [group("g", [rect("child", 100, 100, 50, 50)])],
		};
		const nestedFlat = flattenScene(nested.elements, V);
		const targets = buildSnapTargets(nestedFlat, nested, new Set(["g"]), DEFAULT_SNAP, V);
		expect(targets.xs.filter((c) => c.source === "object").length).toBe(0);
	});

	test("points snap to the grid when no object is near", () => {
		const empty = { xs: [], ys: [], pts: [] };
		const res = snapPoint({ x: 33, y: 65 }, empty, DEFAULT_SNAP, 1, false);
		expect(res.pt.x).toBeCloseTo(32, 6);
		expect(res.pt.y).toBeCloseTo(64, 6);
	});

	test("the snap radius shrinks as you zoom in", () => {
		const noGrid = { ...DEFAULT_SNAP, grid: false };
		const targets = buildSnapTargets(flat, scene, new Set(), noGrid, V);
		// 3 scene units from element "a": in range at 1x, out of range at 4x.
		const box = { x: 103, y: 300, w: 0, h: 0 };
		expect(snapBBox(box, targets, noGrid, 1, false).dx).toBeCloseTo(-3, 6);
		expect(snapBBox(box, targets, noGrid, 4, false).dx).toBe(0);
	});

	test("object alignment wins over the grid", () => {
		const targets = buildSnapTargets(flat, scene, new Set(["moving"]), DEFAULT_SNAP, V);
		// x=97 is 1px from a grid line but 3px from element "a" — alignment wins,
		// otherwise smart guides would never fire against an 8px grid.
		const res = snapBBox({ x: 97, y: 300, w: 20, h: 20 }, targets, DEFAULT_SNAP, 1, false);
		expect(res.dx).toBeCloseTo(3, 6);
		expect(res.guides[0].source).toBe("object");
	});

	test("the grid still catches a point with nothing else nearby", () => {
		const targets = buildSnapTargets(flat, scene, new Set(), DEFAULT_SNAP, V);
		// Right edge at 311 is the closest of the three to a grid line (312).
		const res = snapBBox({ x: 301, y: 301, w: 10, h: 10 }, targets, DEFAULT_SNAP, 1, false);
		expect(res.dx).toBeCloseTo(1, 6);
		expect(res.guides[0].source).toBe("grid");
	});

	test("the artboard centre is a target", () => {
		const targets = buildSnapTargets([], scene, new Set(), DEFAULT_SNAP, V);
		expect(targets.xs.some((c) => c.v === 256 && c.source === "artboard")).toBe(true);
	});
});

// ─── bbox transform ───────────────────────────────────────────────────

describe("bboxTransform", () => {
	test("identity leaves a box untouched", () => {
		const b = { x: 1, y: 2, w: 3, h: 4 };
		expect(bboxTransform(b, IDENTITY)).toEqual(b);
	});

	test("a 90° rotation swaps width and height", () => {
		const b = bboxTransform({ x: 0, y: 0, w: 10, h: 4 }, matTRS(0, 0, 90, 1, 1));
		expect(b.w).toBeCloseTo(4, 6);
		expect(b.h).toBeCloseTo(10, 6);
	});
});

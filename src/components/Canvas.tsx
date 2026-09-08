import { useEffect, useRef, useState, useReducer } from "react";
import {
	useSceneStore,
	type ArcKind,
	type CircleKind,
	type ElementKind,
	type ElementPatch,
	type GroupKind,
	type LineKind,
	type NvgStyle,
	type PathKind,
	type SceneElement,
	type TextKind,
} from "../store/sceneStore";
import {
	useEditorStore,
	TOOL_KEYS,
	type Tool,
} from "../store/editorStore";
import {
	useRefImageStore,
	refImageElements,
	type RefImageMeta,
} from "../store/refImageStore";
import {
	loadRefImageFromFile,
	loadRefImageFromClipboard,
	pickRefImageViaDialog,
} from "../store/refImageLoader";
import {
	bboxFromPts,
	bboxIntersects,
	bboxTransform,
	cornerNode,
	flattenScene,
	hitElement,
	isMovable,
	lit,
	litSet,
	matApply,
	matApplyVec,
	matInvert,
	moveElementKind,
	nodeById,
	pathToNodes,
	rv,
	scaleElementKind,
	updateElementInTree,
	varMapOf,
	nodesToPath,
	type BBox,
	type Mat,
	type PathShape,
	type Pt,
	type SceneNode,
} from "../canvas/geometry";
import {
	buildSnapTargets,
	constrainAngle,
	snapBBox,
	snapPoint,
	type SnapGuide,
	type SnapTargets,
} from "../canvas/snap";
import { drawElement } from "../canvas/render";
import {
	buildScaleHandles,
	drawBadge,
	drawGrid,
	drawHandles,
	drawMarquee,
	drawPathNodes,
	drawRulers,
	drawSnapGuides,
	hitHandles,
	screenMat,
	strokeQuad,
	toScene,
	toScreen,
	viewportMat,
	RULER_SIZE,
	UI,
	type Handle,
	type PlacedHandle,
	type ScaleHandle,
	type Viewport,
} from "../canvas/overlay";
import {
	closestOnPath,
	deleteNodes,
	insertNode,
	moveHandle,
	moveNodes,
	setNodePos,
	toggleSmooth,
} from "../canvas/pathedit";
import {
	alignPatches,
	distributePatches,
	duplicateSelection,
	nudgeSelection,
	reorderSelection,
	selectionBBox,
	transformRoots,
	type AlignMode,
	type DistributeMode,
} from "../canvas/actions";
import CanvasChrome from "./CanvasChrome";

// ─── Interaction state ────────────────────────────────────────────────

type Drag =
	| { t: "none" }
	| { t: "pan"; mx0: number; my0: number; px0: number; py0: number }
	| {
			t: "marquee";
			x0: number;
			y0: number;
			x1: number;
			y1: number;
			additive: boolean;
	  }
	| {
			t: "move";
			start: { node: SceneNode; kind: ElementKind }[];
			s0: Pt;
			box0: BBox;
			moved: boolean;
	  }
	| {
			t: "scale";
			h: ScaleHandle;
			s0: Pt;
			/** Single-element scale works in local space; multi in scene space. */
			single: SceneNode | null;
			box0: BBox;
			/** Geometry captured at mousedown, keyed by element. */
			start: { node: SceneNode; kind: ElementKind; local: BBox; scene: BBox }[];
	  }
	| { t: "rotate"; id: string; k0: GroupKind; centre: Pt; a0: number; rot0: number }
	| { t: "pivot"; id: string; k0: GroupKind; node: SceneNode }
	| { t: "lineEnd"; id: string; k0: LineKind; i: 0 | 1; node: SceneNode }
	| { t: "radius"; id: string; k0: CircleKind | ArcKind; node: SceneNode }
	| { t: "arcAngle"; id: string; k0: ArcKind; i: 0 | 1; node: SceneNode }
	| { t: "draw"; tool: Tool; p0: Pt; p1: Pt }
	| {
			t: "node";
			id: string;
			shape0: PathShape;
			idxs: number[];
			s0: Pt;
			node: SceneNode;
	  }
	| {
			t: "handle";
			id: string;
			shape0: PathShape;
			i: number;
			which: "in" | "out";
			node: SceneNode;
	  }
	| { t: "pen-handle"; i: number; anchor: Pt }
	| { t: "move-img"; id: string; s0: Pt; x0: number; y0: number }
	| { t: "resize-img"; id: string; h: ScaleHandle; s0: Pt; img0: RefImageMeta };

interface PenDraft {
	/** Existing path being extended, or null for a brand-new one. */
	targetId: string | null;
	/** Parent group when extending, so a new path lands in the same place. */
	shape: PathShape;
	/** Cursor position for the rubber-band segment. */
	cursor: Pt | null;
	/** Local→scene matrix the draft is authored in. */
	mat: Mat;
}

const DEFAULT_FILL: NvgStyle = {
	fill: { Rgba: [0.42, 0.45, 0.95, 1] },
	stroke: null,
	stroke_width: 1,
	line_cap: "Butt",
	line_join: "Miter",
};
const DEFAULT_STROKE: NvgStyle = {
	fill: null,
	stroke: { Rgba: [0.91, 0.91, 0.91, 1] },
	stroke_width: 2,
	line_cap: "Round",
	line_join: "Round",
};

const newId = () =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `el-${Math.random().toString(36).slice(2)}-${Date.now()}`;

const makeElement = (name: string, kind: ElementKind): SceneElement => ({
	id: newId(),
	name,
	visible: true,
	locked: false,
	kind,
});

// ─── Canvas component ─────────────────────────────────────────────────

export default function Canvas() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Store mirrors — the render loop reads refs, never React state.
	const sceneRef = useRef(useSceneStore.getState().scene);
	const varsRef = useRef(useSceneStore.getState().vars);
	const refImagesRef = useRef(useRefImageStore.getState().images);
	const editorRef = useRef(useEditorStore.getState());

	const vpRef = useRef<Viewport>({ panX: 0, panY: 0, zoom: 1 });
	const dragRef = useRef<Drag>({ t: "none" });
	const overridesRef = useRef<Map<string, ElementKind>>(new Map());
	const localImgRef = useRef<RefImageMeta | null>(null);
	const penRef = useRef<PenDraft | null>(null);
	const guidesRef = useRef<SnapGuide[]>([]);
	const snapTargetsRef = useRef<SnapTargets | null>(null);
	/** Set once the user pans or zooms, after which resizes stop re-fitting. */
	const viewportTouchedRef = useRef(false);
	const spaceRef = useRef(false);
	const altRef = useRef(false);
	const shiftRef = useRef(false);
	const ctrlRef = useRef(false);
	const hoverIdRef = useRef<string | null>(null);
	const hoverHandleRef = useRef<Handle | null>(null);
	const cursorSceneRef = useRef<Pt | null>(null);
	const flatRef = useRef<SceneNode[]>([]);
	const handlesRef = useRef<PlacedHandle[]>([]);
	const badgeRef = useRef<string | null>(null);

	const [, bump] = useReducer((x: number) => x + 1, 0);
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const [textEdit, setTextEdit] = useState<{
		id: string;
		value: string;
		left: number;
		top: number;
		size: number;
	} | null>(null);

	// React-visible slices used by the chrome overlays.
	const tool = useEditorStore((s) => s.tool);
	const selection = useEditorStore((s) => s.selection);
	const snap = useEditorStore((s) => s.snap);
	const showGrid = useEditorStore((s) => s.showGrid);
	const showRulers = useEditorStore((s) => s.showRulers);
	const showOutlines = useEditorStore((s) => s.showOutlines);
	const isolationId = useEditorStore((s) => s.isolationId);

	// ── Derived scene helpers ──────────────────────────────────────────

	const varMap = () => varMapOf(varsRef.current);

	/** Scene with any in-flight drag geometry applied. */
	const effectiveElements = () => {
		const ov = overridesRef.current;
		return ov.size === 0
			? sceneRef.current.elements
			: updateElementInTree(sceneRef.current.elements, ov);
	};

	const reflatten = (): SceneNode[] => {
		flatRef.current = flattenScene(effectiveElements(), varMap());
		return flatRef.current;
	};

	const selectedNodes = (): SceneNode[] => {
		const sel = editorRef.current.selection;
		return sel
			.map((id) => nodeById(flatRef.current, id))
			.filter((n): n is SceneNode => !!n);
	};

	// ── Draw ───────────────────────────────────────────────────────────

	const draw = () => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const scene = sceneRef.current;
		const vp = vpRef.current;
		const ed = editorRef.current;
		const vars = varMap();
		const W = canvas.width;
		const H = canvas.height;
		const flat = reflatten();

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, W, H);

		// Checkerboard backdrop
		const tile = Math.max(8, 24 * vp.zoom);
		ctx.fillStyle = "#060606";
		ctx.fillRect(0, 0, W, H);
		ctx.fillStyle = "#0a0a0a";
		for (let tx = 0; tx * tile < W + tile; tx++) {
			for (let ty = 0; ty * tile < H + tile; ty++) {
				if ((tx + ty) % 2 === 0) ctx.fillRect(tx * tile, ty * tile, tile, tile);
			}
		}

		ctx.save();
		ctx.translate(vp.panX, vp.panY);
		ctx.scale(vp.zoom, vp.zoom);

		// Artboard
		ctx.fillStyle = "#101010";
		ctx.fillRect(0, 0, scene.width, scene.height);

		if (ed.showGrid) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, scene.width, scene.height);
			ctx.clip();
			drawGrid(ctx, vp, scene.width, scene.height, ed.snap.gridSize);
			ctx.restore();
		}

		const overrides = overridesRef.current;
		for (const el of scene.elements) {
			drawElement(ctx, el, vars, {
				overrides: overrides.size ? overrides : undefined,
				outlineOnly: ed.showOutlines,
			});
		}

		// Reference images sit above the art so tracing stays visible.
		for (const img of refImagesRef.current) {
			if (!img.visible) continue;
			const el = refImageElements.get(img.id);
			if (!el) continue;
			const live = localImgRef.current?.id === img.id ? localImgRef.current : img;
			ctx.save();
			ctx.globalAlpha = live.opacity;
			ctx.drawImage(el, live.x, live.y, live.w, live.h);
			ctx.restore();
		}

		// Artboard border
		ctx.strokeStyle = "#242424";
		ctx.lineWidth = 1 / vp.zoom;
		ctx.strokeRect(0, 0, scene.width, scene.height);
		ctx.restore();

		// ── Screen-space overlays ──
		const handles: PlacedHandle[] = [];

		// Isolation dimming: everything outside the entered group recedes.
		if (ed.isolationId) {
			const iso = nodeById(flat, ed.isolationId);
			if (iso?.sceneBBox) {
				ctx.save();
				ctx.fillStyle = "rgba(0,0,0,0.45)";
				ctx.fillRect(0, 0, W, H);
				const b = bboxTransform(iso.sceneBBox, viewportMat(vp));
				ctx.clearRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
				ctx.restore();
			}
		}

		// Hover outline
		const hoverId = hoverIdRef.current;
		if (hoverId && !ed.selection.includes(hoverId)) {
			const n = nodeById(flat, hoverId);
			if (n?.bbox) {
				strokeQuad(ctx, n.bbox, screenMat(n.mat, vp), UI.hover, [], 1);
			}
		}

		const sel = selectedNodes();
		const activePath = sel.length === 1 && sel[0].el.kind.type === "Path" ? sel[0] : null;
		const nodeMode = ed.tool === "direct" || ed.tool === "pen";

		if (sel.length === 1) {
			const n = sel[0];
			const m = screenMat(n.mat, vp);
			if (n.bbox) {
				strokeQuad(ctx, n.bbox, m, UI.accent, [4, 3]);
			}
			if (!(nodeMode && activePath)) {
				handles.push(...singleElementHandles(n, m, vars));
			}
		} else if (sel.length > 1) {
			const box = selectionBBox(flat, ed.selection);
			if (box) {
				const m = viewportMat(vp);
				strokeQuad(ctx, box, m, UI.accent, [4, 3]);
				handles.push(...buildScaleHandles(box, m));
				for (const n of sel) {
					if (n.bbox)
						strokeQuad(ctx, n.bbox, screenMat(n.mat, vp), UI.accentSoft, [2, 2], 1);
				}
			}
		}

		// Path anchors
		if (nodeMode && activePath) {
			const k = activePath.el.kind as PathKind;
			const shape = pathToNodes(k.commands, vars);
			const set = drawPathNodes(
				ctx,
				shape,
				screenMat(activePath.mat, vp),
				ed.nodeSelection,
				hoverHandleRef.current,
			);
			handles.push(...set.handles);
		}

		// Pen draft
		if (penRef.current) drawPenDraft(ctx, penRef.current, vp);

		drawHandles(ctx, handles.filter((h) => h.handle.t !== "node" && h.handle.t !== "handleIn" && h.handle.t !== "handleOut"));
		handlesRef.current = handles;

		// Reference image selection
		const refSel = refImagesRef.current.find((i) => ed.selection.includes(i.id));
		if (refSel) {
			const live =
				localImgRef.current?.id === refSel.id ? localImgRef.current : refSel;
			const box = { x: live.x, y: live.y, w: live.w, h: live.h };
			const m = viewportMat(vp);
			strokeQuad(ctx, box, m, UI.ref, [5, 3]);
			if (!refSel.locked) {
				const imgHandles = buildScaleHandles(box, m, {
					only: ["tl", "tr", "bl", "br"],
				});
				drawHandles(ctx, imgHandles, UI.ref);
				handlesRef.current = [...handlesRef.current, ...imgHandles];
			}
		}

		// Drawing preview
		const drag = dragRef.current;
		if (drag.t === "draw") drawToolPreview(ctx, drag, vp);
		if (drag.t === "marquee") {
			drawMarquee(ctx, {
				x: Math.min(drag.x0, drag.x1),
				y: Math.min(drag.y0, drag.y1),
				w: Math.abs(drag.x1 - drag.x0),
				h: Math.abs(drag.y1 - drag.y0),
			});
		}

		drawSnapGuides(ctx, guidesRef.current, vp);

		if (badgeRef.current && cursorSceneRef.current) {
			const p = toScreen(cursorSceneRef.current.x, cursorSceneRef.current.y, vp);
			drawBadge(ctx, badgeRef.current, { x: p.x + 14, y: p.y + 14 });
		}

		if (ed.showRulers) {
			const selBox = selectionBBox(flat, ed.selection);
			drawRulers(ctx, vp, W, H, cursorSceneRef.current, selBox);
		}
	};

	/** Element-specific affordances: radii, arc sweep, line ends, pivots. */
	const singleElementHandles = (
		n: SceneNode,
		m: Mat,
		vars: Map<string, number>,
	): PlacedHandle[] => {
		const k = n.el.kind;
		const out: PlacedHandle[] = [];
		if (n.locked) return out;

		switch (k.type) {
			case "Line": {
				out.push(
					{
						handle: { t: "lineEnd", i: 0 },
						p: matApply(m, rv(k.x1, vars), rv(k.y1, vars)),
						cursor: "move",
					},
					{
						handle: { t: "lineEnd", i: 1 },
						p: matApply(m, rv(k.x2, vars), rv(k.y2, vars)),
						cursor: "move",
					},
				);
				break;
			}
			case "Circle": {
				if (n.bbox) out.push(...buildScaleHandles(n.bbox, m));
				break;
			}
			case "Arc": {
				if (n.bbox) out.push(...buildScaleHandles(n.bbox, m));
				const cx = rv(k.cx, vars);
				const cy = rv(k.cy, vars);
				const r = Math.abs(rv(k.r, vars));
				for (const [i, a] of [
					[0, rv(k.a0, vars)],
					[1, rv(k.a1, vars)],
				] as [0 | 1, number][]) {
					out.push({
						handle: { t: "arcAngle", i },
						p: matApply(m, cx + Math.cos(a) * r, cy + Math.sin(a) * r),
						cursor: "crosshair",
					});
				}
				break;
			}
			case "Group": {
				if (n.bbox) out.push(...buildScaleHandles(n.bbox, m, { rotate: true }));
				out.push({
					handle: { t: "pivot" },
					p: matApply(m, rv(k.pivot_x, vars), rv(k.pivot_y, vars)),
					cursor: "move",
				});
				break;
			}
			default: {
				if (n.bbox) out.push(...buildScaleHandles(n.bbox, m));
			}
		}
		return out;
	};

	const drawPenDraft = (
		ctx: CanvasRenderingContext2D,
		draft: PenDraft,
		vp: Viewport,
	) => {
		const m = screenMat(draft.mat, vp);
		const sp = (p: Pt) => matApply(m, p.x, p.y);
		const nodes = draft.shape.nodes;
		if (nodes.length === 0) return;

		ctx.save();
		ctx.strokeStyle = UI.accent;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		const p0 = sp(nodes[0]);
		ctx.moveTo(p0.x, p0.y);
		for (let i = 1; i < nodes.length; i++) {
			const a = nodes[i - 1];
			const b = nodes[i];
			if (a.hOut || b.hIn) {
				const c1 = sp(a.hOut ?? a);
				const c2 = sp(b.hIn ?? b);
				const p = sp(b);
				ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
			} else {
				const p = sp(b);
				ctx.lineTo(p.x, p.y);
			}
		}
		ctx.stroke();

		// Rubber band to the cursor
		if (draft.cursor) {
			const last = nodes[nodes.length - 1];
			const c = sp(draft.cursor);
			const a = sp(last);
			ctx.setLineDash([4, 3]);
			ctx.strokeStyle = UI.accentSoft;
			ctx.beginPath();
			if (last.hOut) {
				const c1 = sp(last.hOut);
				ctx.moveTo(a.x, a.y);
				ctx.bezierCurveTo(c1.x, c1.y, c.x, c.y, c.x, c.y);
			} else {
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(c.x, c.y);
			}
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Anchors + handles
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i];
			const a = sp(n);
			ctx.strokeStyle = UI.handle;
			ctx.lineWidth = 1;
			for (const h of [n.hIn, n.hOut]) {
				if (!h) continue;
				const hp = sp(h);
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(hp.x, hp.y);
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(hp.x, hp.y, 3, 0, Math.PI * 2);
				ctx.fillStyle = UI.handle;
				ctx.fill();
			}
			ctx.beginPath();
			ctx.rect(a.x - 3.5, a.y - 3.5, 7, 7);
			ctx.fillStyle = i === 0 ? UI.accent : "#ffffff";
			ctx.fill();
			ctx.strokeStyle = UI.accent;
			ctx.lineWidth = 1.25;
			ctx.stroke();
		}
		ctx.restore();
	};

	const drawToolPreview = (
		ctx: CanvasRenderingContext2D,
		drag: Extract<Drag, { t: "draw" }>,
		vp: Viewport,
	) => {
		const a = toScreen(drag.p0.x, drag.p0.y, vp);
		const b = toScreen(drag.p1.x, drag.p1.y, vp);
		ctx.save();
		ctx.strokeStyle = UI.accent;
		ctx.lineWidth = 1.25;
		ctx.setLineDash([4, 3]);
		ctx.beginPath();
		if (drag.tool === "line") {
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
		} else if (drag.tool === "ellipse" || drag.tool === "arc") {
			const r = Math.hypot(b.x - a.x, b.y - a.y);
			ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
		} else {
			ctx.rect(
				Math.min(a.x, b.x),
				Math.min(a.y, b.y),
				Math.abs(b.x - a.x),
				Math.abs(b.y - a.y),
			);
		}
		ctx.stroke();
		ctx.restore();
	};

	// ── Store subscriptions ────────────────────────────────────────────

	useEffect(() => {
		const unsub1 = useSceneStore.subscribe((state) => {
			sceneRef.current = state.scene;
			varsRef.current = state.vars;
			draw();
		});
		const unsub2 = useRefImageStore.subscribe((state) => {
			refImagesRef.current = state.images;
			draw();
		});
		const unsub3 = useEditorStore.subscribe((state) => {
			const prevTool = editorRef.current.tool;
			editorRef.current = state;
			if (prevTool !== state.tool && penRef.current) finishPen();
			draw();
		});
		return () => {
			unsub1();
			unsub2();
			unsub3();
		};
	}, []);

	// ── Sizing ─────────────────────────────────────────────────────────

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const resize = () => {
			const { width, height } = el.getBoundingClientRect();
			const canvas = canvasRef.current;
			if (canvas) {
				canvas.width = Math.max(1, Math.floor(width));
				canvas.height = Math.max(1, Math.floor(height));
			}
			// Until the user takes control of the view, keep the artboard framed —
			// otherwise the first window resize leaves it stranded in a corner.
			if (viewportTouchedRef.current) draw();
			else fitScene();
		};
		const ro = new ResizeObserver(resize);
		ro.observe(el);
		resize();
		const id = setTimeout(fitScene, 60);
		return () => {
			ro.disconnect();
			clearTimeout(id);
		};
	}, []);

	const fitScene = () => {
		const container = containerRef.current;
		if (!container) return;
		const { width, height } = container.getBoundingClientRect();
		const pad = RULER_SIZE + 24;
		const scene = sceneRef.current;
		const zoom = Math.max(
			0.02,
			Math.min(
				64,
				(width - pad * 2) / scene.width,
				(height - pad * 2) / scene.height,
			),
		);
		vpRef.current = {
			zoom,
			panX: (width - scene.width * zoom) / 2 + RULER_SIZE / 2,
			panY: (height - scene.height * zoom) / 2 + RULER_SIZE / 2,
		};
		draw();
	};

	const zoomTo = (z: number, cx?: number, cy?: number) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		viewportTouchedRef.current = true;
		const vp = vpRef.current;
		const mx = cx ?? canvas.width / 2;
		const my = cy ?? canvas.height / 2;
		const nz = Math.max(0.02, Math.min(64, z));
		vpRef.current = {
			zoom: nz,
			panX: mx - (mx - vp.panX) * (nz / vp.zoom),
			panY: my - (my - vp.panY) * (nz / vp.zoom),
		};
		draw();
		bump();
	};

	// ── Wheel ──────────────────────────────────────────────────────────

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			const vp = vpRef.current;
			if (e.ctrlKey || !e.shiftKey) {
				const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
				zoomTo(vp.zoom * factor, mx, my);
			} else {
				viewportTouchedRef.current = true;
				vpRef.current = { ...vp, panX: vp.panX - e.deltaY, panY: vp.panY };
				draw();
			}
		};
		canvas.addEventListener("wheel", onWheel, { passive: false });
		return () => canvas.removeEventListener("wheel", onWheel);
	}, []);

	// ── Pointer helpers ────────────────────────────────────────────────

	const mousePos = (e: MouseEvent | React.MouseEvent) => {
		const rect = canvasRef.current!.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		return { mx, my, s: toScene(mx, my, vpRef.current) };
	};

	const setCursor = (c: string) => {
		const canvas = canvasRef.current;
		if (canvas) canvas.style.cursor = c;
	};

	const bypassSnap = () => ctrlRef.current;

	const refreshSnapTargets = (excludeIds: Set<string>) => {
		snapTargetsRef.current = buildSnapTargets(
			flatRef.current,
			sceneRef.current,
			excludeIds,
			editorRef.current.snap,
			varMap(),
		);
	};

	/**
	 * Topmost element under a scene point. Respects group isolation: outside a
	 * group you select the whole group, inside it you select its children.
	 */
	const pick = (p: Pt, deep: boolean): SceneNode | null => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!ctx) return null;
		const vars = varMap();
		const tol = 4 / vpRef.current.zoom;
		const iso = editorRef.current.isolationId;

		// Back-to-front render order → iterate in reverse for topmost first.
		for (let i = flatRef.current.length - 1; i >= 0; i--) {
			const n = flatRef.current[i];
			if (n.hidden || n.locked) continue;
			if (n.el.kind.type === "Group") continue;
			if (iso && !n.ancestors.includes(iso) && n.el.id !== iso) continue;
			if (!hitElement(ctx, n, p, vars, tol)) continue;

			if (deep) return n;
			// Walk up to the outermost ancestor that is still outside isolation.
			const stopAt = iso ? n.ancestors.indexOf(iso) + 1 : 0;
			const ancestorId = n.ancestors[stopAt];
			if (ancestorId) {
				const a = nodeById(flatRef.current, ancestorId);
				if (a && !a.locked) return a;
			}
			return n;
		}
		return null;
	};

	const pickRefImage = (p: Pt): RefImageMeta | null => {
		const imgs = refImagesRef.current;
		for (let i = imgs.length - 1; i >= 0; i--) {
			const img = imgs[i];
			if (!img.visible || img.locked) continue;
			if (p.x >= img.x && p.x <= img.x + img.w && p.y >= img.y && p.y <= img.y + img.h)
				return img;
		}
		return null;
	};

	// ── Commit helpers ─────────────────────────────────────────────────

	const commitOverrides = async () => {
		const ov = overridesRef.current;
		if (ov.size === 0) return;
		const patches: ElementPatch[] = [...ov.entries()].map(([id, kind]) => ({
			id,
			kind,
		}));
		// Keep the optimistic geometry on screen through the round-trip.
		useSceneStore.getState().setSceneLocal({
			...sceneRef.current,
			elements: updateElementInTree(sceneRef.current.elements, ov),
		});
		overridesRef.current = new Map();
		await useSceneStore.getState().updateElements(patches);
	};

	const setOverride = (id: string, kind: ElementKind) => {
		overridesRef.current.set(id, kind);
	};

	// ── Pen tool ───────────────────────────────────────────────────────

	/**
	 * Begin a pen stroke. An open path is only continued when the user asked
	 * for it (the Extend action) or clicked near its loose end — otherwise the
	 * click starts a fresh path, which is what Illustrator does.
	 */
	const startPen = (p: Pt) => {
		const ed = useEditorStore.getState();
		const sel = selectedNodes();
		const existing =
			sel.length === 1 && sel[0].el.kind.type === "Path" ? sel[0] : null;
		if (existing) {
			const shape = pathToNodes(
				(existing.el.kind as PathKind).commands,
				varMap(),
			);
			const tail = shape.nodes[shape.nodes.length - 1];
			const nearTail =
				!!tail &&
				(() => {
					const sp = matApply(existing.mat, tail.x, tail.y);
					return Math.hypot(sp.x - p.x, sp.y - p.y) * vpRef.current.zoom <= 12;
				})();
			if (!shape.closed && (ed.penExtend === existing.el.id || nearTail)) {
				ed.setPenExtend(null);
				const inv = matInvert(existing.mat);
				const local = matApply(inv, p.x, p.y);
				shape.nodes.push(cornerNode(local.x, local.y));
				penRef.current = {
					targetId: existing.el.id,
					shape,
					cursor: null,
					mat: existing.mat,
				};
				return shape.nodes.length - 1;
			}
		}
		ed.setPenExtend(null);
		penRef.current = {
			targetId: null,
			shape: { nodes: [cornerNode(p.x, p.y)], closed: false },
			cursor: null,
			mat: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		};
		return 0;
	};

	const finishPen = async () => {
		const draft = penRef.current;
		penRef.current = null;
		useEditorStore.getState().setPenExtend(null);
		if (!draft || draft.shape.nodes.length < 2) {
			draw();
			return;
		}
		const commands = nodesToPath(draft.shape);
		if (draft.targetId) {
			const node = nodeById(flatRef.current, draft.targetId);
			const kind = node?.el.kind;
			if (kind?.type === "Path") {
				await useSceneStore
					.getState()
					.updateElement(draft.targetId, { ...kind, commands });
			}
		} else {
			const el = makeElement("Path", {
				type: "Path",
				commands,
				style: { ...DEFAULT_STROKE },
			});
			await useSceneStore.getState().addElementFull(el, null);
			useEditorStore.getState().setSelection([el.id]);
		}
		draw();
	};

	const cancelPen = () => {
		penRef.current = null;
		useEditorStore.getState().setPenExtend(null);
		draw();
	};

	// ── Mouse down ─────────────────────────────────────────────────────

	const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (menu) setMenu(null);
		if (textEdit) commitTextEdit();
		if (e.button !== 0 && e.button !== 1) return;

		const { mx, my, s } = mousePos(e);
		const vp = vpRef.current;
		const ed = editorRef.current;
		const vars = varMap();
		reflatten();

		// Pan: middle mouse, space, or the hand tool.
		if (e.button === 1 || spaceRef.current || ed.tool === "hand") {
			dragRef.current = { t: "pan", mx0: mx, my0: my, px0: vp.panX, py0: vp.panY };
			setCursor("grabbing");
			return;
		}

		// ── Pen ──
		if (ed.tool === "pen") {
			const draft = penRef.current;
			// The path being drawn is not in the scene yet, so nothing to exclude.
			refreshSnapTargets(new Set(draft?.targetId ? [draft.targetId] : []));
			const snapped = snapPoint(
				s,
				snapTargetsRef.current!,
				ed.snap,
				vp.zoom,
				bypassSnap(),
			);
			guidesRef.current = snapped.guides;

			if (draft && draft.shape.nodes.length > 0) {
				const m = screenMat(draft.mat, vp);
				const first = matApply(m, draft.shape.nodes[0].x, draft.shape.nodes[0].y);
				if (Math.hypot(mx - first.x, my - first.y) <= 7) {
					draft.shape.closed = true;
					finishPen();
					return;
				}
				const inv = matInvert(draft.mat);
				const local = matApply(inv, snapped.pt.x, snapped.pt.y);
				draft.shape.nodes.push(cornerNode(local.x, local.y));
				dragRef.current = {
					t: "pen-handle",
					i: draft.shape.nodes.length - 1,
					anchor: local,
				};
			} else {
				const i = startPen(snapped.pt);
				const d = penRef.current!;
				dragRef.current = {
					t: "pen-handle",
					i,
					anchor: { x: d.shape.nodes[i].x, y: d.shape.nodes[i].y },
				};
			}
			draw();
			return;
		}

		// ── Drawing tools ──
		if (["rect", "ellipse", "arc", "line"].includes(ed.tool)) {
			refreshSnapTargets(new Set());
			const snapped = snapPoint(
				s,
				snapTargetsRef.current!,
				ed.snap,
				vp.zoom,
				bypassSnap(),
			);
			guidesRef.current = snapped.guides;
			dragRef.current = { t: "draw", tool: ed.tool, p0: snapped.pt, p1: snapped.pt };
			draw();
			return;
		}

		if (ed.tool === "text") {
			createTextAt(s);
			return;
		}

		// ── Handles on the current selection ──
		const hitH = hitHandles(handlesRef.current, mx, my);
		if (hitH && startHandleDrag(hitH, s, vars)) {
			draw();
			return;
		}

		// ── Direct select: anchors first, then the path body ──
		if (ed.tool === "direct") {
			const sel = selectedNodes();
			const pathNode = sel.length === 1 && sel[0].el.kind.type === "Path" ? sel[0] : null;
			if (pathNode) {
				const shape = pathToNodes((pathNode.el.kind as PathKind).commands, vars);
				// Alt-click a segment inserts an anchor there.
				if (altRef.current) {
					const inv = matInvert(pathNode.mat);
					const local = matApply(inv, s.x, s.y);
					const near = closestOnPath(shape, local);
					if (near && near.dist * vp.zoom < 8) {
						const next = insertNode(shape, near.seg, near.t);
						useEditorStore.getState().setNodeSelection([near.seg.i + 1]);
						useSceneStore.getState().updateElement(pathNode.el.id, {
							...(pathNode.el.kind as PathKind),
							commands: nodesToPath(next),
						});
						return;
					}
				}
			}
		}

		// ── Selection / move ──
		const deep = altRef.current || ed.tool === "direct";
		const hit = pick(s, deep);
		const additive = e.shiftKey;

		if (hit) {
			const store = useEditorStore.getState();
			let ids = store.selection;
			if (additive) {
				store.toggleSelected(hit.el.id);
				ids = useEditorStore.getState().selection;
			} else if (!ids.includes(hit.el.id)) {
				store.setSelection([hit.el.id]);
				ids = [hit.el.id];
			}
			if (ed.tool === "direct" && hit.el.kind.type === "Path") {
				store.setNodeSelection([]);
			}
			startMove(ids, s);
			draw();
			return;
		}

		const img = pickRefImage(s);
		if (img) {
			useEditorStore.getState().setSelection([img.id]);
			dragRef.current = { t: "move-img", id: img.id, s0: s, x0: img.x, y0: img.y };
			draw();
			return;
		}

		// Empty canvas → marquee
		if (!additive) useEditorStore.getState().setSelection([]);
		dragRef.current = { t: "marquee", x0: mx, y0: my, x1: mx, y1: my, additive };
		draw();
	};

	const startMove = (ids: string[], s: Pt) => {
		const nodes = transformRoots(flatRef.current, ids).filter((n) =>
			isMovable(n.el.kind),
		);
		if (nodes.length === 0) return;
		const box0 = selectionBBox(flatRef.current, ids);
		if (!box0) return;
		refreshSnapTargets(new Set(ids));
		dragRef.current = {
			t: "move",
			start: nodes.map((n) => ({ node: n, kind: n.el.kind })),
			s0: s,
			box0,
			moved: false,
		};
	};

	const startHandleDrag = (
		ph: PlacedHandle,
		s: Pt,
		vars: Map<string, number>,
	): boolean => {
		const ed = editorRef.current;
		const sel = selectedNodes();
		const h = ph.handle;

		// Reference image handles
		const refImg = refImagesRef.current.find((i) => ed.selection.includes(i.id));
		if (refImg && h.t === "scale") {
			dragRef.current = {
				t: "resize-img",
				id: refImg.id,
				h: h.h,
				s0: s,
				img0: { ...refImg },
			};
			return true;
		}

		if (h.t === "scale") {
			const single = sel.length === 1 && !sel[0].locked ? sel[0] : null;
			const box0 =
				single && single.bbox
					? single.bbox
					: selectionBBox(flatRef.current, ed.selection);
			if (!box0) return false;
			const nodes = transformRoots(flatRef.current, ed.selection).filter(
				(n) => n.bbox && n.sceneBBox,
			);
			if (nodes.length === 0) return false;
			refreshSnapTargets(new Set(ed.selection));
			dragRef.current = {
				t: "scale",
				h: h.h,
				s0: s,
				single,
				box0,
				start: nodes.map((n) => ({
					node: n,
					kind: n.el.kind,
					local: n.bbox!,
					scene: n.sceneBBox!,
				})),
			};
			return true;
		}

		const n = sel[0];
		if (!n) return false;

		if (h.t === "rotate" && n.el.kind.type === "Group" && n.bbox) {
			const centre = matApply(
				n.mat,
				rv(n.el.kind.pivot_x, vars),
				rv(n.el.kind.pivot_y, vars),
			);
			dragRef.current = {
				t: "rotate",
				id: n.el.id,
				k0: n.el.kind,
				centre,
				a0: Math.atan2(s.y - centre.y, s.x - centre.x),
				rot0: rv(n.el.kind.rotate, vars),
			};
			return true;
		}
		if (h.t === "pivot" && n.el.kind.type === "Group") {
			dragRef.current = { t: "pivot", id: n.el.id, k0: n.el.kind, node: n };
			return true;
		}
		if (h.t === "lineEnd" && n.el.kind.type === "Line") {
			refreshSnapTargets(new Set([n.el.id]));
			dragRef.current = {
				t: "lineEnd",
				id: n.el.id,
				k0: n.el.kind,
				i: h.i,
				node: n,
			};
			return true;
		}
		if (h.t === "arcAngle" && n.el.kind.type === "Arc") {
			dragRef.current = {
				t: "arcAngle",
				id: n.el.id,
				k0: n.el.kind,
				i: h.i,
				node: n,
			};
			return true;
		}
		if (h.t === "node" && n.el.kind.type === "Path") {
			const shape = pathToNodes(n.el.kind.commands, vars);
			const store = useEditorStore.getState();
			if (altRef.current) {
				// Alt-click toggles the anchor between corner and smooth.
				const next = toggleSmooth(shape, h.i);
				store.setNodeSelection([h.i]);
				useSceneStore.getState().updateElement(n.el.id, {
					...(n.el.kind as PathKind),
					commands: nodesToPath(next),
				});
				return true;
			}
			let idxs = store.nodeSelection;
			if (shiftRef.current) {
				store.toggleNode(h.i);
				idxs = useEditorStore.getState().nodeSelection;
			} else if (!idxs.includes(h.i)) {
				store.setNodeSelection([h.i]);
				idxs = [h.i];
			}
			refreshSnapTargets(new Set([n.el.id]));
			dragRef.current = {
				t: "node",
				id: n.el.id,
				shape0: shape,
				idxs,
				s0: s,
				node: n,
			};
			return true;
		}
		if ((h.t === "handleIn" || h.t === "handleOut") && n.el.kind.type === "Path") {
			dragRef.current = {
				t: "handle",
				id: n.el.id,
				shape0: pathToNodes(n.el.kind.commands, vars),
				i: h.i,
				which: h.t === "handleIn" ? "in" : "out",
				node: n,
			};
			return true;
		}
		return false;
	};

	// ── Mouse move ─────────────────────────────────────────────────────

	const globalMoveRef = useRef<(e: MouseEvent) => void>(() => {});
	const globalUpRef = useRef<(e: MouseEvent) => void>(() => {});

	globalMoveRef.current = (e: MouseEvent) => {
		const drag = dragRef.current;
		const { mx, my, s } = mousePos(e);
		const vp = vpRef.current;
		const ed = editorRef.current;
		const vars = varMap();
		cursorSceneRef.current = s;
		badgeRef.current = null;

		if (drag.t === "none") {
			reflatten();
			updateHover(mx, my, s);
			if (penRef.current) {
				penRef.current.cursor = s;
				draw();
			} else if (ed.showRulers) {
				draw();
			}
			return;
		}

		const targets =
			snapTargetsRef.current ??
			buildSnapTargets(flatRef.current, sceneRef.current, new Set(), ed.snap, vars);

		switch (drag.t) {
			case "pan": {
				viewportTouchedRef.current = true;
				vpRef.current = {
					...vp,
					panX: drag.px0 + (mx - drag.mx0),
					panY: drag.py0 + (my - drag.my0),
				};
				break;
			}
			case "marquee": {
				drag.x1 = mx;
				drag.y1 = my;
				break;
			}
			case "move": {
				let dx = s.x - drag.s0.x;
				let dy = s.y - drag.s0.y;
				if (shiftRef.current) {
					// Constrain to the dominant axis.
					if (Math.abs(dx) > Math.abs(dy)) dy = 0;
					else dx = 0;
				}
				const moved = {
					x: drag.box0.x + dx,
					y: drag.box0.y + dy,
					w: drag.box0.w,
					h: drag.box0.h,
				};
				const snapped = snapBBox(moved, targets, ed.snap, vp.zoom, bypassSnap());
				guidesRef.current = snapped.guides;
				dx += snapped.dx;
				dy += snapped.dy;
				drag.moved = Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6;

				overridesRef.current = new Map();
				for (const { node, kind } of drag.start) {
					const local = matApplyVec(matInvert(node.mat), dx, dy);
					setOverride(node.el.id, moveElementKind(kind, local.x, local.y));
				}
				badgeRef.current = `${Math.round(drag.box0.x + dx)}, ${Math.round(drag.box0.y + dy)}`;
				break;
			}
			case "scale": {
				applyScaleDrag(drag, s, targets, vars);
				break;
			}
			case "rotate": {
				const a = Math.atan2(s.y - drag.centre.y, s.x - drag.centre.x);
				let deg = drag.rot0 + ((a - drag.a0) * 180) / Math.PI;
				if (shiftRef.current) deg = Math.round(deg / 15) * 15;
				setOverride(drag.id, {
					...drag.k0,
					rotate: litSet(drag.k0.rotate, deg),
				});
				badgeRef.current = `${deg.toFixed(1)}°`;
				break;
			}
			case "pivot": {
				const local = matApply(matInvert(drag.node.mat), s.x, s.y);
				const snapped = snapPoint(s, targets, ed.snap, vp.zoom, bypassSnap());
				guidesRef.current = snapped.guides;
				const lp = matApply(matInvert(drag.node.mat), snapped.pt.x, snapped.pt.y);
				void local;
				setOverride(drag.id, {
					...drag.k0,
					pivot_x: litSet(drag.k0.pivot_x, lp.x),
					pivot_y: litSet(drag.k0.pivot_y, lp.y),
				});
				badgeRef.current = `pivot ${Math.round(lp.x)}, ${Math.round(lp.y)}`;
				break;
			}
			case "lineEnd": {
				const k = drag.k0;
				const other =
					drag.i === 0
						? { x: rv(k.x2, vars), y: rv(k.y2, vars) }
						: { x: rv(k.x1, vars), y: rv(k.y1, vars) };
				const inv = matInvert(drag.node.mat);
				let local = matApply(inv, s.x, s.y);
				if (shiftRef.current)
					local = constrainAngle(other, local, ed.snap.angleStep || 15);
				else {
					const snapped = snapPoint(s, targets, ed.snap, vp.zoom, bypassSnap());
					guidesRef.current = snapped.guides;
					local = matApply(inv, snapped.pt.x, snapped.pt.y);
				}
				setOverride(
					drag.id,
					drag.i === 0
						? { ...k, x1: litSet(k.x1, local.x), y1: litSet(k.y1, local.y) }
						: { ...k, x2: litSet(k.x2, local.x), y2: litSet(k.y2, local.y) },
				);
				const len = Math.hypot(local.x - other.x, local.y - other.y);
				badgeRef.current = `${len.toFixed(1)} px`;
				break;
			}
			case "arcAngle": {
				const k = drag.k0;
				const local = matApply(matInvert(drag.node.mat), s.x, s.y);
				let a = Math.atan2(local.y - rv(k.cy, vars), local.x - rv(k.cx, vars));
				if (shiftRef.current) {
					const step = ((ed.snap.angleStep || 15) * Math.PI) / 180;
					a = Math.round(a / step) * step;
				}
				setOverride(
					drag.id,
					drag.i === 0
						? { ...k, a0: litSet(k.a0, a) }
						: { ...k, a1: litSet(k.a1, a) },
				);
				badgeRef.current = `${((a * 180) / Math.PI).toFixed(1)}°`;
				break;
			}
			case "draw": {
				let p1 = s;
				if (shiftRef.current) {
					if (drag.tool === "line") {
						p1 = constrainAngle(drag.p0, s, ed.snap.angleStep || 15);
					} else {
						const d = Math.max(Math.abs(s.x - drag.p0.x), Math.abs(s.y - drag.p0.y));
						p1 = {
							x: drag.p0.x + Math.sign(s.x - drag.p0.x) * d,
							y: drag.p0.y + Math.sign(s.y - drag.p0.y) * d,
						};
					}
				}
				const snapped = snapPoint(p1, targets, ed.snap, vp.zoom, bypassSnap());
				guidesRef.current = snapped.guides;
				drag.p1 = shiftRef.current ? p1 : snapped.pt;
				badgeRef.current = drawBadgeText(drag);
				break;
			}
			case "node": {
				const inv = matInvert(drag.node.mat);
				const snapped = snapPoint(s, targets, ed.snap, vp.zoom, bypassSnap());
				guidesRef.current = snapped.guides;
				const from = matApply(inv, drag.s0.x, drag.s0.y);
				const to = matApply(inv, snapped.pt.x, snapped.pt.y);
				let next: PathShape;
				if (drag.idxs.length === 1) {
					next = setNodePos(drag.shape0, drag.idxs[0], to);
				} else {
					next = moveNodes(drag.shape0, drag.idxs, to.x - from.x, to.y - from.y);
				}
				setOverride(drag.id, {
					...(drag.node.el.kind as PathKind),
					commands: nodesToPath(next),
				});
				badgeRef.current = `${Math.round(to.x)}, ${Math.round(to.y)}`;
				break;
			}
			case "handle": {
				const inv = matInvert(drag.node.mat);
				const to = matApply(inv, s.x, s.y);
				const next = moveHandle(
					drag.shape0,
					drag.i,
					drag.which,
					to,
					altRef.current,
				);
				setOverride(drag.id, {
					...(drag.node.el.kind as PathKind),
					commands: nodesToPath(next),
				});
				break;
			}
			case "pen-handle": {
				const draft = penRef.current;
				if (!draft) break;
				const inv = matInvert(draft.mat);
				const to = matApply(inv, s.x, s.y);
				const n = draft.shape.nodes[drag.i];
				if (!n) break;
				const dx = to.x - drag.anchor.x;
				const dy = to.y - drag.anchor.y;
				if (Math.hypot(dx, dy) > 2 / vp.zoom) {
					n.hOut = { x: drag.anchor.x + dx, y: drag.anchor.y + dy };
					n.hIn = { x: drag.anchor.x - dx, y: drag.anchor.y - dy };
				}
				break;
			}
			case "move-img": {
				const img = refImagesRef.current.find((i) => i.id === drag.id);
				if (!img) break;
				let dx = s.x - drag.s0.x;
				let dy = s.y - drag.s0.y;
				const moved = { x: drag.x0 + dx, y: drag.y0 + dy, w: img.w, h: img.h };
				const snapped = snapBBox(moved, targets, ed.snap, vp.zoom, bypassSnap());
				guidesRef.current = snapped.guides;
				dx += snapped.dx;
				dy += snapped.dy;
				localImgRef.current = { ...img, x: drag.x0 + dx, y: drag.y0 + dy };
				break;
			}
			case "resize-img": {
				const init = drag.img0;
				const aspect = init.w / init.h;
				const ddx = s.x - drag.s0.x;
				let dw = 0;
				if (drag.h === "br" || drag.h === "tr") dw = ddx;
				else if (drag.h === "bl" || drag.h === "tl") dw = -ddx;
				const newW = Math.max(10, init.w + dw);
				const newH = Math.max(10, newW / aspect);
				const adw = newW - init.w;
				const adh = newH - init.h;
				let nx = init.x;
				let ny = init.y;
				if (drag.h === "tl") {
					nx -= adw;
					ny -= adh;
				} else if (drag.h === "bl") nx -= adw;
				else if (drag.h === "tr") ny -= adh;
				localImgRef.current = { ...init, x: nx, y: ny, w: newW, h: newH };
				badgeRef.current = `${Math.round(newW)} × ${Math.round(newH)}`;
				break;
			}
		}
		draw();
	};

	const drawBadgeText = (drag: Extract<Drag, { t: "draw" }>): string => {
		const w = Math.abs(drag.p1.x - drag.p0.x);
		const h = Math.abs(drag.p1.y - drag.p0.y);
		if (drag.tool === "line")
			return `${Math.hypot(drag.p1.x - drag.p0.x, drag.p1.y - drag.p0.y).toFixed(1)} px`;
		if (drag.tool === "ellipse" || drag.tool === "arc")
			return `r ${Math.hypot(drag.p1.x - drag.p0.x, drag.p1.y - drag.p0.y).toFixed(1)}`;
		return `${Math.round(w)} × ${Math.round(h)}`;
	};

	const applyScaleDrag = (
		drag: Extract<Drag, { t: "scale" }>,
		s: Pt,
		targets: SnapTargets,
		vars: Map<string, number>,
	) => {
		const ed = editorRef.current;
		const vp = vpRef.current;
		const snapped = snapPoint(s, targets, ed.snap, vp.zoom, bypassSnap());
		guidesRef.current = snapped.guides;
		const scenePt = snapped.pt;

		const buildBox = (box0: BBox, p: Pt, h: ScaleHandle): BBox => {
			let { x, y, w, h: hh } = box0;
			const right = x + w;
			const bottom = y + hh;
			if (h.includes("l")) {
				x = p.x;
				w = right - p.x;
			}
			if (h.includes("r")) w = p.x - x;
			if (h.startsWith("t")) {
				y = p.y;
				hh = bottom - p.y;
			}
			if (h.startsWith("b")) hh = p.y - y;

			if (shiftRef.current && box0.w > 1e-6 && box0.h > 1e-6) {
				// Preserve aspect from the anchor corner.
				const ar = box0.w / box0.h;
				if (Math.abs(w) / ar > Math.abs(hh)) hh = Math.sign(hh || 1) * (Math.abs(w) / ar);
				else w = Math.sign(w || 1) * (Math.abs(hh) * ar);
				if (h.includes("l")) x = right - w;
				if (h.startsWith("t")) y = bottom - hh;
			}
			if (altRef.current) {
				// Scale about the centre.
				const cx = box0.x + box0.w / 2;
				const cy = box0.y + box0.h / 2;
				w = Math.abs(p.x - cx) * 2;
				hh = Math.abs(p.y - cy) * 2;
				x = cx - w / 2;
				y = cy - hh / 2;
			}
			return {
				x: w < 0 ? x + w : x,
				y: hh < 0 ? y + hh : y,
				w: Math.max(0.5, Math.abs(w)),
				h: Math.max(0.5, Math.abs(hh)),
			};
		};

		overridesRef.current = new Map();

		if (drag.single) {
			const entry = drag.start.find((e) => e.node.el.id === drag.single?.el.id);
			if (!entry) return;
			const local = matApply(matInvert(entry.node.mat), scenePt.x, scenePt.y);
			const to = buildBox(drag.box0, local, drag.h);
			setOverride(
				entry.node.el.id,
				scaleElementKind(entry.kind, drag.box0, to, vars),
			);
			badgeRef.current = `${to.w.toFixed(1)} × ${to.h.toFixed(1)}`;
			return;
		}

		const to = buildBox(drag.box0, scenePt, drag.h);
		const from = drag.box0;
		const sx = from.w > 1e-6 ? to.w / from.w : 1;
		const sy = from.h > 1e-6 ? to.h / from.h : 1;
		const map = (p: Pt): Pt => ({
			x: to.x + (p.x - from.x) * sx,
			y: to.y + (p.y - from.y) * sy,
		});
		for (const { node, kind, local, scene: sb } of drag.start) {
			const c = bboxFromPts([
				map({ x: sb.x, y: sb.y }),
				map({ x: sb.x + sb.w, y: sb.y + sb.h }),
			])!;
			const localTo = bboxTransform(c, matInvert(node.mat));
			setOverride(node.el.id, scaleElementKind(kind, local, localTo, vars));
		}
		badgeRef.current = `${to.w.toFixed(0)} × ${to.h.toFixed(0)}`;
	};

	const updateHover = (mx: number, my: number, s: Pt) => {
		const ed = editorRef.current;
		if (spaceRef.current || ed.tool === "hand") {
			setCursor("grab");
			hoverIdRef.current = null;
			return;
		}
		if (ed.tool === "pen") {
			setCursor("crosshair");
			return;
		}
		if (["rect", "ellipse", "arc", "line", "text"].includes(ed.tool)) {
			setCursor("crosshair");
			hoverIdRef.current = null;
			return;
		}
		const hh = hitHandles(handlesRef.current, mx, my);
		hoverHandleRef.current = hh?.handle ?? null;
		if (hh) {
			setCursor(hh.cursor);
			return;
		}
		const hit = pick(s, altRef.current || ed.tool === "direct");
		const prev = hoverIdRef.current;
		hoverIdRef.current = hit?.el.id ?? null;
		if (hit) setCursor(ed.selection.includes(hit.el.id) ? "move" : "pointer");
		else if (pickRefImage(s)) setCursor("pointer");
		else setCursor("default");
		if (prev !== hoverIdRef.current) draw();
	};

	// ── Mouse up ───────────────────────────────────────────────────────

	globalUpRef.current = async (e: MouseEvent) => {
		const drag = dragRef.current;
		if (drag.t === "none") return;
		const ed = editorRef.current;
		guidesRef.current = [];
		badgeRef.current = null;

		if (drag.t === "pen-handle") {
			dragRef.current = { t: "none" };
			draw();
			return;
		}

		dragRef.current = { t: "none" };

		switch (drag.t) {
			case "marquee": {
				const r = {
					x: Math.min(drag.x0, drag.x1),
					y: Math.min(drag.y0, drag.y1),
					w: Math.abs(drag.x1 - drag.x0),
					h: Math.abs(drag.y1 - drag.y0),
				};
				if (r.w > 3 || r.h > 3) {
					const vp = vpRef.current;
					const sceneRect = {
						x: (r.x - vp.panX) / vp.zoom,
						y: (r.y - vp.panY) / vp.zoom,
						w: r.w / vp.zoom,
						h: r.h / vp.zoom,
					};
					const iso = ed.isolationId;
					const hits: string[] = [];
					for (const n of flatRef.current) {
						if (n.hidden || n.locked || !n.sceneBBox) continue;
						// A marquee only picks up siblings at the level being edited.
						const parent = n.ancestors[n.ancestors.length - 1] ?? null;
						if (parent !== iso) continue;
						if (bboxIntersects(sceneRect, n.sceneBBox)) hits.push(n.el.id);
					}
					if (drag.additive) useEditorStore.getState().addToSelection(hits);
					else useEditorStore.getState().setSelection(hits);
				}
				break;
			}
			case "move": {
				// A click that never moved should not land an undo step.
				if (!drag.moved) overridesRef.current = new Map();
				else await commitOverrides();
				break;
			}
			case "scale":
			case "rotate":
			case "pivot":
			case "lineEnd":
			case "arcAngle":
			case "node":
			case "handle": {
				await commitOverrides();
				break;
			}
			case "draw": {
				await commitDraw(drag);
				break;
			}
			case "move-img":
			case "resize-img": {
				if (localImgRef.current) {
					const { id, x, y, w, h } = localImgRef.current;
					useRefImageStore.getState().updateImage(id, { x, y, w, h });
					localImgRef.current = null;
				}
				break;
			}
		}

		setCursor(spaceRef.current ? "grab" : "default");
		void e;
		draw();
	};

	const commitDraw = async (drag: Extract<Drag, { t: "draw" }>) => {
		const { p0, p1, tool: t } = drag;
		const dx = p1.x - p0.x;
		const dy = p1.y - p0.y;
		const tiny = Math.hypot(dx, dy) < 2;

		let el: SceneElement | null = null;
		if (t === "rect") {
			const w = tiny ? 100 : Math.abs(dx);
			const h = tiny ? 80 : Math.abs(dy);
			const x = tiny ? p0.x : Math.min(p0.x, p1.x);
			const y = tiny ? p0.y : Math.min(p0.y, p1.y);
			el = makeElement("Rectangle", {
				type: "Rect",
				x: lit(x),
				y: lit(y),
				w: lit(w),
				h: lit(h),
				radius: lit(0),
				style: { ...DEFAULT_FILL },
			});
		} else if (t === "ellipse") {
			const r = tiny ? 50 : Math.hypot(dx, dy);
			el = makeElement("Circle", {
				type: "Circle",
				cx: lit(p0.x),
				cy: lit(p0.y),
				r: lit(r),
				style: { ...DEFAULT_FILL },
			});
		} else if (t === "arc") {
			const r = tiny ? 60 : Math.hypot(dx, dy);
			const a = Math.atan2(dy, dx);
			el = makeElement("Arc", {
				type: "Arc",
				cx: lit(p0.x),
				cy: lit(p0.y),
				r: lit(r),
				a0: lit(tiny ? 0 : a),
				a1: lit(tiny ? Math.PI : a + Math.PI / 2),
				dir: "Cw",
				style: { ...DEFAULT_STROKE, stroke_width: 3 },
			});
		} else if (t === "line") {
			const end = tiny ? { x: p0.x + 120, y: p0.y } : p1;
			el = makeElement("Line", {
				type: "Line",
				x1: lit(p0.x),
				y1: lit(p0.y),
				x2: lit(end.x),
				y2: lit(end.y),
				style: { ...DEFAULT_STROKE },
			});
		}
		if (!el) return;

		const parent = editorRef.current.isolationId;
		await useSceneStore.getState().addElementFull(el, parent);
		useEditorStore.getState().setSelection([el.id]);
		if (!editorRef.current.stickyTools) useEditorStore.getState().setTool("select");
	};

	useEffect(() => {
		const onMove = (e: MouseEvent) => globalMoveRef.current(e);
		const onUp = (e: MouseEvent) => globalUpRef.current(e);
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
		return () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
		};
	}, []);

	// ── Double click: enter group / edit text / insert anchor ───────────

	const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
		const { s } = mousePos(e);
		reflatten();
		if (penRef.current) {
			finishPen();
			return;
		}
		const hitDeep = pick(s, true);
		if (!hitDeep) {
			useEditorStore.getState().setIsolation(null);
			return;
		}
		if (hitDeep.el.kind.type === "Text") {
			openTextEdit(hitDeep);
			return;
		}
		// Step one level deeper into the group hierarchy.
		const ed = editorRef.current;
		const idx = ed.isolationId ? hitDeep.ancestors.indexOf(ed.isolationId) : -1;
		const nextGroup = hitDeep.ancestors[idx + 1];
		if (nextGroup) {
			useEditorStore.getState().setIsolation(nextGroup);
			useEditorStore.getState().setSelection([hitDeep.el.id]);
		} else {
			useEditorStore.getState().setSelection([hitDeep.el.id]);
		}
		draw();
	};

	// ── Inline text editing ────────────────────────────────────────────

	const openTextEdit = (n: SceneNode) => {
		const k = n.el.kind as TextKind;
		const vars = varMap();
		const p = matApply(
			screenMat(n.mat, vpRef.current),
			rv(k.x, vars),
			rv(k.y, vars),
		);
		const size = rv(k.font_size, vars) * vpRef.current.zoom;
		setTextEdit({
			id: n.el.id,
			value: k.text ?? "",
			left: p.x,
			top: p.y - size,
			size,
		});
	};

	const commitTextEdit = () => {
		const te = textEdit;
		setTextEdit(null);
		if (!te) return;
		const n = nodeById(flatRef.current, te.id);
		if (!n || n.el.kind.type !== "Text") return;
		useSceneStore.getState().updateElement(te.id, {
			...n.el.kind,
			text: te.value.length > 0 ? te.value : null,
		});
	};

	const createTextAt = async (p: Pt) => {
		const el = makeElement("Text", {
			type: "Text",
			x: lit(p.x),
			y: lit(p.y),
			content: lit(0),
			font_size: lit(24),
			font: "sans",
			text: "Label",
			align_h: "Left",
			align_v: "Baseline",
			decimals: 0,
			style: { ...DEFAULT_FILL, fill: { Rgba: [0.91, 0.91, 0.91, 1] } },
		});
		await useSceneStore.getState().addElementFull(el, editorRef.current.isolationId);
		useEditorStore.getState().setSelection([el.id]);
		if (!editorRef.current.stickyTools) useEditorStore.getState().setTool("select");
		reflatten();
		const n = nodeById(flatRef.current, el.id);
		if (n) openTextEdit(n);
	};

	// ── Context menu ───────────────────────────────────────────────────

	const handleContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();
		const { mx, my, s } = mousePos(e);
		reflatten();
		const hit = pick(s, altRef.current);
		if (hit && !editorRef.current.selection.includes(hit.el.id)) {
			useEditorStore.getState().setSelection([hit.el.id]);
		}
		setMenu({ x: mx, y: my });
	};

	// ── Keyboard ───────────────────────────────────────────────────────

	useEffect(() => {
		const onKeyDown = async (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target?.matches?.("input,textarea,[contenteditable]")) return;

			altRef.current = e.altKey;
			shiftRef.current = e.shiftKey;
			ctrlRef.current = e.ctrlKey || e.metaKey;
			const ed = useEditorStore.getState();
			const mod = e.ctrlKey || e.metaKey;
			reflatten();

			// Tool shortcuts (no modifiers)
			if (!mod && !e.altKey) {
				const t = TOOL_KEYS[e.key.toLowerCase()];
				if (t) {
					e.preventDefault();
					ed.setTool(t);
					return;
				}
			}

			if (e.code === "Space" && !e.repeat) {
				e.preventDefault();
				spaceRef.current = true;
				if (dragRef.current.t === "none") setCursor("grab");
				return;
			}

			if (e.key === "Escape") {
				e.preventDefault();
				if (penRef.current) cancelPen();
				else if (ed.isolationId) ed.setIsolation(null);
				else ed.setSelection([]);
				return;
			}

			if (e.key === "Enter") {
				if (penRef.current) {
					e.preventDefault();
					await finishPen();
				}
				return;
			}

			if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				if (penRef.current) {
					const d = penRef.current;
					d.shape.nodes.pop();
					if (d.shape.nodes.length === 0) cancelPen();
					else draw();
					return;
				}
				// Deleting anchors when nodes are selected, else whole elements.
				const sel = selectedNodes();
				if (
					ed.nodeSelection.length > 0 &&
					sel.length === 1 &&
					sel[0].el.kind.type === "Path"
				) {
					const kind = sel[0].el.kind as PathKind;
					const shape = pathToNodes(kind.commands, varMap());
					const next = deleteNodes(shape, ed.nodeSelection);
					ed.setNodeSelection([]);
					if (next.nodes.length < 2) {
						await useSceneStore.getState().deleteElement(sel[0].el.id);
					} else {
						await useSceneStore
							.getState()
							.updateElement(sel[0].el.id, { ...kind, commands: nodesToPath(next) });
					}
					return;
				}
				const refIds = ed.selection.filter((id) =>
					refImagesRef.current.some((i) => i.id === id),
				);
				const elIds = ed.selection.filter((id) => !refIds.includes(id));
				for (const id of refIds) useRefImageStore.getState().deleteImage(id);
				if (elIds.length) await useSceneStore.getState().deleteElements(elIds);
				ed.setSelection([]);
				bump();
				return;
			}

			// Arrow nudge
			if (e.key.startsWith("Arrow")) {
				if (ed.selection.length === 0) return;
				e.preventDefault();
				const step = e.shiftKey ? ed.snap.gridSize * 2 : e.altKey ? 0.5 : 1;
				const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
				const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
				await nudgeSelection(flatRef.current, ed.selection, dx, dy);
				return;
			}

			if (mod && e.key.toLowerCase() === "a") {
				e.preventDefault();
				const ids = flatRef.current
					.filter((n) => !n.hidden && !n.locked && n.ancestors.length === 0)
					.map((n) => n.el.id);
				ed.setSelection(ids);
				return;
			}
			if (mod && e.key.toLowerCase() === "d") {
				e.preventDefault();
				await duplicateSelection(ed.selection, 10, reflatten);
				return;
			}
			if (mod && e.key.toLowerCase() === "g") {
				e.preventDefault();
				if (e.shiftKey) {
					for (const id of ed.selection) {
						const n = nodeById(flatRef.current, id);
						if (n?.el.kind.type === "Group")
							await useSceneStore.getState().ungroup(id);
					}
				} else if (ed.selection.length >= 2) {
					const gid = await useSceneStore.getState().groupElements(ed.selection);
					if (gid) ed.setSelection([gid]);
				}
				return;
			}
			if (mod && (e.key === "]" || e.key === "[")) {
				e.preventDefault();
				const mode = e.key === "]" ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward";
				for (const id of ed.selection)
					await reorderSelection(sceneRef.current, id, mode);
				return;
			}
			if (mod && e.key.toLowerCase() === "f") {
				e.preventDefault();
				fitScene();
				return;
			}
			if (mod && e.key === "0") {
				e.preventDefault();
				fitScene();
				return;
			}
			if (mod && e.key === "1") {
				e.preventDefault();
				zoomTo(1);
				return;
			}
			if (mod && (e.key === "=" || e.key === "+")) {
				e.preventDefault();
				zoomTo(vpRef.current.zoom * 1.25);
				return;
			}
			if (mod && e.key === "-") {
				e.preventDefault();
				zoomTo(vpRef.current.zoom / 1.25);
				return;
			}
			if (!mod && e.key === "'") {
				e.preventDefault();
				ed.setShowGrid(!ed.showGrid);
				draw();
				return;
			}
			if (!mod && e.key === ";") {
				e.preventDefault();
				ed.patchSnap({ enabled: !ed.snap.enabled });
				return;
			}
		};

		const onKeyUp = (e: KeyboardEvent) => {
			altRef.current = e.altKey;
			shiftRef.current = e.shiftKey;
			ctrlRef.current = e.ctrlKey || e.metaKey;
			if (e.code === "Space") {
				spaceRef.current = false;
				if (dragRef.current.t === "none") setCursor("default");
			}
		};

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
		};
	}, []);

	// ── Reference image loading ────────────────────────────────────────

	const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		for (let i = 0; i < e.dataTransfer.files.length; i++) {
			if (e.dataTransfer.files[i].type.startsWith("image/")) {
				loadRefImageFromFile(e.dataTransfer.files[i]).then(() => bump());
				break;
			}
		}
	};

	useEffect(() => {
		const onPaste = (e: ClipboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (target?.matches?.("input,textarea,[contenteditable]")) return;
			loadRefImageFromClipboard(e.clipboardData?.items ?? null)
				.then((id) => id && bump())
				.catch((err) => console.error("Failed to paste reference image:", err));
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, []);

	// ── Chrome callbacks ───────────────────────────────────────────────

	const runAlign = async (mode: AlignMode) => {
		reflatten();
		const patches = alignPatches(
			flatRef.current,
			useEditorStore.getState().selection,
			mode,
			sceneRef.current,
		);
		await useSceneStore.getState().updateElements(patches);
	};

	const runDistribute = async (mode: DistributeMode) => {
		reflatten();
		const patches = distributePatches(
			flatRef.current,
			useEditorStore.getState().selection,
			mode,
		);
		await useSceneStore.getState().updateElements(patches);
	};

	const handlePickImage = async () => {
		try {
			const id = await pickRefImageViaDialog();
			if (id) bump();
		} catch (err) {
			console.error("Failed to load reference image:", err);
		}
	};

	// Keep the overlay chrome in step with viewport changes.
	useEffect(() => {
		const id = setInterval(() => {
			const z = Math.round(vpRef.current.zoom * 100);
			const label = document.getElementById("zoom-readout");
			if (label) label.textContent = `${z}%`;
		}, 120);
		return () => clearInterval(id);
	}, []);

	return (
		<div
			ref={containerRef}
			className="flex-1 relative overflow-hidden"
			style={{ background: "#000000" }}
			onDragOver={(e) => e.preventDefault()}
			onDrop={handleDrop}
		>
			<canvas
				ref={canvasRef}
				className="absolute inset-0 block"
				onMouseDown={handleMouseDown}
				onDoubleClick={handleDoubleClick}
				onContextMenu={handleContextMenu}
			/>

			{textEdit && (
				<input
					autoFocus
					value={textEdit.value}
					onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
					onBlur={commitTextEdit}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === "Escape") {
							e.preventDefault();
							(e.target as HTMLInputElement).blur();
						}
						e.stopPropagation();
					}}
					className="absolute outline-none"
					style={{
						left: textEdit.left,
						top: textEdit.top,
						fontSize: Math.max(11, textEdit.size),
						minWidth: 60,
						padding: "1px 4px",
						background: "rgba(10,10,10,0.95)",
						border: `1px solid ${UI.accent}`,
						borderRadius: 3,
						color: "#e8e8e8",
					}}
				/>
			)}

			<CanvasChrome
				tool={tool}
				selectionCount={selection.length}
				snap={snap}
				showGrid={showGrid}
				showRulers={showRulers}
				showOutlines={showOutlines}
				isolationId={isolationId}
				isolationName={
					isolationId
						? (nodeById(flatRef.current, isolationId)?.el.name ?? "Group")
						: null
				}
				menu={menu}
				onCloseMenu={() => setMenu(null)}
				onFit={fitScene}
				onZoom={zoomTo}
				getZoom={() => vpRef.current.zoom}
				onAddImage={handlePickImage}
				onAlign={runAlign}
				onDistribute={runDistribute}
				onExitIsolation={() => useEditorStore.getState().setIsolation(null)}
				onReorder={async (mode) => {
					for (const id of useEditorStore.getState().selection)
						await reorderSelection(sceneRef.current, id, mode);
				}}
				onDuplicate={async () => {
					reflatten();
					await duplicateSelection(
						useEditorStore.getState().selection,
						10,
						reflatten,
					);
				}}
				onDelete={async () => {
					const ids = useEditorStore.getState().selection;
					const refIds = ids.filter((id) =>
						refImagesRef.current.some((i) => i.id === id),
					);
					for (const id of refIds) useRefImageStore.getState().deleteImage(id);
					const elIds = ids.filter((id) => !refIds.includes(id));
					if (elIds.length) await useSceneStore.getState().deleteElements(elIds);
					useEditorStore.getState().setSelection([]);
					bump();
				}}
				onGroup={async () => {
					const ids = useEditorStore.getState().selection;
					if (ids.length >= 2) {
						const gid = await useSceneStore.getState().groupElements(ids);
						if (gid) useEditorStore.getState().setSelection([gid]);
					}
				}}
				onUngroup={async () => {
					reflatten();
					for (const id of useEditorStore.getState().selection) {
						const n = nodeById(flatRef.current, id);
						if (n?.el.kind.type === "Group")
							await useSceneStore.getState().ungroup(id);
					}
				}}
				onToggleLock={async () => {
					reflatten();
					for (const id of useEditorStore.getState().selection) {
						const n = nodeById(flatRef.current, id);
						if (n) await useSceneStore.getState().setElementLocked(id, !n.el.locked);
					}
				}}
				onToggleHide={async () => {
					reflatten();
					for (const id of useEditorStore.getState().selection) {
						const n = nodeById(flatRef.current, id);
						if (n)
							await useSceneStore.getState().setElementVisible(id, !n.el.visible);
					}
				}}
			/>
		</div>
	);
}


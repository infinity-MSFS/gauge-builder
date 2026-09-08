import {
	bboxUnion,
	matApplyVec,
	matInvert,
	moveElementKind,
	nodeById,
	type BBox,
	type SceneNode,
} from "./geometry";
import type { ElementPatch, Scene } from "../store/sceneStore";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";

export type AlignMode =
	| "left"
	| "hcenter"
	| "right"
	| "top"
	| "vcenter"
	| "bottom";

export type DistributeMode = "hspace" | "vspace";

/** Scene-space union box of the given nodes. */
export function selectionBBox(
	nodes: SceneNode[],
	ids: string[],
): BBox | null {
	let acc: BBox | null = null;
	for (const id of ids) {
		const n = nodeById(nodes, id);
		if (n?.sceneBBox) acc = bboxUnion(acc, n.sceneBBox);
	}
	return acc;
}

/**
 * Drop any selected element that also has a selected ancestor. Transforming
 * both would apply the delta twice, so only the outermost member is driven and
 * its children ride along through the group transform.
 */
export function transformRoots(
	nodes: SceneNode[],
	ids: string[],
): SceneNode[] {
	const set = new Set(ids);
	const out: SceneNode[] = [];
	for (const id of ids) {
		const n = nodeById(nodes, id);
		if (!n || n.locked) continue;
		if (n.ancestors.some((a) => set.has(a))) continue;
		out.push(n);
	}
	return out;
}

/**
 * Turn a scene-space translation into a patch for one element, converting the
 * delta into that element's own parent space first.
 */
export function movePatch(
	node: SceneNode,
	dx: number,
	dy: number,
): ElementPatch | null {
	if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
	const local = matApplyVec(matInvert(node.mat), dx, dy);
	return {
		id: node.el.id,
		kind: moveElementKind(node.el.kind, local.x, local.y),
	};
}

/**
 * Align to the selection's own bounds, or to the artboard when only one
 * element is selected — the behaviour designers expect from Illustrator.
 */
export function alignPatches(
	nodes: SceneNode[],
	ids: string[],
	mode: AlignMode,
	scene: Scene,
): ElementPatch[] {
	const boxes = transformRoots(nodes, ids).filter((n) => !!n.sceneBBox);
	if (boxes.length === 0) return [];

	const ref: BBox =
		boxes.length > 1
			? selectionBBox(nodes, boxes.map((b) => b.el.id))!
			: { x: 0, y: 0, w: scene.width, h: scene.height };

	const patches: ElementPatch[] = [];
	for (const n of boxes) {
		const b = n.sceneBBox!;
		let dx = 0;
		let dy = 0;
		switch (mode) {
			case "left":
				dx = ref.x - b.x;
				break;
			case "hcenter":
				dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
				break;
			case "right":
				dx = ref.x + ref.w - (b.x + b.w);
				break;
			case "top":
				dy = ref.y - b.y;
				break;
			case "vcenter":
				dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
				break;
			case "bottom":
				dy = ref.y + ref.h - (b.y + b.h);
				break;
		}
		const p = movePatch(n, dx, dy);
		if (p) patches.push(p);
	}
	return patches;
}

/** Even gaps between the outermost two elements along one axis. */
export function distributePatches(
	nodes: SceneNode[],
	ids: string[],
	mode: DistributeMode,
): ElementPatch[] {
	const items = transformRoots(nodes, ids).filter((n) => !!n.sceneBBox);
	if (items.length < 3) return [];

	const horiz = mode === "hspace";
	const key = (n: SceneNode) => (horiz ? n.sceneBBox!.x : n.sceneBBox!.y);
	const size = (n: SceneNode) => (horiz ? n.sceneBBox!.w : n.sceneBBox!.h);

	const sorted = [...items].sort((a, b) => key(a) - key(b));
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	// Hold the outermost two still and spread the rest evenly between them.
	const span = key(last) + size(last) - key(first);
	const totalSize = sorted.reduce((s, n) => s + size(n), 0);
	const gap = (span - totalSize) / (sorted.length - 1);

	const patches: ElementPatch[] = [];
	let cursor = key(first) + size(first) + gap;
	for (let i = 1; i < sorted.length - 1; i++) {
		const n = sorted[i];
		const delta = cursor - key(n);
		const p = horiz ? movePatch(n, delta, 0) : movePatch(n, 0, delta);
		if (p) patches.push(p);
		cursor += size(n) + gap;
	}
	return patches;
}

// ─── Z-order ──────────────────────────────────────────────────────────

export type OrderMode = "front" | "forward" | "backward" | "back";

/** Reorder within the element's own parent so groups keep their contents. */
export async function reorderSelection(
	scene: Scene,
	id: string,
	mode: OrderMode,
) {
	const found = findParentList(scene, id);
	if (!found) return;
	const { parentId, ids } = found;
	const from = ids.indexOf(id);
	if (from < 0) return;
	let to = from;
	switch (mode) {
		case "front":
			to = ids.length - 1;
			break;
		case "forward":
			to = Math.min(ids.length - 1, from + 1);
			break;
		case "backward":
			to = Math.max(0, from - 1);
			break;
		case "back":
			to = 0;
			break;
	}
	if (to === from) return;
	const next = [...ids];
	next.splice(from, 1);
	next.splice(to, 0, id);
	await useSceneStore.getState().reorderChildren(parentId, next);
}

export function findParentList(
	scene: Scene,
	id: string,
): { parentId: string | null; ids: string[] } | null {
	const walk = (
		list: { id: string; kind: { type: string } }[],
		parentId: string | null,
	): { parentId: string | null; ids: string[] } | null => {
		if (list.some((e) => e.id === id)) {
			return { parentId, ids: list.map((e) => e.id) };
		}
		for (const e of list) {
			if (e.kind.type === "Group") {
				const g = e as unknown as { id: string; kind: { children: never[] } };
				const r = walk(g.kind.children, e.id);
				if (r) return r;
			}
		}
		return null;
	};
	return walk(
		scene.elements as unknown as { id: string; kind: { type: string } }[],
		null,
	);
}

// ─── Selection-wide operations ────────────────────────────────────────

export async function nudgeSelection(
	nodes: SceneNode[],
	ids: string[],
	dx: number,
	dy: number,
) {
	const patches: ElementPatch[] = [];
	for (const n of transformRoots(nodes, ids)) {
		const p = movePatch(n, dx, dy);
		if (p) patches.push(p);
	}
	await useSceneStore.getState().updateElements(patches);
}

/**
 * Duplicate in place, then shift the copies so they read as separate objects.
 * `reflow` recomputes the flattened scene after the store round-trip.
 */
export async function duplicateSelection(
	ids: string[],
	offset: number,
	reflow: () => SceneNode[],
) {
	if (ids.length === 0) return;
	const newIds = await useSceneStore.getState().duplicateElements(ids);
	if (newIds.length === 0) return;
	useEditorStore.getState().setSelection(newIds);
	if (offset !== 0) {
		await nudgeSelection(reflow(), newIds, offset, offset);
	}
}

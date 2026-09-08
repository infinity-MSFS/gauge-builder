import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
	collectRefImageInputs,
	restoreRefImages,
	type RefImageRecord,
} from "./refImageIO";

// ─── Types mirroring Rust scene graph ──────────────────────────────

export type BoundValue =
	| { type: "Literal"; value: number }
	| { type: "LVar"; name: string }
	| { type: "AVar"; name: string; unit: string; index: number }
	| { type: "Expr"; expr: string };

export type BoundColor = { Rgba: [number, number, number, number] };

export type ArcDir = "Cw" | "Ccw";
export type LineCap = "Butt" | "Round" | "Square";
export type LineJoin = "Miter" | "Round" | "Bevel";
export type TextAlignH = "Left" | "Center" | "Right";
export type TextAlignV = "Top" | "Middle" | "Bottom" | "Baseline";

export interface NvgStyle {
	fill: BoundColor | null;
	stroke: BoundColor | null;
	stroke_width: number;
	line_cap: LineCap;
	line_join: LineJoin;
}

export type PathCmd =
	| { type: "MoveTo"; x: BoundValue; y: BoundValue }
	| { type: "LineTo"; x: BoundValue; y: BoundValue }
	| {
			type: "BezierTo";
			c1x: BoundValue;
			c1y: BoundValue;
			c2x: BoundValue;
			c2y: BoundValue;
			x: BoundValue;
			y: BoundValue;
	  }
	| { type: "ClosePath" };

export type RectKind = {
	type: "Rect";
	x: BoundValue;
	y: BoundValue;
	w: BoundValue;
	h: BoundValue;
	radius: BoundValue;
	style: NvgStyle;
};
export type CircleKind = {
	type: "Circle";
	cx: BoundValue;
	cy: BoundValue;
	r: BoundValue;
	style: NvgStyle;
};
export type ArcKind = {
	type: "Arc";
	cx: BoundValue;
	cy: BoundValue;
	r: BoundValue;
	a0: BoundValue;
	a1: BoundValue;
	dir: ArcDir;
	style: NvgStyle;
};
export type LineKind = {
	type: "Line";
	x1: BoundValue;
	y1: BoundValue;
	x2: BoundValue;
	y2: BoundValue;
	style: NvgStyle;
};
export type TextKind = {
	type: "Text";
	x: BoundValue;
	y: BoundValue;
	content: BoundValue;
	font_size: BoundValue;
	font: string;
	text: string | null;
	align_h: TextAlignH;
	align_v: TextAlignV;
	decimals: number;
	style: NvgStyle;
};
export type PathKind = {
	type: "Path";
	commands: PathCmd[];
	style: NvgStyle;
};
export type GroupKind = {
	type: "Group";
	name: string;
	children: SceneElement[];
	translate_x: BoundValue;
	translate_y: BoundValue;
	rotate: BoundValue;
	scale_x: BoundValue;
	scale_y: BoundValue;
	opacity: BoundValue;
	pivot_x: BoundValue;
	pivot_y: BoundValue;
	clip_modifier?: ClipModifier | null;
	array_modifier?: ArrayModifier | null;
};

export type ElementKind =
	| RectKind
	| CircleKind
	| ArcKind
	| LineKind
	| TextKind
	| PathKind
	| GroupKind;

export interface ClipModifier {
	x: BoundValue;
	y: BoundValue;
	w: BoundValue;
	h: BoundValue;
}

export type ArrayModifier =
	| {
			type: "Linear";
			count: number;
			offset_x: BoundValue;
			offset_y: BoundValue;
	  }
	| {
			type: "Radial";
			count: number;
			cx: BoundValue;
			cy: BoundValue;
			start_angle: BoundValue;
			arc_angle: BoundValue;
	  };

export interface SceneElement {
	id: string;
	name: string;
	visible: boolean;
	locked: boolean;
	kind: ElementKind;
}

export interface Scene {
	width: number;
	height: number;
	gauge_name: string;
	elements: SceneElement[];
	/** Reference images as stored on disk; only meaningful right after a load. */
	ref_images?: RefImageRecord[];
}

export type VarKind = "LVar" | "AVar";
export type RustVarType = "F64" | "Bool" | "I32";

export interface VarEntry {
	id: string;
	kind: VarKind;
	sim_name: string;
	unit: string | null;
	index: number | null;
	rust_type: RustVarType;
	preview_value: number;
}

export type ElementKindTag =
	| "Rect"
	| "Circle"
	| "Arc"
	| "Line"
	| "Text"
	| "Path"
	| "Group";

export type BuildModeType = "CodegenOnly" | "CheckOnly" | "FullBuild";

export interface CodegenPreview {
	gauge_rs: string;
	draw_rs: string;
	vars_rs: string;
	cargo_toml: string;
}

interface BuildLog {
	line: string;
	kind: "stdout" | "stderr";
}

export interface ElementPatch {
	id: string;
	kind: ElementKind;
}

// ─── Store ─────────────────────────────────────────────────────────

interface SceneStore {
	scene: Scene;
	vars: VarEntry[];
	buildLogs: BuildLog[];
	building: boolean;
	codegenPreview: CodegenPreview | null;

	// Scene actions
	fetchScene: () => Promise<void>;
	setGaugeMeta: (name: string, width: number, height: number) => Promise<void>;
	addElement: (kind: ElementKindTag) => Promise<SceneElement>;
	addElementFull: (
		element: SceneElement,
		parentId?: string | null,
	) => Promise<SceneElement>;
	updateElement: (id: string, patch: ElementKind) => Promise<void>;
	/** Coalesces consecutive edits sharing `tag` into one undo step. */
	updateElementLive: (
		id: string,
		patch: ElementKind,
		tag: string,
	) => Promise<void>;
	updateElements: (patches: ElementPatch[]) => Promise<void>;
	deleteElement: (id: string) => Promise<void>;
	deleteElements: (ids: string[]) => Promise<void>;
	duplicateElements: (ids: string[]) => Promise<string[]>;
	reorderElements: (ids: string[]) => Promise<void>;
	reorderChildren: (
		parentId: string | null,
		ids: string[],
	) => Promise<void>;
	moveElement: (
		id: string,
		parentId: string | null,
		index?: number | null,
	) => Promise<void>;
	setElementVisible: (id: string, visible: boolean) => Promise<void>;
	setElementLocked: (id: string, locked: boolean) => Promise<void>;
	renameElement: (id: string, name: string) => Promise<void>;
	groupElements: (ids: string[]) => Promise<string | null>;
	ungroup: (id: string) => Promise<void>;
	moveIntoGroup: (elementId: string, groupId: string) => Promise<void>;
	addElementToGroup: (
		kind: ElementKindTag,
		groupId: string,
	) => Promise<SceneElement>;
	undo: () => Promise<void>;
	redo: () => Promise<void>;
	saveScene: (path: string) => Promise<void>;
	loadScene: (path: string) => Promise<void>;
	/** Swap in a locally-computed scene without a round-trip (drag preview). */
	setSceneLocal: (scene: Scene) => void;

	// Var actions
	fetchVars: () => Promise<void>;
	addVar: (entry: VarEntry) => Promise<void>;
	updateVar: (id: string, entry: VarEntry) => Promise<void>;
	deleteVar: (id: string) => Promise<void>;

	// Codegen
	fetchCodegenPreview: () => Promise<void>;
	emitProject: (outputDir: string) => Promise<void>;

	// Build
	runBuild: (
		outputDir: string,
		mode: BuildModeType,
		msfsSdkPath?: string,
	) => Promise<void>;
	addBuildLog: (log: BuildLog) => void;
	setBuildDone: () => void;
}

export const useSceneStore = create<SceneStore>((set, get) => ({
	scene: { width: 512, height: 512, gauge_name: "my_gauge", elements: [] },
	vars: [],
	buildLogs: [],
	building: false,
	codegenPreview: null,

	fetchScene: async () => {
		const scene = await invoke<Scene>("get_scene");
		set({ scene });
	},

	setGaugeMeta: async (name, width, height) => {
		await invoke("set_gauge_meta", { name, width, height });
		await get().fetchScene();
	},

	addElement: async (kind) => {
		const el = await invoke<SceneElement>("add_element", { kind });
		await get().fetchScene();
		return el;
	},

	addElementFull: async (element, parentId = null) => {
		const el = await invoke<SceneElement>("add_element_full", {
			element,
			parentId,
		});
		await get().fetchScene();
		return el;
	},

	updateElement: async (id, patch) => {
		await invoke("update_element", { id, patch });
		await get().fetchScene();
	},

	updateElementLive: async (id, patch, tag) => {
		await invoke("update_element_live", { id, patch, tag });
		await get().fetchScene();
	},

	updateElements: async (patches) => {
		if (patches.length === 0) return;
		await invoke("update_elements", { patches });
		await get().fetchScene();
	},

	deleteElement: async (id) => {
		await invoke("delete_element", { id });
		await get().fetchScene();
	},

	deleteElements: async (ids) => {
		if (ids.length === 0) return;
		await invoke("delete_elements", { ids });
		await get().fetchScene();
	},

	duplicateElements: async (ids) => {
		if (ids.length === 0) return [];
		const newIds = await invoke<string[]>("duplicate_elements", { ids });
		await get().fetchScene();
		return newIds;
	},

	reorderElements: async (ids) => {
		await invoke("reorder_elements", { ids });
		await get().fetchScene();
	},

	reorderChildren: async (parentId, ids) => {
		await invoke("reorder_children", { parentId, ids });
		await get().fetchScene();
	},

	moveElement: async (id, parentId, index = null) => {
		await invoke("move_element", { id, parentId, index });
		await get().fetchScene();
	},

	setElementVisible: async (id, visible) => {
		await invoke("set_element_visible", { id, visible });
		await get().fetchScene();
	},

	setElementLocked: async (id, locked) => {
		await invoke("set_element_locked", { id, locked });
		await get().fetchScene();
	},

	renameElement: async (id, name) => {
		await invoke("rename_element", { id, name });
		await get().fetchScene();
	},

	groupElements: async (ids) => {
		try {
			const el = await invoke<SceneElement>("group_elements", { ids });
			await get().fetchScene();
			return el.id;
		} catch (err) {
			console.error("Group failed:", err);
			return null;
		}
	},

	ungroup: async (id) => {
		await invoke("ungroup", { id });
		await get().fetchScene();
	},

	moveIntoGroup: async (elementId, groupId) => {
		try {
			await invoke("move_into_group", { elementId, groupId });
		} catch (err) {
			console.error("Move into group failed:", err);
		}
		await get().fetchScene();
	},

	addElementToGroup: async (kind, groupId) => {
		const el = await invoke<SceneElement>("add_element_to_group", {
			kind,
			groupId,
		});
		await get().fetchScene();
		return el;
	},

	undo: async () => {
		try {
			const scene = await invoke<Scene>("undo");
			set({ scene });
		} catch (_) {
			/* nothing to undo */
		}
	},

	redo: async () => {
		try {
			const scene = await invoke<Scene>("redo");
			set({ scene });
		} catch (_) {
			/* nothing to redo */
		}
	},

	saveScene: async (path) => {
		// The backend drops the pixels into a refs/ folder beside the RON.
		await invoke("save_scene", {
			path,
			refImages: collectRefImageInputs(),
		});
	},

	loadScene: async (path) => {
		const scene = await invoke<Scene>("load_scene", { path });
		set({ scene });
		await restoreRefImages(path, scene.ref_images ?? []);
	},

	setSceneLocal: (scene) => set({ scene }),

	fetchVars: async () => {
		const vars = await invoke<VarEntry[]>("get_vars");
		set({ vars });
	},

	addVar: async (entry) => {
		await invoke("add_var", { entry });
		await get().fetchVars();
	},

	updateVar: async (id, entry) => {
		await invoke("update_var", { id, entry });
		await get().fetchVars();
	},

	deleteVar: async (id) => {
		await invoke("delete_var", { id });
		await get().fetchVars();
	},

	fetchCodegenPreview: async () => {
		const preview = await invoke<CodegenPreview>("codegen_preview");
		set({ codegenPreview: preview });
	},

	emitProject: async (outputDir) => {
		await invoke("emit_project", {
			outputDir,
			refImages: collectRefImageInputs(),
		});
	},

	runBuild: async (outputDir, mode, msfsSdkPath) => {
		set({ buildLogs: [], building: true });
		const modePayload =
			mode === "FullBuild"
				? { FullBuild: { msfs_sdk_path: msfsSdkPath ?? "" } }
				: mode;
		await invoke("run_build", { outputDir, mode: modePayload });
	},

	addBuildLog: (log) => set((s) => ({ buildLogs: [...s.buildLogs, log] })),

	setBuildDone: () => set({ building: false }),
}));

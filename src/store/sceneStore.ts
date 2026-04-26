import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

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

export type ElementKind =
	| {
			type: "Rect";
			x: BoundValue;
			y: BoundValue;
			w: BoundValue;
			h: BoundValue;
			style: NvgStyle;
	  }
	| {
			type: "Circle";
			cx: BoundValue;
			cy: BoundValue;
			r: BoundValue;
			style: NvgStyle;
	  }
	| {
			type: "Arc";
			cx: BoundValue;
			cy: BoundValue;
			r: BoundValue;
			a0: BoundValue;
			a1: BoundValue;
			dir: ArcDir;
			style: NvgStyle;
	  }
	| {
			type: "Line";
			x1: BoundValue;
			y1: BoundValue;
			x2: BoundValue;
			y2: BoundValue;
			style: NvgStyle;
	  }
	| {
			type: "Text";
			x: BoundValue;
			y: BoundValue;
			content: BoundValue;
			font_size: BoundValue;
			font: string;
			style: NvgStyle;
	  }
	| { type: "Path"; commands: PathCmd[]; style: NvgStyle }
	| {
			type: "Group";
			name: string;
			children: SceneElement[];
			translate_x?: BoundValue;
			translate_y?: BoundValue;
			rotate?: BoundValue;
			scale_x?: BoundValue;
			scale_y?: BoundValue;
			opacity?: BoundValue;
			clip_modifier?: ClipModifier | null;
			array_modifier?: ArrayModifier | null;
	  };

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
	kind: ElementKind;
}

export interface Scene {
	width: number;
	height: number;
	gauge_name: string;
	elements: SceneElement[];
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

// ─── Store ─────────────────────────────────────────────────────────

interface SceneStore {
	scene: Scene;
	vars: VarEntry[];
	selectedId: string | null;
	buildLogs: BuildLog[];
	building: boolean;
	codegenPreview: CodegenPreview | null;

	// Scene actions
	fetchScene: () => Promise<void>;
	setGaugeMeta: (name: string, width: number, height: number) => Promise<void>;
	addElement: (kind: ElementKindTag) => Promise<void>;
	updateElement: (id: string, patch: ElementKind) => Promise<void>;
	deleteElement: (id: string) => Promise<void>;
	reorderElements: (ids: string[]) => Promise<void>;
	setElementVisible: (id: string, visible: boolean) => Promise<void>;
	renameElement: (id: string, name: string) => Promise<void>;
	groupElements: (ids: string[]) => Promise<void>;
	ungroup: (id: string) => Promise<void>;
	moveIntoGroup: (elementId: string, groupId: string) => Promise<void>;
	addElementToGroup: (kind: ElementKindTag, groupId: string) => Promise<void>;
	undo: () => Promise<void>;
	redo: () => Promise<void>;
	saveScene: (path: string) => Promise<void>;
	loadScene: (path: string) => Promise<void>;
	setSelectedId: (id: string | null) => void;

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
	selectedId: null,
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
		set({ selectedId: el.id });
	},

	updateElement: async (id, patch) => {
		await invoke("update_element", { id, patch });
		await get().fetchScene();
	},

	deleteElement: async (id) => {
		await invoke("delete_element", { id });
		const { selectedId } = get();
		await get().fetchScene();
		if (selectedId === id) set({ selectedId: null });
	},

	reorderElements: async (ids) => {
		await invoke("reorder_elements", { ids });
		await get().fetchScene();
	},

	setElementVisible: async (id, visible) => {
		await invoke("set_element_visible", { id, visible });
		await get().fetchScene();
	},

	renameElement: async (id, name) => {
		await invoke("rename_element", { id, name });
		await get().fetchScene();
	},

	groupElements: async (ids) => {
		const el = await invoke<SceneElement>("group_elements", { ids });
		await get().fetchScene();
		set({ selectedId: el.id });
	},

	ungroup: async (id) => {
		await invoke("ungroup", { id });
		await get().fetchScene();
		set({ selectedId: null });
	},

	moveIntoGroup: async (elementId, groupId) => {
		await invoke("move_into_group", { elementId, groupId });
		await get().fetchScene();
	},

	addElementToGroup: async (kind, groupId) => {
		const el = await invoke<SceneElement>("add_element_to_group", {
			kind,
			groupId,
		});
		await get().fetchScene();
		set({ selectedId: el.id });
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
		await invoke("save_scene", { path });
	},

	loadScene: async (path) => {
		const scene = await invoke<Scene>("load_scene", { path });
		set({ scene, selectedId: null });
	},

	setSelectedId: (id) => set({ selectedId: id }),

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
		await invoke("emit_project", { outputDir });
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

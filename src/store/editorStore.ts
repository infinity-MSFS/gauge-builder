import { create } from "zustand";
import { DEFAULT_SNAP, type SnapSettings } from "../canvas/snap";

export type Tool =
	| "select"
	| "direct"
	| "pen"
	| "rect"
	| "ellipse"
	| "arc"
	| "line"
	| "text"
	| "hand";

export const TOOL_KEYS: Record<string, Tool> = {
	v: "select",
	a: "direct",
	p: "pen",
	r: "rect",
	o: "ellipse",
	c: "arc",
	l: "line",
	t: "text",
	h: "hand",
};

export interface ToolDef {
	tool: Tool;
	label: string;
	key: string;
	icon: string;
	hint: string;
}

export const TOOLS: ToolDef[] = [
	{ tool: "select", label: "Select", key: "V", icon: "arrow", hint: "Move, scale and multi-select" },
	{ tool: "direct", label: "Direct Select", key: "A", icon: "node", hint: "Edit anchor points and handles" },
	{ tool: "pen", label: "Pen", key: "P", icon: "pen", hint: "Draw and extend paths" },
	{ tool: "rect", label: "Rectangle", key: "R", icon: "rect", hint: "Drag to draw — Shift for a square" },
	{ tool: "ellipse", label: "Circle", key: "O", icon: "circle", hint: "Drag from the centre" },
	{ tool: "arc", label: "Arc", key: "C", icon: "arc", hint: "Drag a radius, then sweep the angle" },
	{ tool: "line", label: "Line", key: "L", icon: "line", hint: "Shift constrains to 15°" },
	{ tool: "text", label: "Text", key: "T", icon: "text", hint: "Click to place a label" },
	{ tool: "hand", label: "Hand", key: "H", icon: "hand", hint: "Pan the view (or hold Space)" },
];

interface EditorState {
	tool: Tool;
	/** Tool to fall back to after a one-shot draw, when sticky mode is off. */
	stickyTools: boolean;

	/** Multi-selection of scene element ids, in click order. */
	selection: string[];
	/** Group currently entered via double-click; clicks select inside it. */
	isolationId: string | null;
	/** Indices of selected anchors on the active path. */
	nodeSelection: number[];
	/** Path the pen has been asked to continue, set by the Extend action. */
	penExtend: string | null;

	snap: SnapSettings;
	showGrid: boolean;
	showRulers: boolean;
	showOutlines: boolean;

	setTool: (t: Tool) => void;
	setStickyTools: (v: boolean) => void;
	setSelection: (ids: string[]) => void;
	toggleSelected: (id: string) => void;
	addToSelection: (ids: string[]) => void;
	clearSelection: () => void;
	setIsolation: (id: string | null) => void;
	setNodeSelection: (idx: number[]) => void;
	setPenExtend: (id: string | null) => void;
	toggleNode: (idx: number) => void;
	patchSnap: (p: Partial<SnapSettings>) => void;
	setShowGrid: (v: boolean) => void;
	setShowRulers: (v: boolean) => void;
	setShowOutlines: (v: boolean) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
	tool: "select",
	stickyTools: false,
	selection: [],
	isolationId: null,
	nodeSelection: [],
	penExtend: null,
	snap: DEFAULT_SNAP,
	showGrid: true,
	showRulers: true,
	showOutlines: false,

	setTool: (tool) =>
		set((s) => ({
			tool,
			// Anchor selection only makes sense while editing nodes.
			nodeSelection: tool === "direct" || tool === "pen" ? s.nodeSelection : [],
			penExtend: tool === "pen" ? s.penExtend : null,
		})),

	setStickyTools: (stickyTools) => set({ stickyTools }),

	setSelection: (ids) => {
		set({ selection: ids, nodeSelection: [] });
	},

	toggleSelected: (id) => {
		const cur = get().selection;
		const next = cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id];
		set({ selection: next, nodeSelection: [] });
	},

	addToSelection: (ids) => {
		const cur = get().selection;
		const next = [...cur, ...ids.filter((i) => !cur.includes(i))];
		set({ selection: next });
	},

	clearSelection: () => {
		set({ selection: [], nodeSelection: [], isolationId: null });
	},

	setIsolation: (isolationId) => set({ isolationId }),

	setNodeSelection: (nodeSelection) => set({ nodeSelection }),

	setPenExtend: (penExtend) => set({ penExtend }),

	toggleNode: (idx) =>
		set((s) => ({
			nodeSelection: s.nodeSelection.includes(idx)
				? s.nodeSelection.filter((i) => i !== idx)
				: [...s.nodeSelection, idx],
		})),

	patchSnap: (p) => set((s) => ({ snap: { ...s.snap, ...p } })),
	setShowGrid: (showGrid) => set({ showGrid }),
	setShowRulers: (showRulers) => set({ showRulers }),
	setShowOutlines: (showOutlines) => set({ showOutlines }),
}));

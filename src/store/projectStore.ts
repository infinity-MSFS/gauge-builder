import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useSceneStore, type Scene } from "./sceneStore";
import { useEditorStore } from "./editorStore";
import { collectRefImageInputs, restoreRefImages } from "./refImageIO";

/** One gauge registered in the project manifest. */
export interface GaugeEntry {
	id: string;
	/** Mirrors the scene's own `gauge_name`. */
	name: string;
	/** Scene RON path relative to the project root. */
	file: string;
	width: number;
	height: number;
}

export interface Manifest {
	version: number;
	name: string;
	gauges: GaugeEntry[];
	active: string | null;
}

export interface ProjectInfo {
	/** Absolute path of the project folder. */
	root: string;
	manifest: Manifest;
}

/** Reply from any command that changes which gauge is open. */
interface ProjectOpen {
	project: ProjectInfo;
	scene: Scene;
	/** Absolute path of the scene RON, used to resolve its `refs/` entries. */
	path: string;
}

interface ProjectStore {
	project: ProjectInfo | null;
	/** Absolute path of the gauge RON currently open. */
	gaugePath: string | null;
	/** Last failure, shown in the tab bar until the next action succeeds. */
	error: string | null;
	/** True while a gauge is being written or swapped in. */
	busy: boolean;

	/** Reopen the project from the previous session, if there was one. */
	restore: () => Promise<void>;
	openProject: (dir: string) => Promise<void>;
	closeProject: () => Promise<void>;
	saveGauge: () => Promise<void>;
	selectGauge: (id: string) => Promise<void>;
	addGauge: (name?: string) => Promise<void>;
	duplicateGauge: (id: string) => Promise<void>;
	renameGauge: (id: string, name: string) => Promise<void>;
	reorderGauges: (ids: string[]) => Promise<void>;
	deleteGauge: (id: string) => Promise<void>;
	clearError: () => void;
}

/** The manifest entry for the gauge on screen. */
export function activeGauge(p: ProjectInfo | null): GaugeEntry | null {
	if (!p?.manifest.active) return null;
	return p.manifest.gauges.find((g) => g.id === p.manifest.active) ?? null;
}

/** A default name for the next gauge, not already taken in the project. */
function nextGaugeName(p: ProjectInfo | null): string {
	const taken = new Set((p?.manifest.gauges ?? []).map((g) => g.name));
	for (let n = taken.size + 1; ; n++) {
		const name = `gauge_${n}`;
		if (!taken.has(name)) return name;
	}
}

export const useProjectStore = create<ProjectStore>((set, get) => {
	/**
	 * Run a project command, reporting failures rather than throwing them at
	 * the click handler. `apply` swaps whatever the backend loaded into the
	 * editor: scene, variables, reference images and selection all belong to
	 * the gauge, so they change together.
	 */
	async function run<T>(
		op: () => Promise<T>,
		apply?: (result: T) => Promise<void> | void,
	): Promise<void> {
		set({ busy: true });
		try {
			const result = await op();
			await apply?.(result);
			set({ error: null });
		} catch (err) {
			console.error("Project command failed:", err);
			set({ error: String(err) });
		} finally {
			set({ busy: false });
		}
	}

	async function applyOpen(open: ProjectOpen) {
		useSceneStore.getState().setSceneLocal(open.scene);
		await useSceneStore.getState().fetchVars();
		await restoreRefImages(open.path, open.scene.ref_images ?? []);
		useEditorStore.getState().clearSelection();
		set({ project: open.project, gaugePath: open.path });
	}

	/** Pixels for the gauge being left behind, so the backend can write them. */
	const refImages = () => collectRefImageInputs();

	return {
		project: null,
		gaugePath: null,
		error: null,
		busy: false,

		restore: () =>
			run(
				() => invoke<ProjectOpen | null>("reopen_last_project"),
				async (open) => {
					if (open) await applyOpen(open);
				},
			),

		openProject: (dir) =>
			run(
				() =>
					invoke<ProjectOpen>("open_project", {
						dir,
						refImages: refImages(),
					}),
				applyOpen,
			),

		closeProject: () =>
			run(
				() => invoke("close_project", { refImages: refImages() }),
				() => {
					// The scene stays on screen as a loose document.
					set({ project: null, gaugePath: null });
				},
			),

		saveGauge: () =>
			run(
				() =>
					invoke<ProjectInfo | null>("save_gauge", {
						refImages: refImages(),
					}),
				(project) => {
					if (project) set({ project });
				},
			),

		selectGauge: (id) => {
			if (get().project?.manifest.active === id) return Promise.resolve();
			return run(
				() =>
					invoke<ProjectOpen>("select_gauge", {
						id,
						refImages: refImages(),
					}),
				applyOpen,
			);
		},

		addGauge: (name) =>
			run(
				() =>
					invoke<ProjectOpen>("add_gauge", {
						name: name ?? nextGaugeName(get().project),
						width: null,
						height: null,
						refImages: refImages(),
					}),
				applyOpen,
			),

		duplicateGauge: (id) =>
			run(
				() =>
					invoke<ProjectOpen>("duplicate_gauge", {
						id,
						refImages: refImages(),
					}),
				applyOpen,
			),

		renameGauge: (id, name) =>
			run(
				() => invoke<ProjectInfo>("rename_gauge", { id, name }),
				async (project) => {
					set({ project });
					// Renaming the open gauge edits the scene behind the tab.
					if (project.manifest.active === id) {
						await useSceneStore.getState().fetchScene();
					}
				},
			),

		reorderGauges: (ids) =>
			run(
				() => invoke<ProjectInfo>("reorder_gauges", { ids }),
				(project) => set({ project }),
			),

		deleteGauge: (id) =>
			run(
				() =>
					invoke<ProjectOpen>("delete_gauge", {
						id,
						deleteFile: true,
						refImages: refImages(),
					}),
				applyOpen,
			),

		clearError: () => set({ error: null }),
	};
});

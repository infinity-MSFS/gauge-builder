import {
	useSceneStore,
	type PathKind,
	type VarEntry,
} from "../../store/sceneStore";
import { useEditorStore } from "../../store/editorStore";
import {
	isSmooth,
	nodesToPath,
	pathToNodes,
	varMapOf,
	type PathShape,
} from "../../canvas/geometry";
import { deleteNodes, reversePath, toggleSmooth } from "../../canvas/pathedit";
import { BoundValueField, SectionLabel, Segmented } from "./fields";

// ─── Small buttons ─────────────────────────────────────────────────

function MiniBtn({
	onClick,
	title,
	children,
	tone = "ghost",
	disabled,
}: {
	onClick: () => void;
	title?: string;
	children: React.ReactNode;
	tone?: "ghost" | "accent" | "danger";
	disabled?: boolean;
}) {
	const tones = {
		ghost: { bg: "rgba(255,255,255,0.04)", fg: "#a0a0a0" },
		accent: { bg: "rgba(99,102,241,0.14)", fg: "#818cf8" },
		danger: { bg: "rgba(239,68,68,0.12)", fg: "#ef4444" },
	}[tone];
	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			className="flex-1 text-[11px] font-medium py-1.5 rounded-md transition-opacity"
			style={{
				background: tones.bg,
				color: disabled ? "#2e2e2e" : tones.fg,
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.5 : 1,
			}}
		>
			{children}
		</button>
	);
}

// ─── Panel ─────────────────────────────────────────────────────────

export default function PathPanel({
	id,
	kind,
	vars,
	onChange,
}: {
	id: string;
	kind: PathKind;
	vars: VarEntry[];
	onChange: (k: PathKind) => void;
}) {
	const varMap = varMapOf(vars);
	const shape = pathToNodes(kind.commands, varMap);
	const nodeSelection = useEditorStore((s) => s.nodeSelection);
	const setNodeSelection = useEditorStore((s) => s.setNodeSelection);
	const setTool = useEditorStore((s) => s.setTool);
	const tool = useEditorStore((s) => s.tool);
	const deleteElement = useSceneStore((s) => s.deleteElement);

	const commit = (next: PathShape) =>
		onChange({ ...kind, commands: nodesToPath(next) });

	const selected = new Set(nodeSelection);
	const sel = nodeSelection.length;

	const setClosed = (closed: boolean) => commit({ ...shape, closed });

	const removeSelected = () => {
		if (sel === 0) return;
		const next = deleteNodes(shape, nodeSelection);
		setNodeSelection([]);
		if (next.nodes.length < 2) deleteElement(id);
		else commit(next);
	};

	const smoothSelected = () => {
		let next = shape;
		for (const i of nodeSelection) next = toggleSmooth(next, i);
		commit(next);
	};

	const appendNode = () => {
		const last = shape.nodes[shape.nodes.length - 1];
		const next: PathShape = {
			...shape,
			nodes: [
				...shape.nodes,
				{
					x: (last?.x ?? 0) + 40,
					y: (last?.y ?? 0) + 40,
					xbv: { type: "Literal", value: (last?.x ?? 0) + 40 },
					ybv: { type: "Literal", value: (last?.y ?? 0) + 40 },
					hIn: null,
					hOut: null,
				},
			],
		};
		setNodeSelection([next.nodes.length - 1]);
		commit(next);
	};

	return (
		<div className="space-y-2">
			{/* Editing mode hint */}
			<div
				className="flex items-center gap-2 rounded-lg px-2.5 py-2"
				style={{
					background: tool === "direct" ? "rgba(99,102,241,0.10)" : "#0d0d0d",
					border: `1px solid ${tool === "direct" ? "rgba(99,102,241,0.3)" : "#1a1a1a"}`,
				}}
			>
				<span className="text-[11px] leading-4 flex-1" style={{ color: "#8a8a8a" }}>
					{tool === "direct"
						? "Drag anchors and handles on canvas. Alt-click a segment to insert, Alt-click an anchor to smooth it."
						: "Switch to Direct Select to edit anchors on canvas."}
				</span>
				{tool !== "direct" && (
					<button
						type="button"
						onClick={() => setTool("direct")}
						className="text-[11px] font-semibold px-2 py-1 rounded-md shrink-0"
						style={{ background: "rgba(99,102,241,0.16)", color: "#818cf8", cursor: "pointer" }}
					>
						Edit (A)
					</button>
				)}
			</div>

			<div className="flex items-center justify-between">
				<SectionLabel>
					Anchors · {shape.nodes.length}
				</SectionLabel>
				<div style={{ width: 96 }}>
					<Segmented
						value={shape.closed ? "closed" : "open"}
						options={[
							{ value: "open", label: "Open" },
							{ value: "closed", label: "Closed" },
						]}
						onChange={(v) => setClosed(v === "closed")}
					/>
				</div>
			</div>

			{/* Anchor list */}
			<div
				className="rounded-lg overflow-hidden"
				style={{ border: "1px solid #1a1a1a", background: "#0b0b0b" }}
			>
				<div className="max-h-64 overflow-y-auto">
					{shape.nodes.length === 0 && (
						<div className="text-[11px] italic px-3 py-4 text-center" style={{ color: "#454545" }}>
							Path has no anchors yet.
						</div>
					)}
					{shape.nodes.map((n, i) => {
						const isSel = selected.has(i);
						const smooth = isSmooth(n);
						return (
							<div
								key={i}
								className="flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors"
								style={{
									background: isSel ? "rgba(99,102,241,0.14)" : "transparent",
									borderLeft: `2px solid ${isSel ? "#6366f1" : "transparent"}`,
									borderBottom: "1px solid #131313",
								}}
								onClick={(e) => {
									if (e.shiftKey) useEditorStore.getState().toggleNode(i);
									else setNodeSelection([i]);
									if (tool !== "direct") setTool("direct");
								}}
							>
								<span
									className="text-[10px] font-mono shrink-0 text-right"
									style={{ color: "#4a4a4a", width: 16 }}
								>
									{i}
								</span>
								<span
									className="text-[9px] shrink-0 rounded px-1"
									style={{
										background: smooth
											? "rgba(56,189,248,0.15)"
											: "rgba(115,115,115,0.14)",
										color: smooth ? "#38bdf8" : "#737373",
									}}
									title={smooth ? "Smooth anchor" : "Corner anchor"}
								>
									{smooth ? "S" : "C"}
								</span>
								<span
									className="text-[11px] font-mono flex-1 truncate"
									style={{ color: isSel ? "#e8e8e8" : "#8a8a8a" }}
								>
									{n.xbv.type === "Literal" ? n.x.toFixed(1) : `⟨${n.xbv.type}⟩`},{" "}
									{n.ybv.type === "Literal" ? n.y.toFixed(1) : `⟨${n.ybv.type}⟩`}
								</span>
								<button
									type="button"
									className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px]"
									style={{ color: "#3a3a3a" }}
									onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
									onMouseLeave={(e) => (e.currentTarget.style.color = "#3a3a3a")}
									onClick={(e) => {
										e.stopPropagation();
										const next = deleteNodes(shape, [i]);
										setNodeSelection([]);
										if (next.nodes.length < 2) deleteElement(id);
										else commit(next);
									}}
									title="Delete anchor"
								>
									✕
								</button>
							</div>
						);
					})}
				</div>
			</div>

			<div className="flex gap-1.5">
				<MiniBtn onClick={appendNode} tone="accent" title="Append an anchor">
					+ Anchor
				</MiniBtn>
				<MiniBtn onClick={smoothSelected} disabled={sel === 0} title="Corner ⇄ smooth">
					Smooth
				</MiniBtn>
				<MiniBtn onClick={removeSelected} disabled={sel === 0} tone="danger">
					Delete
				</MiniBtn>
			</div>
			<div className="flex gap-1.5">
				<MiniBtn
					onClick={() => commit(reversePath(shape))}
					title="Reverse anchor order — flips which end the path starts from"
				>
					⇄ Reverse
				</MiniBtn>
				<MiniBtn
					onClick={() => {
						useEditorStore.getState().setPenExtend(id);
						setTool("pen");
					}}
					tone="accent"
					disabled={shape.closed}
					title="Continue drawing from the last anchor"
				>
					✎ Extend
				</MiniBtn>
			</div>

			{/* Per-anchor coordinates, bindable */}
			{sel === 1 &&
				(() => {
					const i = nodeSelection[0];
					const n = shape.nodes[i];
					if (!n) return null;
					const cmds = kind.commands;
					// Find the command that carries this anchor so bindings can be
					// edited in place rather than flattened to literals.
					let cmdIndex = -1;
					let seen = -1;
					for (let c = 0; c < cmds.length; c++) {
						const t = cmds[c].type;
						if (t === "MoveTo" || t === "LineTo" || t === "BezierTo") {
							seen++;
							if (seen === i) {
								cmdIndex = c;
								break;
							}
						}
					}
					if (cmdIndex < 0) return null;
					const cmd = cmds[cmdIndex];
					if (cmd.type === "ClosePath") return null;

					const patch = (field: "x" | "y", bv: (typeof cmd)["x"]) => {
						const next = [...cmds];
						next[cmdIndex] = { ...cmd, [field]: bv } as typeof cmd;
						onChange({ ...kind, commands: next });
					};

					return (
						<>
							<SectionLabel>Anchor {i}</SectionLabel>
							<div className="space-y-2">
								<BoundValueField
									label="X"
									value={cmd.x}
									vars={vars}
									onChange={(bv) => patch("x", bv)}
								/>
								<BoundValueField
									label="Y"
									value={cmd.y}
									vars={vars}
									onChange={(bv) => patch("y", bv)}
								/>
							</div>
							<p className="text-[10px] leading-4" style={{ color: "#4a4a4a" }}>
								Binding an anchor to an LVar or AVar makes the path deform at
								runtime — handy for moving tapes and bugs.
							</p>
						</>
					);
				})()}
		</div>
	);
}

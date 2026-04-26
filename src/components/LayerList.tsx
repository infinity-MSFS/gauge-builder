import { useState, useRef } from "react";
import {
	useSceneStore,
	type SceneElement,
	type ElementKind,
	type ElementKindTag,
} from "../store/sceneStore";
import { useRefImageStore, type RefImageMeta } from "../store/refImageStore";
import { pickRefImageViaDialog } from "../store/refImageLoader";

const KIND_ICONS: Record<string, string> = {
	Rect: "▭",
	Circle: "○",
	Arc: "◠",
	Line: "─",
	Text: "T",
	Path: "✏",
	Group: "⊞",
};

const KIND_COLORS: Record<string, string> = {
	Rect: "#6366f1",
	Circle: "#22c55e",
	Arc: "#f59e0b",
	Line: "#06b6d4",
	Text: "#ec4899",
	Path: "#a78bfa",
	Group: "#737373",
};

const TOP_LEVEL_KINDS: ElementKindTag[] = [
	"Rect",
	"Circle",
	"Arc",
	"Line",
	"Text",
	"Path",
	"Group",
];

// ── Modifier badges ───────────────────────────────────────────────────

function ModifierBadges({ kind }: { kind: ElementKind }) {
	if (kind.type !== "Group") return null;
	const clip = kind.clip_modifier ?? null;
	const arr = kind.array_modifier ?? null;
	if (!clip && !arr) return null;
	return (
		<div className="flex items-center gap-1 shrink-0">
			{clip && (
				<span
					className="text-[9px] font-bold px-1 rounded"
					style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
					title="Clip modifier"
				>
					✂
				</span>
			)}
			{arr?.type === "Linear" && (
				<span
					className="text-[9px] font-bold px-1 rounded"
					style={{ background: "rgba(20,184,166,0.15)", color: "#14b8a6" }}
					title={`Linear array ×${arr.count}`}
				>
					≡×{arr.count}
				</span>
			)}
			{arr?.type === "Radial" && (
				<span
					className="text-[9px] font-bold px-1 rounded"
					style={{ background: "rgba(249,115,22,0.15)", color: "#f97316" }}
					title={`Radial array ×${arr.count}`}
				>
					◎×{arr.count}
				</span>
			)}
		</div>
	);
}

// ── Scene element layer row ───────────────────────────────────────────

interface LayerRowProps {
	el: SceneElement;
	depth: number;
	selected: boolean;
	multiSelected: boolean;
	expanded: boolean;
	onSelect: (e: React.MouseEvent) => void;
	onToggleVisible: () => void;
	onRename: (name: string) => void;
	onToggleExpand: () => void;
	onDragStart: () => void;
	onDragOver: (e: React.DragEvent) => void;
	onDrop: (e: React.DragEvent) => void;
}

function LayerRow({
	el,
	depth,
	selected,
	multiSelected,
	expanded,
	onSelect,
	onToggleVisible,
	onRename,
	onToggleExpand,
	onDragStart,
	onDragOver,
	onDrop,
}: LayerRowProps) {
	const [editing, setEditing] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const isGroup = el.kind.type === "Group";
	const hasChildren =
		isGroup &&
		(el.kind as Extract<ElementKind, { type: "Group" }>).children.length > 0;
	const color = KIND_COLORS[el.kind.type] ?? "#737373";

	const bg = selected
		? "rgba(99,102,241,0.14)"
		: multiSelected
			? "rgba(99,102,241,0.07)"
			: undefined;
	const borderLeft = selected
		? "2px solid #6366f1"
		: multiSelected
			? "2px solid rgba(99,102,241,0.4)"
			: "2px solid transparent";

	return (
		<div
			className="group flex items-center gap-1.5 pr-2 cursor-pointer select-none transition-colors"
			style={{
				height: 34,
				paddingLeft: 8 + depth * 16,
				background: bg,
				borderLeft,
			}}
			onClick={onSelect}
			draggable
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDrop={onDrop}
			onMouseEnter={(e) => {
				if (!selected && !multiSelected)
					(e.currentTarget as HTMLElement).style.background =
						"rgba(255,255,255,0.04)";
			}}
			onMouseLeave={(e) => {
				if (!selected && !multiSelected)
					(e.currentTarget as HTMLElement).style.background = "";
			}}
		>
			{/* Expand/collapse for groups */}
			<button
				type="button"
				className="shrink-0 w-4 h-4 flex items-center justify-center text-[9px] transition-opacity"
				style={{
					color: "#454545",
					visibility: isGroup ? "visible" : "hidden",
					opacity: hasChildren ? 1 : 0.3,
				}}
				onClick={(e) => {
					e.stopPropagation();
					onToggleExpand();
				}}
				title={expanded ? "Collapse" : "Expand"}
			>
				{expanded ? "▾" : "▸"}
			</button>

			{/* Visibility toggle */}
			<button
				type="button"
				className="shrink-0 w-4 h-4 flex items-center justify-center rounded transition-opacity"
				style={{ color: el.visible ? "#737373" : "#454545", fontSize: 10 }}
				onClick={(e) => {
					e.stopPropagation();
					onToggleVisible();
				}}
				title={el.visible ? "Hide" : "Show"}
			>
				{el.visible ? "◉" : "◎"}
			</button>

			{/* Kind icon */}
			<span
				className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold"
				style={{ color, background: `${color}18` }}
				title={el.kind.type}
			>
				{KIND_ICONS[el.kind.type] ?? "?"}
			</span>

			{editing ? (
				<input
					ref={inputRef}
					className="flex-1 text-xs outline-none rounded px-1 py-0.5 min-w-0"
					style={{
						background: "#1c1c1c",
						border: "1px solid #6366f1",
						color: "#e8e8e8",
					}}
					defaultValue={el.name}
					autoFocus
					onBlur={(e) => {
						setEditing(false);
						onRename(e.target.value);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							setEditing(false);
							onRename((e.target as HTMLInputElement).value);
						}
						if (e.key === "Escape") setEditing(false);
					}}
					onClick={(e) => e.stopPropagation()}
				/>
			) : (
				<span
					className="flex-1 text-xs truncate min-w-0"
					style={{ color: selected ? "#e8e8e8" : "#a0a0a0" }}
					onDoubleClick={(e) => {
						e.stopPropagation();
						setEditing(true);
					}}
					title={`${el.name} (double-click to rename)`}
				>
					{el.name}
				</span>
			)}

			<ModifierBadges kind={el.kind} />
		</div>
	);
}

// ── Add-child row ─────────────────────────────────────────────────────

function AddChildRow({
	depth,
	groupId,
	onAdd,
}: {
	depth: number;
	groupId: string;
	onAdd: (kind: ElementKindTag, groupId: string) => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<div
			className="relative flex items-center"
			style={{ paddingLeft: 8 + depth * 16 + 8, height: 26 }}
		>
			<button
				type="button"
				className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded transition-colors"
				style={{
					color: open ? "#6366f1" : "#454545",
					background: open ? "rgba(99,102,241,0.1)" : "transparent",
				}}
				onClick={(e) => {
					e.stopPropagation();
					setOpen(!open);
				}}
			>
				<span style={{ fontSize: 11 }}>+</span> Add child
			</button>

			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
					<div
						className="absolute left-0 top-full mt-1 z-50 rounded-lg overflow-hidden py-1"
						style={{
							background: "#0d0d0d",
							border: "1px solid #1a1a1a",
							boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
							minWidth: 130,
						}}
					>
						{TOP_LEVEL_KINDS.map((k) => (
							<button
								type="button"
								key={k}
								className="flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors"
								style={{ color: "#a0a0a0" }}
								onMouseEnter={(e) => {
									(e.currentTarget as HTMLElement).style.background =
										"rgba(255,255,255,0.06)";
									(e.currentTarget as HTMLElement).style.color = "#e8e8e8";
								}}
								onMouseLeave={(e) => {
									(e.currentTarget as HTMLElement).style.background = "";
									(e.currentTarget as HTMLElement).style.color = "#a0a0a0";
								}}
								onClick={(e) => {
									e.stopPropagation();
									onAdd(k, groupId);
									setOpen(false);
								}}
							>
								<span
									style={{
										color: KIND_COLORS[k],
										width: 14,
										textAlign: "center",
									}}
								>
									{KIND_ICONS[k]}
								</span>
								{k}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}

// ── Reference image row ───────────────────────────────────────────────

function RefImageRow({
	img,
	selected,
	onSelect,
}: {
	img: RefImageMeta;
	selected: boolean;
	onSelect: () => void;
}) {
	const updateImage = useRefImageStore((s) => s.updateImage);
	const deleteImage = useRefImageStore((s) => s.deleteImage);
	const setSelectedId = useSceneStore((s) => s.setSelectedId);
	const [showSlider, setShowSlider] = useState(false);

	return (
		<div
			className="select-none"
			style={{
				background: selected ? "rgba(245,158,11,0.08)" : undefined,
				borderLeft: selected ? "2px solid #f59e0b" : "2px solid transparent",
			}}
		>
			{/* Main row */}
			<div
				className="flex items-center gap-1.5 px-2.5 cursor-pointer transition-colors"
				style={{ height: 36 }}
				onClick={onSelect}
				onMouseEnter={(e) => {
					if (!selected)
						(e.currentTarget as HTMLElement).style.background =
							"rgba(255,255,255,0.04)";
				}}
				onMouseLeave={(e) => {
					if (!selected) (e.currentTarget as HTMLElement).style.background = "";
				}}
			>
				{/* Visible */}
				<button
					className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-opacity"
					style={{ color: img.visible ? "#f59e0b" : "#454545", fontSize: 11 }}
					onClick={(e) => {
						e.stopPropagation();
						updateImage(img.id, { visible: !img.visible });
					}}
					title={img.visible ? "Hide" : "Show"}
				>
					{img.visible ? "◉" : "◎"}
				</button>

				{/* Lock */}
				<button
					className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-opacity text-[11px]"
					style={{ color: img.locked ? "#f59e0b" : "#353535" }}
					onClick={(e) => {
						e.stopPropagation();
						updateImage(img.id, { locked: !img.locked });
					}}
					title={img.locked ? "Unlock" : "Lock position"}
				>
					{img.locked ? "⊠" : "⊡"}
				</button>

				{/* Name */}
				<span
					className="flex-1 text-[11px] truncate"
					style={{ color: selected ? "#e8e8e8" : "#808080" }}
					title={img.name}
				>
					{img.name}
				</span>

				{/* Opacity badge — click to toggle slider */}
				<button
					className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors"
					style={{
						color: showSlider ? "#f59e0b" : "#555",
						background: showSlider ? "rgba(245,158,11,0.1)" : "transparent",
					}}
					onClick={(e) => {
						e.stopPropagation();
						setShowSlider(!showSlider);
					}}
					title="Adjust opacity"
				>
					{Math.round(img.opacity * 100)}%
				</button>

				{/* Delete */}
				<button
					className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors text-[11px]"
					style={{ color: "#353535" }}
					onMouseEnter={(e) => {
						(e.currentTarget as HTMLElement).style.color = "#ef4444";
						(e.currentTarget as HTMLElement).style.background =
							"rgba(239,68,68,0.1)";
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLElement).style.color = "#353535";
						(e.currentTarget as HTMLElement).style.background = "";
					}}
					onClick={(e) => {
						e.stopPropagation();
						if (selected) setSelectedId(null);
						deleteImage(img.id);
					}}
					title="Remove reference"
				>
					✕
				</button>
			</div>

			{/* Opacity slider (expanded) */}
			{showSlider && (
				<div
					className="flex items-center gap-2 px-3 pb-2 pt-0.5"
					onClick={(e) => e.stopPropagation()}
				>
					<span className="text-[10px] shrink-0" style={{ color: "#555" }}>
						Opacity
					</span>
					<input
						type="range"
						min={0}
						max={1}
						step={0.01}
						value={img.opacity}
						className="flex-1"
						onChange={(e) =>
							updateImage(img.id, { opacity: parseFloat(e.target.value) })
						}
					/>
					<input
						type="number"
						min={0}
						max={100}
						step={1}
						className="w-12 text-right text-[10px] font-mono"
						style={{
							background: "#0f0f0f",
							border: "1px solid #181818",
							borderRadius: 4,
							color: "#e8e8e8",
							padding: "2px 4px",
							outline: "none",
						}}
						value={Math.round(img.opacity * 100)}
						onChange={(e) =>
							updateImage(img.id, {
								opacity:
									Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) /
									100,
							})
						}
					/>
				</div>
			)}
		</div>
	);
}

// ── Main LayerList ────────────────────────────────────────────────────

export default function LayerList() {
	const scene = useSceneStore((s) => s.scene);
	const selectedId = useSceneStore((s) => s.selectedId);
	const setSelectedId = useSceneStore((s) => s.setSelectedId);
	const addElement = useSceneStore((s) => s.addElement);
	const deleteElement = useSceneStore((s) => s.deleteElement);
	const setElementVisible = useSceneStore((s) => s.setElementVisible);
	const renameElement = useSceneStore((s) => s.renameElement);
	const reorderElements = useSceneStore((s) => s.reorderElements);
	const groupElements = useSceneStore((s) => s.groupElements);
	const ungroupElement = useSceneStore((s) => s.ungroup);
	const moveIntoGroup = useSceneStore((s) => s.moveIntoGroup);
	const addElementToGroup = useSceneStore((s) => s.addElementToGroup);

	const refImages = useRefImageStore((s) => s.images);
	const deleteRefImage = useRefImageStore((s) => s.deleteImage);

	const [showAddMenu, setShowAddMenu] = useState(false);
	const [refCollapsed, setRefCollapsed] = useState(false);
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(
		new Set(),
	);

	const dragIdx = useRef<number | null>(null);
	const draggingId = useRef<string | null>(null);

	const toggleExpanded = (id: string) => {
		setExpandedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const handleSelect = (id: string, e: React.MouseEvent) => {
		if (e.shiftKey) {
			setMultiSelectedIds((prev) => {
				const next = new Set(prev);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
		} else {
			setMultiSelectedIds(new Set());
			setSelectedId(id);
		}
	};

	const handleDrop = (targetIdx: number) => {
		if (dragIdx.current === null || dragIdx.current === targetIdx) return;
		const ids = scene.elements.map((e) => e.id);
		const [moved] = ids.splice(dragIdx.current, 1);
		ids.splice(targetIdx, 0, moved);
		reorderElements(ids);
		dragIdx.current = null;
	};

	const handleDropOnGroup = (groupId: string) => {
		const srcId = draggingId.current;
		if (!srcId || srcId === groupId) return;
		moveIntoGroup(srcId, groupId);
		draggingId.current = null;
	};

	const handlePickRefImage = async () => {
		try {
			await pickRefImageViaDialog();
		} catch (err) {
			console.error("Failed to load reference image:", err);
		}
	};

	const isRefSelected = selectedId
		? refImages.some((i) => i.id === selectedId)
		: false;
	const isElSelected = selectedId
		? scene.elements.some((e) => e.id === selectedId)
		: false;

	const selectedElement = scene.elements.find((e) => e.id === selectedId);
	const selectedIsGroup =
		selectedElement?.kind.type === "Group" && multiSelectedIds.size === 0;
	const canGroup = multiSelectedIds.size >= 2;

	const renderElement = (
		el: SceneElement,
		depth: number,
		idx: number,
	): React.ReactNode => {
		const isGroup = el.kind.type === "Group";
		const children = isGroup
			? (el.kind as Extract<ElementKind, { type: "Group" }>).children
			: [];
		const isExpanded = expandedGroups.has(el.id);

		return (
			<div key={el.id}>
				<LayerRow
					el={el}
					depth={depth}
					selected={selectedId === el.id && multiSelectedIds.size === 0}
					multiSelected={multiSelectedIds.has(el.id)}
					expanded={isExpanded}
					onSelect={(e) => handleSelect(el.id, e)}
					onToggleVisible={() => setElementVisible(el.id, !el.visible)}
					onRename={(name) => renameElement(el.id, name)}
					onToggleExpand={() => toggleExpanded(el.id)}
					onDragStart={() => {
						dragIdx.current = idx;
						draggingId.current = el.id;
					}}
					onDragOver={(e) => e.preventDefault()}
					onDrop={(e) => {
						e.preventDefault();
						if (isGroup && draggingId.current && draggingId.current !== el.id) {
							handleDropOnGroup(el.id);
						} else {
							handleDrop(idx);
						}
					}}
				/>
				{isGroup && isExpanded && (
					<div>
						{children.map((child, ci) => renderElement(child, depth + 1, ci))}
						<AddChildRow
							depth={depth + 1}
							groupId={el.id}
							onAdd={(kind, gid) => addElementToGroup(kind, gid)}
						/>
					</div>
				)}
			</div>
		);
	};

	return (
		<div
			className="flex flex-col shrink-0"
			style={{
				width: 220,
				background: "#080808",
				borderRight: "1px solid #111111",
			}}
		>
			{/* ── Elements header ── */}
			<div
				className="flex items-center justify-between px-3 shrink-0"
				style={{ height: 42, borderBottom: "1px solid #111111" }}
			>
				<span
					className="text-[11px] font-semibold tracking-widest uppercase"
					style={{ color: "#454545" }}
				>
					Layers
				</span>

				<div className="relative">
					<button
						type="button"
						className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors"
						style={{
							background: showAddMenu ? "#6366f1" : "rgba(99,102,241,0.15)",
							color: showAddMenu ? "white" : "#6366f1",
						}}
						onClick={() => setShowAddMenu(!showAddMenu)}
					>
						+ Add
					</button>

					{showAddMenu && (
						<>
							<div
								className="fixed inset-0 z-40"
								onClick={() => setShowAddMenu(false)}
							/>
							<div
								className="absolute right-0 top-full mt-1.5 z-50 rounded-lg overflow-hidden py-1"
								style={{
									background: "#0d0d0d",
									border: "1px solid #1a1a1a",
									boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
									minWidth: 140,
								}}
							>
								{TOP_LEVEL_KINDS.map((k) => (
									<button
										type="button"
										key={k}
										className="flex items-center gap-2.5 w-full px-3 py-2 text-xs transition-colors"
										style={{ color: "#a0a0a0" }}
										onMouseEnter={(e) => {
											(e.currentTarget as HTMLElement).style.background =
												"rgba(255,255,255,0.06)";
											(e.currentTarget as HTMLElement).style.color = "#e8e8e8";
										}}
										onMouseLeave={(e) => {
											(e.currentTarget as HTMLElement).style.background = "";
											(e.currentTarget as HTMLElement).style.color = "#a0a0a0";
										}}
										onClick={() => {
											addElement(k);
											setShowAddMenu(false);
										}}
									>
										<span
											style={{
												color: KIND_COLORS[k],
												width: 16,
												textAlign: "center",
											}}
										>
											{KIND_ICONS[k]}
										</span>
										{k}
									</button>
								))}
							</div>
						</>
					)}
				</div>
			</div>

			{/* ── Group / Ungroup action bar ── */}
			{(canGroup || selectedIsGroup) && (
				<div
					className="flex items-center gap-1.5 px-3 py-1.5 shrink-0"
					style={{ borderBottom: "1px solid #111111" }}
				>
					{canGroup && (
						<button
							type="button"
							className="flex-1 text-[10px] font-semibold py-1 rounded-md transition-colors"
							style={{
								background: "rgba(99,102,241,0.15)",
								color: "#6366f1",
							}}
							onMouseEnter={(e) => {
								(e.currentTarget as HTMLElement).style.background =
									"rgba(99,102,241,0.3)";
							}}
							onMouseLeave={(e) => {
								(e.currentTarget as HTMLElement).style.background =
									"rgba(99,102,241,0.15)";
							}}
							onClick={() => {
								groupElements([...multiSelectedIds]);
								setMultiSelectedIds(new Set());
							}}
						>
							⊞ Group {multiSelectedIds.size}
						</button>
					)}
					{selectedIsGroup && (
						<button
							type="button"
							className="flex-1 text-[10px] font-semibold py-1 rounded-md transition-colors"
							style={{
								background: "rgba(115,115,115,0.15)",
								color: "#a0a0a0",
							}}
							onMouseEnter={(e) => {
								(e.currentTarget as HTMLElement).style.background =
									"rgba(115,115,115,0.3)";
							}}
							onMouseLeave={(e) => {
								(e.currentTarget as HTMLElement).style.background =
									"rgba(115,115,115,0.15)";
							}}
							onClick={() => {
								if (selectedId) ungroupElement(selectedId);
							}}
						>
							Ungroup
						</button>
					)}
				</div>
			)}

			{/* ── Element list ── */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{scene.elements.map((el, idx) => renderElement(el, 0, idx))}

				{scene.elements.length === 0 && (
					<div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
						<span style={{ fontSize: 28, opacity: 0.15 }}>⊞</span>
						<span className="text-xs" style={{ color: "#454545" }}>
							No elements yet.
							<br />
							Click <strong style={{ color: "#6366f1" }}>+ Add</strong> to
							start.
						</span>
					</div>
				)}
			</div>

			{/* ── Reference images section ── */}
			<div style={{ borderTop: "1px solid #111111" }}>
				<div
					className="flex items-center justify-between px-3 shrink-0"
					style={{ height: 36 }}
				>
					<button
						type="button"
						className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase transition-colors"
						style={{ color: "#454545" }}
						onClick={() => setRefCollapsed(!refCollapsed)}
					>
						<span style={{ fontSize: 9, color: "#353535" }}>
							{refCollapsed ? "▸" : "▾"}
						</span>
						Reference
						{refImages.length > 0 && (
							<span
								className="text-[9px] font-bold px-1.5 rounded-full"
								style={{
									background: "rgba(245,158,11,0.15)",
									color: "#f59e0b",
								}}
							>
								{refImages.length}
							</span>
						)}
					</button>

					<button
						type="button"
						className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors"
						style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}
						onMouseEnter={(e) => {
							(e.currentTarget as HTMLElement).style.background = "#f59e0b";
							(e.currentTarget as HTMLElement).style.color = "white";
						}}
						onMouseLeave={(e) => {
							(e.currentTarget as HTMLElement).style.background =
								"rgba(245,158,11,0.1)";
							(e.currentTarget as HTMLElement).style.color = "#f59e0b";
						}}
						onClick={handlePickRefImage}
						title="Add reference image (or drop / paste on canvas)"
					>
						+ Img
					</button>
				</div>

				{!refCollapsed && (
					<div className="pb-1">
						{refImages.map((img) => (
							<RefImageRow
								key={img.id}
								img={img}
								selected={selectedId === img.id}
								onSelect={() => setSelectedId(img.id)}
							/>
						))}

						{refImages.length === 0 && (
							<div className="flex flex-col items-center gap-1.5 py-4 px-4 text-center">
								<span className="text-[10px]" style={{ color: "#353535" }}>
									Drop an image on canvas
									<br />
									or click <strong style={{ color: "#f59e0b" }}>+ Img</strong>
								</span>
							</div>
						)}
					</div>
				)}
			</div>

			{/* ── Delete button ── */}
			{selectedId && (isElSelected || isRefSelected) && (
				<div
					className="px-3 py-2.5 shrink-0"
					style={{ borderTop: "1px solid #111111" }}
				>
					<button
						type="button"
						className="w-full text-xs py-1.5 rounded-md font-medium transition-colors"
						style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
						onMouseEnter={(e) => {
							(e.currentTarget as HTMLElement).style.background =
								"rgba(239,68,68,0.2)";
						}}
						onMouseLeave={(e) => {
							(e.currentTarget as HTMLElement).style.background =
								"rgba(239,68,68,0.1)";
						}}
						onClick={() => {
							if (isRefSelected) {
								deleteRefImage(selectedId);
								setSelectedId(null);
							} else {
								deleteElement(selectedId);
							}
						}}
					>
						{isRefSelected ? "Remove Reference" : "Delete Selected"}
					</button>
				</div>
			)}
		</div>
	);
}

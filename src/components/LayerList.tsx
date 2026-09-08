import { useRef, useState } from "react";
import {
	useSceneStore,
	type ElementKind,
	type ElementKindTag,
	type GroupKind,
	type SceneElement,
} from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { useRefImageStore, type RefImageMeta } from "../store/refImageStore";
import { pickRefImageViaDialog } from "../store/refImageLoader";
import { findParentList } from "../canvas/actions";

const KIND_ICONS: Record<string, string> = {
	Rect: "▭",
	Circle: "○",
	Arc: "◠",
	Line: "─",
	Text: "T",
	Path: "✎",
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

const KINDS: ElementKindTag[] = [
	"Rect",
	"Circle",
	"Arc",
	"Line",
	"Text",
	"Path",
	"Group",
];

/** Where a drop lands relative to the hovered row. */
type DropZone = "above" | "below" | "inside";

interface DragState {
	id: string;
	overId: string | null;
	zone: DropZone;
}

// ── Modifier badges ───────────────────────────────────────────────────

function ModifierBadges({ kind }: { kind: ElementKind }) {
	if (kind.type !== "Group") return null;
	const clip = kind.clip_modifier ?? null;
	const arr = kind.array_modifier ?? null;
	const rotated = kind.rotate.type !== "Literal" || kind.rotate.value !== 0;
	if (!clip && !arr && !rotated) return null;
	return (
		<div className="flex items-center gap-1 shrink-0">
			{rotated && (
				<span
					className="text-[9px] font-bold px-1 rounded"
					style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
					title="Rotated group"
				>
					↻
				</span>
			)}
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

// ── Layer row ─────────────────────────────────────────────────────────

interface LayerRowProps {
	el: SceneElement;
	depth: number;
	selected: boolean;
	inherited: boolean;
	expanded: boolean;
	drag: DragState | null;
	onSelect: (e: React.MouseEvent) => void;
	onToggleVisible: () => void;
	onToggleLock: () => void;
	onRename: (name: string) => void;
	onToggleExpand: () => void;
	onDragStart: () => void;
	onDragOver: (zone: DropZone) => void;
	onDrop: () => void;
}

function LayerRow({
	el,
	depth,
	selected,
	inherited,
	expanded,
	drag,
	onSelect,
	onToggleVisible,
	onToggleLock,
	onRename,
	onToggleExpand,
	onDragStart,
	onDragOver,
	onDrop,
}: LayerRowProps) {
	const [editing, setEditing] = useState(false);
	const isGroup = el.kind.type === "Group";
	const hasChildren = isGroup && (el.kind as GroupKind).children.length > 0;
	const color = KIND_COLORS[el.kind.type] ?? "#737373";
	const isDropTarget = drag?.overId === el.id;

	const bg = selected
		? "rgba(99,102,241,0.14)"
		: inherited
			? "rgba(99,102,241,0.05)"
			: undefined;

	return (
		<div
			className="group relative flex items-center gap-1.5 pr-2 cursor-pointer select-none transition-colors"
			style={{
				height: 30,
				paddingLeft: 6 + depth * 14,
				background: bg,
				borderLeft: selected ? "2px solid #6366f1" : "2px solid transparent",
				opacity: el.visible ? 1 : 0.45,
			}}
			onClick={onSelect}
			draggable
			onDragStart={(e) => {
				e.stopPropagation();
				onDragStart();
			}}
			onDragOver={(e) => {
				e.preventDefault();
				e.stopPropagation();
				const r = e.currentTarget.getBoundingClientRect();
				const rel = (e.clientY - r.top) / r.height;
				onDragOver(isGroup && rel > 0.28 && rel < 0.72 ? "inside" : rel < 0.5 ? "above" : "below");
			}}
			onDrop={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onDrop();
			}}
			onMouseEnter={(e) => {
				if (!selected && !inherited)
					e.currentTarget.style.background = "rgba(255,255,255,0.04)";
			}}
			onMouseLeave={(e) => {
				if (!selected && !inherited) e.currentTarget.style.background = "";
			}}
		>
			{/* Drop indicators */}
			{isDropTarget && drag && (
				<div
					className="absolute pointer-events-none"
					style={
						drag.zone === "inside"
							? {
									inset: 0,
									border: "1px solid #6366f1",
									borderRadius: 4,
									background: "rgba(99,102,241,0.08)",
								}
							: {
									left: 6 + depth * 14,
									right: 4,
									height: 2,
									background: "#6366f1",
									top: drag.zone === "above" ? 0 : undefined,
									bottom: drag.zone === "below" ? 0 : undefined,
								}
					}
				/>
			)}

			<button
				type="button"
				className="shrink-0 w-3.5 h-3.5 flex items-center justify-center text-[9px]"
				style={{
					color: "#454545",
					visibility: isGroup ? "visible" : "hidden",
					opacity: hasChildren ? 1 : 0.3,
					cursor: "pointer",
				}}
				onClick={(e) => {
					e.stopPropagation();
					onToggleExpand();
				}}
				title={expanded ? "Collapse" : "Expand"}
			>
				{expanded ? "▾" : "▸"}
			</button>

			<button
				type="button"
				className="shrink-0 w-4 h-4 flex items-center justify-center rounded"
				style={{
					color: el.visible ? "#737373" : "#3a3a3a",
					fontSize: 10,
					cursor: "pointer",
				}}
				onClick={(e) => {
					e.stopPropagation();
					onToggleVisible();
				}}
				title={el.visible ? "Hide" : "Show"}
			>
				{el.visible ? "◉" : "◎"}
			</button>

			<button
				type="button"
				className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[9px] transition-opacity"
				style={{
					color: el.locked ? "#f59e0b" : "#2e2e2e",
					opacity: el.locked ? 1 : 0,
					cursor: "pointer",
				}}
				onClick={(e) => {
					e.stopPropagation();
					onToggleLock();
				}}
				title={el.locked ? "Unlock" : "Lock"}
			>
				{el.locked ? "⊠" : "⊡"}
			</button>

			<span
				className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold"
				style={{ color, background: `${color}18` }}
				title={el.kind.type}
			>
				{KIND_ICONS[el.kind.type] ?? "?"}
			</span>

			{editing ? (
				<input
					className="flex-1 text-xs outline-none rounded px-1 py-0.5 min-w-0"
					style={{ background: "#1c1c1c", border: "1px solid #6366f1", color: "#e8e8e8" }}
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
						e.stopPropagation();
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
					title={`${el.name} — double-click to rename`}
				>
					{el.name}
				</span>
			)}

			{/* Lock affordance stays visible on hover even when unlocked */}
			{!el.locked && (
				<button
					type="button"
					className="shrink-0 w-4 h-4 items-center justify-center rounded text-[9px] hidden group-hover:flex"
					style={{ color: "#3a3a3a", cursor: "pointer" }}
					onClick={(e) => {
						e.stopPropagation();
						onToggleLock();
					}}
					title="Lock"
				>
					⊡
				</button>
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
			style={{ paddingLeft: 6 + depth * 14 + 8, height: 24 }}
		>
			<button
				type="button"
				className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded transition-colors"
				style={{
					color: open ? "#6366f1" : "#3f3f3f",
					background: open ? "rgba(99,102,241,0.1)" : "transparent",
					cursor: "pointer",
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
						{KINDS.map((k) => (
							<button
								type="button"
								key={k}
								className="flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors"
								style={{ color: "#a0a0a0", cursor: "pointer" }}
								onMouseEnter={(e) => {
									e.currentTarget.style.background = "rgba(255,255,255,0.06)";
									e.currentTarget.style.color = "#e8e8e8";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.background = "";
									e.currentTarget.style.color = "#a0a0a0";
								}}
								onClick={(e) => {
									e.stopPropagation();
									onAdd(k, groupId);
									setOpen(false);
								}}
							>
								<span style={{ color: KIND_COLORS[k], width: 14, textAlign: "center" }}>
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
	const [showSlider, setShowSlider] = useState(false);

	return (
		<div
			className="select-none"
			style={{
				background: selected ? "rgba(245,158,11,0.08)" : undefined,
				borderLeft: selected ? "2px solid #f59e0b" : "2px solid transparent",
			}}
		>
			<div
				className="flex items-center gap-1.5 px-2.5 cursor-pointer transition-colors"
				style={{ height: 32 }}
				onClick={onSelect}
				onMouseEnter={(e) => {
					if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
				}}
				onMouseLeave={(e) => {
					if (!selected) e.currentTarget.style.background = "";
				}}
			>
				<button
					className="shrink-0 w-5 h-5 flex items-center justify-center rounded"
					style={{
						color: img.visible ? "#f59e0b" : "#454545",
						fontSize: 11,
						cursor: "pointer",
					}}
					onClick={(e) => {
						e.stopPropagation();
						updateImage(img.id, { visible: !img.visible });
					}}
					title={img.visible ? "Hide" : "Show"}
				>
					{img.visible ? "◉" : "◎"}
				</button>

				<button
					className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[11px]"
					style={{ color: img.locked ? "#f59e0b" : "#353535", cursor: "pointer" }}
					onClick={(e) => {
						e.stopPropagation();
						updateImage(img.id, { locked: !img.locked });
					}}
					title={img.locked ? "Unlock" : "Lock position"}
				>
					{img.locked ? "⊠" : "⊡"}
				</button>

				<span
					className="flex-1 text-[11px] truncate"
					style={{ color: selected ? "#e8e8e8" : "#808080" }}
					title={img.name}
				>
					{img.name}
				</span>

				<button
					className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors"
					style={{
						color: showSlider ? "#f59e0b" : "#555",
						background: showSlider ? "rgba(245,158,11,0.1)" : "transparent",
						cursor: "pointer",
					}}
					onClick={(e) => {
						e.stopPropagation();
						setShowSlider(!showSlider);
					}}
					title="Adjust opacity"
				>
					{Math.round(img.opacity * 100)}%
				</button>

				<button
					className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[11px]"
					style={{ color: "#353535", cursor: "pointer" }}
					onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
					onMouseLeave={(e) => (e.currentTarget.style.color = "#353535")}
					onClick={(e) => {
						e.stopPropagation();
						if (selected) useEditorStore.getState().setSelection([]);
						deleteImage(img.id);
					}}
					title="Remove reference"
				>
					✕
				</button>
			</div>

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
				</div>
			)}
		</div>
	);
}

// ── Main LayerList ────────────────────────────────────────────────────

export default function LayerList() {
	const scene = useSceneStore((s) => s.scene);
	const addElement = useSceneStore((s) => s.addElement);
	const deleteElements = useSceneStore((s) => s.deleteElements);
	const setElementVisible = useSceneStore((s) => s.setElementVisible);
	const setElementLocked = useSceneStore((s) => s.setElementLocked);
	const renameElement = useSceneStore((s) => s.renameElement);
	const reorderChildren = useSceneStore((s) => s.reorderChildren);
	const moveElement = useSceneStore((s) => s.moveElement);
	const groupElements = useSceneStore((s) => s.groupElements);
	const ungroupElement = useSceneStore((s) => s.ungroup);
	const addElementToGroup = useSceneStore((s) => s.addElementToGroup);

	const selection = useEditorStore((s) => s.selection);
	const setSelection = useEditorStore((s) => s.setSelection);
	const toggleSelected = useEditorStore((s) => s.toggleSelected);

	const refImages = useRefImageStore((s) => s.images);
	const deleteRefImage = useRefImageStore((s) => s.deleteImage);

	const [showAddMenu, setShowAddMenu] = useState(false);
	const [refCollapsed, setRefCollapsed] = useState(false);
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const [drag, setDrag] = useState<DragState | null>(null);
	const lastClicked = useRef<string | null>(null);

	const selSet = new Set(selection);

	const toggleExpanded = (id: string) =>
		setExpandedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	/** Flat, visible-in-list order — used for shift-range selection. */
	const visibleOrder: { id: string; parentId: string | null }[] = [];
	const collectOrder = (list: SceneElement[], parentId: string | null) => {
		for (const el of list) {
			visibleOrder.push({ id: el.id, parentId });
			if (el.kind.type === "Group" && expandedGroups.has(el.id))
				collectOrder(el.kind.children, el.id);
		}
	};
	collectOrder(scene.elements, null);

	const handleSelect = (id: string, e: React.MouseEvent) => {
		if (e.shiftKey && lastClicked.current) {
			const a = visibleOrder.findIndex((v) => v.id === lastClicked.current);
			const b = visibleOrder.findIndex((v) => v.id === id);
			if (a >= 0 && b >= 0) {
				const [lo, hi] = a < b ? [a, b] : [b, a];
				setSelection(visibleOrder.slice(lo, hi + 1).map((v) => v.id));
				return;
			}
		}
		if (e.ctrlKey || e.metaKey) toggleSelected(id);
		else setSelection([id]);
		lastClicked.current = id;
	};

	const handleDrop = async () => {
		const d = drag;
		setDrag(null);
		if (!d || !d.overId || d.overId === d.id) return;

		if (d.zone === "inside") {
			await moveElement(d.id, d.overId, null);
			setExpandedGroups((prev) => new Set(prev).add(d.overId!));
			return;
		}

		const target = findParentList(scene, d.overId);
		const source = findParentList(scene, d.id);
		if (!target) return;

		if (source && source.parentId === target.parentId) {
			// Same container: a pure reorder keeps ids stable.
			const ids = target.ids.filter((i) => i !== d.id);
			const at = ids.indexOf(d.overId) + (d.zone === "below" ? 1 : 0);
			ids.splice(Math.max(0, at), 0, d.id);
			await reorderChildren(target.parentId, ids);
		} else {
			const at = target.ids.indexOf(d.overId) + (d.zone === "below" ? 1 : 0);
			await moveElement(d.id, target.parentId, Math.max(0, at));
		}
	};

	const selectedElements = selection
		.map((id) => findElement(scene.elements, id))
		.filter((e): e is SceneElement => !!e);
	const canGroup = selection.length >= 2;
	const canUngroup = selectedElements.some((e) => e.kind.type === "Group");
	const hasRefSelected = refImages.some((i) => selSet.has(i.id));

	const renderElement = (el: SceneElement, depth: number): React.ReactNode => {
		const isGroup = el.kind.type === "Group";
		const children = isGroup ? (el.kind as GroupKind).children : [];
		const isExpanded = expandedGroups.has(el.id);
		// A group reads as "involved" when one of its descendants is selected.
		const inherited =
			!selSet.has(el.id) && isGroup && subtreeHasSelection(children, selSet);

		return (
			<div key={el.id}>
				<LayerRow
					el={el}
					depth={depth}
					selected={selSet.has(el.id)}
					inherited={inherited}
					expanded={isExpanded}
					drag={drag}
					onSelect={(e) => handleSelect(el.id, e)}
					onToggleVisible={() => setElementVisible(el.id, !el.visible)}
					onToggleLock={() => setElementLocked(el.id, !el.locked)}
					onRename={(name) => renameElement(el.id, name)}
					onToggleExpand={() => toggleExpanded(el.id)}
					onDragStart={() => setDrag({ id: el.id, overId: null, zone: "below" })}
					onDragOver={(zone) =>
						setDrag((d) => (d ? { ...d, overId: el.id, zone } : d))
					}
					onDrop={handleDrop}
				/>
				{isGroup && isExpanded && (
					<div>
						{children.map((child) => renderElement(child, depth + 1))}
						<AddChildRow
							depth={depth + 1}
							groupId={el.id}
							onAdd={async (kind, gid) => {
								const child = await addElementToGroup(kind, gid);
								setSelection([child.id]);
							}}
						/>
					</div>
				)}
			</div>
		);
	};

	return (
		<div
			className="flex flex-col shrink-0"
			style={{ width: 232, background: "#080808", borderRight: "1px solid #111111" }}
		>
			{/* ── Header ── */}
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
							cursor: "pointer",
						}}
						onClick={() => setShowAddMenu(!showAddMenu)}
					>
						+ Add
					</button>

					{showAddMenu && (
						<>
							<div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
							<div
								className="absolute right-0 top-full mt-1.5 z-50 rounded-lg overflow-hidden py-1"
								style={{
									background: "#0d0d0d",
									border: "1px solid #1a1a1a",
									boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
									minWidth: 150,
								}}
							>
								{KINDS.map((k) => (
									<button
										type="button"
										key={k}
										className="flex items-center gap-2.5 w-full px-3 py-2 text-xs transition-colors"
										style={{ color: "#a0a0a0", cursor: "pointer" }}
										onMouseEnter={(e) => {
											e.currentTarget.style.background = "rgba(255,255,255,0.06)";
											e.currentTarget.style.color = "#e8e8e8";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = "";
											e.currentTarget.style.color = "#a0a0a0";
										}}
										onClick={async () => {
											setShowAddMenu(false);
											const el = await addElement(k);
											setSelection([el.id]);
										}}
									>
										<span
											style={{ color: KIND_COLORS[k], width: 16, textAlign: "center" }}
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

			{/* ── Group / Ungroup ── */}
			{(canGroup || canUngroup) && (
				<div
					className="flex items-center gap-1.5 px-3 py-1.5 shrink-0"
					style={{ borderBottom: "1px solid #111111" }}
				>
					{canGroup && (
						<button
							type="button"
							className="flex-1 text-[10px] font-semibold py-1 rounded-md"
							style={{
								background: "rgba(99,102,241,0.15)",
								color: "#6366f1",
								cursor: "pointer",
							}}
							onClick={async () => {
								const gid = await groupElements(selection);
								if (gid) setSelection([gid]);
							}}
							title="Group (Ctrl+G)"
						>
							⊞ Group {selection.length}
						</button>
					)}
					{canUngroup && (
						<button
							type="button"
							className="flex-1 text-[10px] font-semibold py-1 rounded-md"
							style={{
								background: "rgba(115,115,115,0.15)",
								color: "#a0a0a0",
								cursor: "pointer",
							}}
							onClick={async () => {
								for (const el of selectedElements)
									if (el.kind.type === "Group") await ungroupElement(el.id);
							}}
							title="Ungroup (Ctrl+Shift+G)"
						>
							⊟ Ungroup
						</button>
					)}
				</div>
			)}

			{/* ── Element list ── */}
			<div
				className="flex-1 overflow-y-auto min-h-0"
				onDragOver={(e) => e.preventDefault()}
				onDrop={async () => {
					// Dropping into empty space moves the item to the root.
					const d = drag;
					setDrag(null);
					if (d) await moveElement(d.id, null, null);
				}}
			>
				{scene.elements.map((el) => renderElement(el, 0))}

				{scene.elements.length === 0 && (
					<div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
						<span style={{ fontSize: 28, opacity: 0.15 }}>⊞</span>
						<span className="text-xs" style={{ color: "#454545" }}>
							Nothing here yet.
							<br />
							Draw with the tools, or click{" "}
							<strong style={{ color: "#6366f1" }}>+ Add</strong>.
						</span>
					</div>
				)}
			</div>

			{/* ── Reference images ── */}
			<div style={{ borderTop: "1px solid #111111" }}>
				<div
					className="flex items-center justify-between px-3 shrink-0"
					style={{ height: 34 }}
				>
					<button
						type="button"
						className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase"
						style={{ color: "#454545", cursor: "pointer" }}
						onClick={() => setRefCollapsed(!refCollapsed)}
					>
						<span style={{ fontSize: 9, color: "#353535" }}>
							{refCollapsed ? "▸" : "▾"}
						</span>
						Reference
						{refImages.length > 0 && (
							<span
								className="text-[9px] font-bold px-1.5 rounded-full"
								style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}
							>
								{refImages.length}
							</span>
						)}
					</button>

					<button
						type="button"
						className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors"
						style={{
							background: "rgba(245,158,11,0.1)",
							color: "#f59e0b",
							cursor: "pointer",
						}}
						onClick={() => pickRefImageViaDialog().catch(console.error)}
						title="Add reference image (or drop / paste on canvas)"
					>
						+ Img
					</button>
				</div>

				{!refCollapsed && (
					<div className="pb-1 max-h-40 overflow-y-auto">
						{refImages.map((img) => (
							<RefImageRow
								key={img.id}
								img={img}
								selected={selSet.has(img.id)}
								onSelect={() => setSelection([img.id])}
							/>
						))}
						{refImages.length === 0 && (
							<div className="flex flex-col items-center gap-1.5 py-3 px-4 text-center">
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

			{/* ── Delete ── */}
			{selection.length > 0 && (
				<div className="px-3 py-2.5 shrink-0" style={{ borderTop: "1px solid #111111" }}>
					<button
						type="button"
						className="w-full text-xs py-1.5 rounded-md font-medium transition-colors"
						style={{
							background: "rgba(239,68,68,0.1)",
							color: "#ef4444",
							cursor: "pointer",
						}}
						onClick={async () => {
							const refIds = selection.filter((id) =>
								refImages.some((i) => i.id === id),
							);
							for (const id of refIds) deleteRefImage(id);
							const elIds = selection.filter((id) => !refIds.includes(id));
							if (elIds.length) await deleteElements(elIds);
							setSelection([]);
						}}
					>
						{hasRefSelected && selection.length === 1
							? "Remove Reference"
							: `Delete ${selection.length} Selected`}
					</button>
				</div>
			)}
		</div>
	);
}

// ── Tree helpers ──────────────────────────────────────────────────────

function findElement(list: SceneElement[], id: string): SceneElement | null {
	for (const el of list) {
		if (el.id === id) return el;
		if (el.kind.type === "Group") {
			const f = findElement(el.kind.children, id);
			if (f) return f;
		}
	}
	return null;
}

function subtreeHasSelection(list: SceneElement[], sel: Set<string>): boolean {
	for (const el of list) {
		if (sel.has(el.id)) return true;
		if (el.kind.type === "Group" && subtreeHasSelection(el.kind.children, sel))
			return true;
	}
	return false;
}

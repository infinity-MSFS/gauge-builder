import { useEffect, useState } from "react";
import { TOOLS, useEditorStore, type Tool } from "../store/editorStore";
import type { SnapSettings } from "../canvas/snap";
import type { AlignMode, DistributeMode, OrderMode } from "../canvas/actions";

// ─── Tool glyphs ──────────────────────────────────────────────────────

function ToolIcon({ name }: { name: string }) {
	const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;
	switch (name) {
		case "arrow":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path
						d="M3 2 L3 12.5 L5.9 9.8 L7.7 13.6 L9.4 12.8 L7.6 9.1 L11.5 8.8 Z"
						fill="currentColor"
					/>
				</svg>
			);
		case "node":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path {...s} d="M2.5 13 Q 7 2 13.5 7" />
					<rect x="1" y="11.5" width="3" height="3" fill="currentColor" stroke="none" />
					<rect x="12" y="5.5" width="3" height="3" {...s} />
				</svg>
			);
		case "pen":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path {...s} strokeLinejoin="round" d="M8 1.5 L12.5 8 L8 14 L3.5 8 Z" />
					<path {...s} d="M8 8 L8 14" />
				</svg>
			);
		case "rect":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<rect x="2.5" y="3.5" width="11" height="9" rx="1" {...s} />
				</svg>
			);
		case "circle":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<circle cx="8" cy="8" r="5.5" {...s} />
				</svg>
			);
		case "arc":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path {...s} strokeLinecap="round" d="M2 11 A 6.5 6.5 0 0 1 14 11" />
				</svg>
			);
		case "line":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path {...s} strokeLinecap="round" d="M3 13 L13 3" />
				</svg>
			);
		case "text":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path {...s} strokeLinecap="round" d="M3 4 L13 4 M8 4 L8 13 M6 13 L10 13" />
				</svg>
			);
		case "hand":
			return (
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path
						{...s}
						strokeLinejoin="round"
						d="M5 8V3.6a1.1 1.1 0 0 1 2.2 0V7m0-1.2a1.1 1.1 0 0 1 2.2 0V7m0-.6a1.1 1.1 0 0 1 2.2 0v3.4c0 2.3-1.6 4.2-4 4.2S4 12.5 4 10.6L2.9 8.4a1.05 1.05 0 0 1 1.7-1.2L5 8"
					/>
				</svg>
			);
		default:
			return null;
	}
}

// ─── Shared chrome primitives ─────────────────────────────────────────

/** Keep the floating chrome clear of the ruler strips. */
const RULER_GUTTER = 26;

const panel: React.CSSProperties = {
	background: "rgba(9,9,9,0.92)",
	border: "1px solid #1c1c1c",
	backdropFilter: "blur(10px)",
	borderRadius: 8,
};

function ChipButton({
	active,
	onClick,
	title,
	children,
	accent = "#6366f1",
	disabled,
}: {
	active?: boolean;
	onClick?: () => void;
	title?: string;
	children: React.ReactNode;
	accent?: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			className="flex items-center justify-center transition-colors select-none"
			style={{
				height: 24,
				minWidth: 24,
				padding: "0 7px",
				borderRadius: 5,
				fontSize: 11,
				fontWeight: 500,
				cursor: disabled ? "not-allowed" : "pointer",
				background: active ? accent : "transparent",
				color: disabled ? "#2e2e2e" : active ? "#ffffff" : "#8a8a8a",
			}}
			onMouseEnter={(e) => {
				if (!active && !disabled)
					e.currentTarget.style.background = "rgba(255,255,255,0.07)";
			}}
			onMouseLeave={(e) => {
				if (!active) e.currentTarget.style.background = "transparent";
			}}
		>
			{children}
		</button>
	);
}

function Divider() {
	return <div style={{ width: 1, height: 16, background: "#1e1e1e" }} />;
}

// ─── Align glyphs ─────────────────────────────────────────────────────

const ALIGN_ICONS: { mode: AlignMode; title: string; d: string }[] = [
	{ mode: "left", title: "Align left edges", d: "M2 2v12M4.5 5h8v2h-8zM4.5 9h5v2h-5z" },
	{ mode: "hcenter", title: "Align horizontal centres", d: "M8 2v12M3 5h10v2H3zM5 9h6v2H5z" },
	{ mode: "right", title: "Align right edges", d: "M14 2v12M3.5 5h8v2h-8zM6.5 9h5v2h-5z" },
	{ mode: "top", title: "Align top edges", d: "M2 2h12M5 4.5v8h2v-8zM9 4.5v5h2v-5z" },
	{ mode: "vcenter", title: "Align vertical centres", d: "M2 8h12M5 3v10h2V3zM9 5v6h2V5z" },
	{ mode: "bottom", title: "Align bottom edges", d: "M2 14h12M5 3.5v8h2v-8zM9 6.5v5h2v-5z" },
];

function AlignIcon({ d }: { d: string }) {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16">
			<path d={d} fill="currentColor" />
		</svg>
	);
}

// ─── Props ────────────────────────────────────────────────────────────

interface Props {
	tool: Tool;
	selectionCount: number;
	snap: SnapSettings;
	showGrid: boolean;
	showRulers: boolean;
	showOutlines: boolean;
	isolationId: string | null;
	isolationName: string | null;
	menu: { x: number; y: number } | null;
	onCloseMenu: () => void;
	onFit: () => void;
	onZoom: (z: number) => void;
	getZoom: () => number;
	onAddImage: () => void;
	onAlign: (m: AlignMode) => void;
	onDistribute: (m: DistributeMode) => void;
	onExitIsolation: () => void;
	onReorder: (m: OrderMode) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onGroup: () => void;
	onUngroup: () => void;
	onToggleLock: () => void;
	onToggleHide: () => void;
}

export default function CanvasChrome(p: Props) {
	const setTool = useEditorStore((s) => s.setTool);
	const patchSnap = useEditorStore((s) => s.patchSnap);
	const setShowGrid = useEditorStore((s) => s.setShowGrid);
	const setShowRulers = useEditorStore((s) => s.setShowRulers);
	const setShowOutlines = useEditorStore((s) => s.setShowOutlines);
	const stickyTools = useEditorStore((s) => s.stickyTools);
	const setStickyTools = useEditorStore((s) => s.setStickyTools);

	const [gridOpen, setGridOpen] = useState(false);
	const hasSel = p.selectionCount > 0;
	const multiSel = p.selectionCount >= 2;

	useEffect(() => {
		if (!p.menu) return;
		const close = () => p.onCloseMenu();
		window.addEventListener("resize", close);
		return () => window.removeEventListener("resize", close);
	}, [p.menu]);

	const toolHint = TOOLS.find((t) => t.tool === p.tool)?.hint ?? "";

	return (
		<>
			{/* ── Tool rail ── */}
			<div
				className="absolute flex flex-col gap-0.5 p-1"
				style={{ ...panel, left: RULER_GUTTER, top: 34 }}
			>
				{TOOLS.map((t, i) => (
					<div key={t.tool}>
						{(i === 2 || i === 3 || i === 8) && (
							<div style={{ height: 1, background: "#1a1a1a", margin: "3px 4px" }} />
						)}
						<button
							type="button"
							title={`${t.label}  (${t.key})`}
							onClick={() => setTool(t.tool)}
							className="flex items-center justify-center transition-colors"
							style={{
								width: 30,
								height: 30,
								borderRadius: 6,
								cursor: "pointer",
								background: p.tool === t.tool ? "#6366f1" : "transparent",
								color: p.tool === t.tool ? "#ffffff" : "#7c7c7c",
							}}
							onMouseEnter={(e) => {
								if (p.tool !== t.tool) {
									e.currentTarget.style.background = "rgba(255,255,255,0.07)";
									e.currentTarget.style.color = "#e8e8e8";
								}
							}}
							onMouseLeave={(e) => {
								if (p.tool !== t.tool) {
									e.currentTarget.style.background = "transparent";
									e.currentTarget.style.color = "#7c7c7c";
								}
							}}
						>
							<ToolIcon name={t.icon} />
						</button>
					</div>
				))}
			</div>

			{/* ── Top control bar ── */}
			<div
				className="absolute flex items-center gap-1 px-1.5"
				style={{ ...panel, left: RULER_GUTTER + 42, top: 34, height: 32 }}
			>
				<ChipButton
					active={p.snap.enabled}
					onClick={() => patchSnap({ enabled: !p.snap.enabled })}
					title="Snapping (;) — hold Ctrl to bypass"
				>
					⌁ Snap
				</ChipButton>
				<ChipButton
					active={p.snap.enabled && p.snap.grid}
					disabled={!p.snap.enabled}
					onClick={() => patchSnap({ grid: !p.snap.grid })}
					title="Snap to grid"
				>
					Grid
				</ChipButton>
				<ChipButton
					active={p.snap.enabled && p.snap.objects}
					disabled={!p.snap.enabled}
					onClick={() => patchSnap({ objects: !p.snap.objects })}
					title="Snap to object edges, centres and anchors"
				>
					Obj
				</ChipButton>
				<ChipButton
					active={p.snap.enabled && p.snap.artboard}
					disabled={!p.snap.enabled}
					onClick={() => patchSnap({ artboard: !p.snap.artboard })}
					title="Snap to artboard edges and centre"
				>
					Art
				</ChipButton>

				<Divider />

				<div className="relative">
					<ChipButton
						active={gridOpen}
						onClick={() => setGridOpen((v) => !v)}
						title="Grid settings"
					>
						{p.snap.gridSize}px ▾
					</ChipButton>
					{gridOpen && (
						<>
							<div className="fixed inset-0 z-40" onClick={() => setGridOpen(false)} />
							<div
								className="absolute z-50 p-2.5 flex flex-col gap-2"
								style={{ ...panel, top: 30, left: 0, width: 180 }}
							>
								<label className="flex items-center justify-between text-[11px] text-[#8a8a8a]">
									Grid size
									<input
										type="number"
										min={1}
										max={256}
										value={p.snap.gridSize}
										onChange={(e) =>
											patchSnap({
												gridSize: Math.max(1, parseFloat(e.target.value) || 1),
											})
										}
										className="w-16 text-center"
										style={{
											background: "#0f0f0f",
											border: "1px solid #1e1e1e",
											borderRadius: 4,
											color: "#e8e8e8",
											padding: "3px 5px",
											outline: "none",
										}}
									/>
								</label>
								<div className="flex gap-1">
									{[4, 8, 16, 32].map((g) => (
										<ChipButton
											key={g}
											active={p.snap.gridSize === g}
											onClick={() => patchSnap({ gridSize: g })}
										>
											{g}
										</ChipButton>
									))}
								</div>
								<label className="flex items-center justify-between text-[11px] text-[#8a8a8a]">
									Snap radius
									<input
										type="number"
										min={1}
										max={40}
										value={p.snap.tolerancePx}
										onChange={(e) =>
											patchSnap({
												tolerancePx: Math.max(1, parseFloat(e.target.value) || 1),
											})
										}
										className="w-16 text-center"
										style={{
											background: "#0f0f0f",
											border: "1px solid #1e1e1e",
											borderRadius: 4,
											color: "#e8e8e8",
											padding: "3px 5px",
											outline: "none",
										}}
									/>
								</label>
								<label className="flex items-center justify-between text-[11px] text-[#8a8a8a]">
									Angle step
									<input
										type="number"
										min={1}
										max={90}
										value={p.snap.angleStep}
										onChange={(e) =>
											patchSnap({
												angleStep: Math.max(1, parseFloat(e.target.value) || 15),
											})
										}
										className="w-16 text-center"
										style={{
											background: "#0f0f0f",
											border: "1px solid #1e1e1e",
											borderRadius: 4,
											color: "#e8e8e8",
											padding: "3px 5px",
											outline: "none",
										}}
									/>
								</label>
								<label className="flex items-center gap-2 text-[11px] text-[#8a8a8a] cursor-pointer">
									<input
										type="checkbox"
										checked={stickyTools}
										onChange={(e) => setStickyTools(e.target.checked)}
									/>
									Keep tool after drawing
								</label>
							</div>
						</>
					)}
				</div>

				<ChipButton
					active={p.showGrid}
					onClick={() => setShowGrid(!p.showGrid)}
					title="Show grid (')"
				>
					▦
				</ChipButton>
				<ChipButton
					active={p.showRulers}
					onClick={() => setShowRulers(!p.showRulers)}
					title="Show rulers"
				>
					⊹
				</ChipButton>
				<ChipButton
					active={p.showOutlines}
					onClick={() => setShowOutlines(!p.showOutlines)}
					title="Outline preview"
				>
					◇
				</ChipButton>

				<Divider />

				<ChipButton onClick={p.onAddImage} title="Add reference image" accent="#f59e0b">
					+ Ref
				</ChipButton>
			</div>

			{/* ── Align bar ── */}
			{hasSel && (
				<div
					className="absolute flex items-center gap-1 px-1.5"
					style={{ ...panel, left: RULER_GUTTER + 42, top: 72, height: 32 }}
				>
					{ALIGN_ICONS.map((a, i) => (
						<span key={a.mode} className="flex items-center gap-1">
							{i === 3 && <Divider />}
							<ChipButton
								onClick={() => p.onAlign(a.mode)}
								title={
									multiSel ? a.title : `${a.title} (to artboard)`
								}
							>
								<AlignIcon d={a.d} />
							</ChipButton>
						</span>
					))}
					<Divider />
					<ChipButton
						disabled={p.selectionCount < 3}
						onClick={() => p.onDistribute("hspace")}
						title="Distribute horizontal spacing"
					>
						↔
					</ChipButton>
					<ChipButton
						disabled={p.selectionCount < 3}
						onClick={() => p.onDistribute("vspace")}
						title="Distribute vertical spacing"
					>
						↕
					</ChipButton>
					<Divider />
					<ChipButton onClick={() => p.onReorder("front")} title="Bring to front (Ctrl+Shift+])">
						⤒
					</ChipButton>
					<ChipButton onClick={() => p.onReorder("forward")} title="Bring forward (Ctrl+])">
						↑
					</ChipButton>
					<ChipButton onClick={() => p.onReorder("backward")} title="Send backward (Ctrl+[)">
						↓
					</ChipButton>
					<ChipButton onClick={() => p.onReorder("back")} title="Send to back (Ctrl+Shift+[)">
						⤓
					</ChipButton>
					<Divider />
					<ChipButton
						disabled={!multiSel}
						onClick={p.onGroup}
						title="Group (Ctrl+G)"
					>
						⊞
					</ChipButton>
					<ChipButton onClick={p.onUngroup} title="Ungroup (Ctrl+Shift+G)">
						⊟
					</ChipButton>
				</div>
			)}

			{/* ── Isolation breadcrumb ── */}
			{p.isolationId && (
				<div
					className="absolute flex items-center gap-2 px-2.5"
					style={{
						...panel,
						left: "50%",
						transform: "translateX(-50%)",
						top: 34,
						height: 28,
						borderColor: "#6366f1",
					}}
				>
					<span className="text-[11px]" style={{ color: "#8a8a8a" }}>
						Editing inside
					</span>
					<span className="text-[11px] font-semibold" style={{ color: "#818cf8" }}>
						{p.isolationName}
					</span>
					<button
						type="button"
						onClick={p.onExitIsolation}
						className="text-[11px]"
						style={{ color: "#5a5a5a", cursor: "pointer" }}
						title="Exit group (Esc)"
					>
						✕
					</button>
				</div>
			)}

			{/* ── Status bar ── */}
			<div
				className="absolute flex items-center gap-2 px-2"
				style={{ ...panel, right: 8, bottom: 8, height: 28 }}
			>
				<span
					className="text-[11px] select-none"
					style={{ color: "#4a4a4a", maxWidth: 260 }}
				>
					{toolHint}
				</span>
				<Divider />
				<ChipButton onClick={() => p.onZoom(p.getZoom() / 1.25)} title="Zoom out (Ctrl+−)">
					−
				</ChipButton>
				<span
					id="zoom-readout"
					className="text-[11px] font-mono select-none text-center"
					style={{ color: "#8a8a8a", width: 42 }}
				>
					100%
				</span>
				<ChipButton onClick={() => p.onZoom(p.getZoom() * 1.25)} title="Zoom in (Ctrl++)">
					+
				</ChipButton>
				<ChipButton onClick={p.onFit} title="Fit artboard (Ctrl+0)">
					Fit
				</ChipButton>
			</div>

			{/* ── Context menu ── */}
			{p.menu && (
				<>
					<div className="fixed inset-0 z-40" onMouseDown={p.onCloseMenu} />
					<div
						className="absolute z-50 py-1"
						style={{
							...panel,
							left: Math.min(p.menu.x, 9999),
							top: p.menu.y,
							minWidth: 190,
							boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
						}}
					>
						{(
							[
								["Duplicate", "Ctrl+D", p.onDuplicate, hasSel],
								["Group", "Ctrl+G", p.onGroup, multiSel],
								["Ungroup", "Ctrl+Shift+G", p.onUngroup, hasSel],
								["sep"],
								["Bring to Front", "Ctrl+Shift+]", () => p.onReorder("front"), hasSel],
								["Bring Forward", "Ctrl+]", () => p.onReorder("forward"), hasSel],
								["Send Backward", "Ctrl+[", () => p.onReorder("backward"), hasSel],
								["Send to Back", "Ctrl+Shift+[", () => p.onReorder("back"), hasSel],
								["sep"],
								["Toggle Lock", "", p.onToggleLock, hasSel],
								["Toggle Visible", "", p.onToggleHide, hasSel],
								["sep"],
								["Delete", "Del", p.onDelete, hasSel],
							] as (
								| [string]
								| [string, string, () => void, boolean]
							)[]
						).map((row, i) => {
							if (row.length === 1)
								return (
									<div
										key={`sep${i}`}
										style={{ height: 1, background: "#1a1a1a", margin: "4px 0" }}
									/>
								);
							const [label, accel, action, enabled] = row;
							const danger = label === "Delete";
							return (
								<button
									type="button"
									key={label}
									disabled={!enabled}
									onClick={() => {
										action();
										p.onCloseMenu();
									}}
									className="flex items-center justify-between w-full px-3 py-1.5 text-xs transition-colors"
									style={{
										color: !enabled ? "#2e2e2e" : danger ? "#ef4444" : "#a0a0a0",
										cursor: enabled ? "pointer" : "not-allowed",
									}}
									onMouseEnter={(e) => {
										if (enabled)
											e.currentTarget.style.background = danger
												? "rgba(239,68,68,0.12)"
												: "rgba(255,255,255,0.06)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "transparent";
									}}
								>
									<span>{label}</span>
									<span style={{ color: "#3a3a3a", fontSize: 10 }}>{accel}</span>
								</button>
							);
						})}
					</div>
				</>
			)}
		</>
	);
}

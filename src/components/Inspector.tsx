import { useState, type ReactElement } from "react";
import {
	useSceneStore,
	type BoundValue,
	type BoundColor,
	type NvgStyle,
	type ElementKind,
	type SceneElement,
	type VarEntry,
	type LineCap,
	type LineJoin,
	type ClipModifier,
	type ArrayModifier,
} from "../store/sceneStore";
import {
	useRefImageStore,
	refImageElements,
	type RefImageMeta,
} from "../store/refImageStore";
import { pickRefImageViaDialog } from "../store/refImageLoader";
import VarPanel from "./VarPanel";
import { Dropdown } from "./Dropdown";

// ── Helpers ────────────────────────────────────────────────────────

function bvNumber(bv: BoundValue): number {
	return bv.type === "Literal" ? bv.value : 0;
}
function lit(v: number): BoundValue {
	return { type: "Literal", value: v };
}
function colorFromBound(c: BoundColor | null): string {
	if (!c) return "#000000";
	const [r, g, b] = c.Rgba;
	const h = (n: number) =>
		Math.round(n * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}
function colorToBound(hex: string, alpha: number): BoundColor {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	return { Rgba: [r, g, b, alpha] };
}
function alphaFromBound(c: BoundColor | null): number {
	return c ? c.Rgba[3] : 1;
}

type BVMode = "Literal" | "LVar" | "AVar" | "Expr";
function bvMode(bv: BoundValue): BVMode {
	return bv.type;
}

// ── Shared input style ─────────────────────────────────────────────

const inputCls =
	"bg-[#0f0f0f] border border-[#181818] rounded-md text-[#e8e8e8] text-xs px-2.5 py-1.5 outline-none focus:border-[#6366f1] transition-colors w-full";

// ── Section header ─────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div
			className="text-[10px] font-semibold uppercase tracking-widest mt-3 mb-1.5"
			style={{ color: "#454545" }}
		>
			{children}
		</div>
	);
}

// ── Field row ──────────────────────────────────────────────────────

function FieldRow({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-2">
			<span
				className="text-[11px] shrink-0 w-10 text-right"
				style={{ color: "#737373" }}
			>
				{label}
			</span>
			<div className="flex-1 min-w-0">{children}</div>
		</div>
	);
}

// ── Mode colors ────────────────────────────────────────────────────

const MODE_PILL: Record<BVMode, { bg: string; color: string }> = {
	Literal: { bg: "#111111", color: "#888888" },
	LVar: { bg: "rgba(59,130,246,0.2)", color: "#60a5fa" },
	AVar: { bg: "rgba(34,197,94,0.2)", color: "#4ade80" },
	Expr: { bg: "rgba(168,85,247,0.2)", color: "#c084fc" },
};

const MODE_OPTIONS = [
	{ value: "Literal", label: "Val" },
	{ value: "LVar", label: "LVar" },
	{ value: "AVar", label: "AVar" },
	{ value: "Expr", label: "Expr" },
];

// ── BoundValueField ────────────────────────────────────────────────

function BoundValueField({
	label,
	value,
	onChange,
	vars,
}: {
	label: string;
	value: BoundValue;
	onChange: (bv: BoundValue) => void;
	vars: VarEntry[];
}) {
	const mode = bvMode(value);

	const setMode = (newMode: BVMode) => {
		switch (newMode) {
			case "Literal":
				onChange(lit(bvNumber(value)));
				break;
			case "LVar": {
				const first = vars.find((v) => v.kind === "LVar");
				onChange({ type: "LVar", name: first?.id ?? "" });
				break;
			}
			case "AVar": {
				const first = vars.find((v) => v.kind === "AVar");
				onChange({
					type: "AVar",
					name: first?.id ?? "",
					unit: first?.unit ?? "Number",
					index: first?.index ?? 0,
				});
				break;
			}
			case "Expr":
				onChange({ type: "Expr", expr: "" });
				break;
		}
	};

	const lvarOptions = vars
		.filter((v) => v.kind === "LVar")
		.map((v) => ({
			value: v.id,
			label: v.id + (v.sim_name ? ` (${v.sim_name})` : ""),
		}));

	const avarOptions = vars
		.filter((v) => v.kind === "AVar")
		.map((v) => ({
			value: v.id,
			label: v.id + (v.sim_name ? ` (${v.sim_name})` : ""),
		}));

	return (
		<FieldRow label={label}>
			<div className="flex items-center gap-1.5">
				<Dropdown
					compact
					pillStyle={MODE_PILL[mode]}
					value={mode}
					onChange={(v) => setMode(v as BVMode)}
					options={MODE_OPTIONS}
				/>

				{mode === "Literal" && (
					<input
						type="number"
						className={inputCls}
						value={value.type === "Literal" ? value.value : 0}
						onChange={(e) => onChange(lit(parseFloat(e.target.value) || 0))}
					/>
				)}
				{mode === "LVar" && (
					<Dropdown
						value={value.type === "LVar" ? value.name : ""}
						onChange={(v) => onChange({ type: "LVar", name: v })}
						options={lvarOptions}
						placeholder="— select LVar —"
					/>
				)}
				{mode === "AVar" && (
					<Dropdown
						value={value.type === "AVar" ? value.name : ""}
						onChange={(v) => {
							const picked = vars.find((va) => va.id === v);
							onChange({
								type: "AVar",
								name: v,
								unit: picked?.unit ?? "Number",
								index: picked?.index ?? 0,
							});
						}}
						options={avarOptions}
						placeholder="— select AVar —"
					/>
				)}
				{mode === "Expr" && (
					<input
						type="text"
						placeholder="RPN expression"
						className={`${inputCls} font-mono`}
						value={value.type === "Expr" ? value.expr : ""}
						onChange={(e) => onChange({ type: "Expr", expr: e.target.value })}
					/>
				)}
			</div>
		</FieldRow>
	);
}

// ── Style editor ───────────────────────────────────────────────────

function StyleEditor({
	style,
	onChange,
}: {
	style: NvgStyle;
	onChange: (s: NvgStyle) => void;
}) {
	return (
		<div className="space-y-2.5">
			<SectionLabel>Fill</SectionLabel>
			<div className="flex items-center gap-2">
				<input
					type="checkbox"
					id="fill-toggle"
					checked={style.fill !== null}
					onChange={(e) =>
						onChange({
							...style,
							fill: e.target.checked ? colorToBound("#cccccc", 1) : null,
						})
					}
				/>
				<label
					htmlFor="fill-toggle"
					className="text-xs cursor-pointer"
					style={{ color: "#a0a0a0" }}
				>
					Enable fill
				</label>
				{style.fill && (
					<div className="flex items-center gap-2 ml-auto">
						<input
							type="color"
							className="w-7 h-7 rounded-md cursor-pointer"
							value={colorFromBound(style.fill)}
							onChange={(e) =>
								onChange({
									...style,
									fill: colorToBound(
										e.target.value,
										alphaFromBound(style.fill),
									),
								})
							}
						/>
						<input
							type="number"
							min={0}
							max={1}
							step={0.05}
							className="w-16 text-center"
							style={{
								background: "#0f0f0f",
								border: "1px solid #181818",
								borderRadius: 6,
								color: "#e8e8e8",
								fontSize: 11,
								padding: "4px 6px",
								outline: "none",
							}}
							value={alphaFromBound(style.fill)}
							onChange={(e) =>
								onChange({
									...style,
									fill: colorToBound(
										colorFromBound(style.fill),
										parseFloat(e.target.value) || 0,
									),
								})
							}
							title="Opacity"
						/>
					</div>
				)}
			</div>

			<SectionLabel>Stroke</SectionLabel>
			<div className="flex items-center gap-2">
				<input
					type="checkbox"
					id="stroke-toggle"
					checked={style.stroke !== null}
					onChange={(e) =>
						onChange({
							...style,
							stroke: e.target.checked ? colorToBound("#ffffff", 1) : null,
						})
					}
				/>
				<label
					htmlFor="stroke-toggle"
					className="text-xs cursor-pointer"
					style={{ color: "#a0a0a0" }}
				>
					Enable stroke
				</label>
				{style.stroke && (
					<div className="flex items-center gap-2 ml-auto">
						<input
							type="color"
							className="w-7 h-7 rounded-md cursor-pointer"
							value={colorFromBound(style.stroke)}
							onChange={(e) =>
								onChange({
									...style,
									stroke: colorToBound(
										e.target.value,
										alphaFromBound(style.stroke),
									),
								})
							}
						/>
						<input
							type="number"
							min={0}
							max={1}
							step={0.05}
							className="w-16 text-center"
							style={{
								background: "#0f0f0f",
								border: "1px solid #181818",
								borderRadius: 6,
								color: "#e8e8e8",
								fontSize: 11,
								padding: "4px 6px",
								outline: "none",
							}}
							value={alphaFromBound(style.stroke)}
							onChange={(e) =>
								onChange({
									...style,
									stroke: colorToBound(
										colorFromBound(style.stroke),
										parseFloat(e.target.value) || 0,
									),
								})
							}
							title="Opacity"
						/>
					</div>
				)}
			</div>

			{style.stroke && (
				<FieldRow label="Width">
					<input
						type="number"
						min={0}
						step={0.5}
						className={inputCls}
						value={style.stroke_width}
						onChange={(e) =>
							onChange({
								...style,
								stroke_width: parseFloat(e.target.value) || 1,
							})
						}
					/>
				</FieldRow>
			)}

			<SectionLabel>Line</SectionLabel>
			<FieldRow label="Cap">
				<Dropdown
					value={style.line_cap}
					onChange={(v) => onChange({ ...style, line_cap: v as LineCap })}
					options={[
						{ value: "Butt", label: "Butt" },
						{ value: "Round", label: "Round" },
						{ value: "Square", label: "Square" },
					]}
				/>
			</FieldRow>
			<FieldRow label="Join">
				<Dropdown
					value={style.line_join}
					onChange={(v) => onChange({ ...style, line_join: v as LineJoin })}
					options={[
						{ value: "Miter", label: "Miter" },
						{ value: "Round", label: "Round" },
						{ value: "Bevel", label: "Bevel" },
					]}
				/>
			</FieldRow>
		</div>
	);
}

// ── Geometry fields ────────────────────────────────────────────────

function GeometryFields({
	kind,
	onChange,
	vars,
}: {
	kind: ElementKind;
	onChange: (k: ElementKind) => void;
	vars: VarEntry[];
}) {
	const F = (label: string, value: BoundValue, key: string) => (
		<BoundValueField
			key={key}
			label={label}
			value={value}
			vars={vars}
			onChange={(v) => onChange({ ...kind, [key]: v } as ElementKind)}
		/>
	);

	switch (kind.type) {
		case "Rect":
			return (
				<div className="space-y-2">
					{F("X", kind.x, "x")}
					{F("Y", kind.y, "y")}
					{F("W", kind.w, "w")}
					{F("H", kind.h, "h")}
				</div>
			);
		case "Circle":
			return (
				<div className="space-y-2">
					{F("CX", kind.cx, "cx")}
					{F("CY", kind.cy, "cy")}
					{F("R", kind.r, "r")}
				</div>
			);
		case "Arc":
			return (
				<div className="space-y-2">
					{F("CX", kind.cx, "cx")}
					{F("CY", kind.cy, "cy")}
					{F("R", kind.r, "r")}
					{F("A0", kind.a0, "a0")}
					{F("A1", kind.a1, "a1")}
					<FieldRow label="Dir">
						<Dropdown
							value={kind.dir}
							onChange={(v) => onChange({ ...kind, dir: v as "Cw" | "Ccw" })}
							options={[
								{ value: "Cw", label: "Clockwise" },
								{ value: "Ccw", label: "Counter-clockwise" },
							]}
						/>
					</FieldRow>
				</div>
			);
		case "Line":
			return (
				<div className="space-y-2">
					{F("X1", kind.x1, "x1")}
					{F("Y1", kind.y1, "y1")}
					{F("X2", kind.x2, "x2")}
					{F("Y2", kind.y2, "y2")}
				</div>
			);
		case "Text":
			return (
				<div className="space-y-2">
					{F("X", kind.x, "x")}
					{F("Y", kind.y, "y")}
					{F("Size", kind.font_size, "font_size")}
					<BoundValueField
						label="Text"
						value={kind.content}
						vars={vars}
						onChange={(v) => onChange({ ...kind, content: v })}
					/>
					<FieldRow label="Font">
						<input
							className={inputCls}
							value={kind.font}
							onChange={(e) => onChange({ ...kind, font: e.target.value })}
						/>
					</FieldRow>
				</div>
			);
		case "Path":
			return (
				<div className="text-xs italic py-2" style={{ color: "#737373" }}>
					Path ({kind.commands.length} commands) — edit via code
				</div>
			);
		case "Group": {
			const clip = kind.clip_modifier ?? null;
			const arr = kind.array_modifier ?? null;
			const arrType: "None" | "Linear" | "Radial" =
				arr === null ? "None" : arr.type;

			const defaultClip = (): ClipModifier => ({
				x: { type: "Literal", value: 0 },
				y: { type: "Literal", value: 0 },
				w: { type: "Literal", value: 100 },
				h: { type: "Literal", value: 100 },
			});
			const defaultLinear = (): ArrayModifier => ({
				type: "Linear",
				count: 3,
				offset_x: { type: "Literal", value: 50 },
				offset_y: { type: "Literal", value: 0 },
			});
			const defaultRadial = (): ArrayModifier => ({
				type: "Radial",
				count: 6,
				cx: { type: "Literal", value: 250 },
				cy: { type: "Literal", value: 250 },
				start_angle: { type: "Literal", value: 0 },
				arc_angle: { type: "Literal", value: 360 },
			});

			const setArrayType = (t: "None" | "Linear" | "Radial") => {
				if (t === "None") onChange({ ...kind, array_modifier: null });
				else if (t === "Linear")
					onChange({ ...kind, array_modifier: defaultLinear() });
				else onChange({ ...kind, array_modifier: defaultRadial() });
			};

			return (
				<div className="space-y-3">
					<div className="text-xs italic" style={{ color: "#737373" }}>
						{kind.children.length} children
					</div>

					<SectionLabel>Transform</SectionLabel>
					<div className="space-y-2">
						<BoundValueField
							label="TX"
							value={kind.translate_x ?? { type: "Literal", value: 0 }}
							vars={vars}
							onChange={(v) => onChange({ ...kind, translate_x: v })}
						/>
						<BoundValueField
							label="TY"
							value={kind.translate_y ?? { type: "Literal", value: 0 }}
							vars={vars}
							onChange={(v) => onChange({ ...kind, translate_y: v })}
						/>
						<BoundValueField
							label="Rot"
							value={kind.rotate ?? { type: "Literal", value: 0 }}
							vars={vars}
							onChange={(v) => onChange({ ...kind, rotate: v })}
						/>
						<BoundValueField
							label="SX"
							value={kind.scale_x ?? { type: "Literal", value: 1 }}
							vars={vars}
							onChange={(v) => onChange({ ...kind, scale_x: v })}
						/>
						<BoundValueField
							label="SY"
							value={kind.scale_y ?? { type: "Literal", value: 1 }}
							vars={vars}
							onChange={(v) => onChange({ ...kind, scale_y: v })}
						/>
					</div>
					<SectionLabel>Alpha</SectionLabel>
					<BoundValueField
						label="Opacity"
						value={kind.opacity ?? { type: "Literal", value: 1 }}
						vars={vars}
						onChange={(v) => onChange({ ...kind, opacity: v })}
					/>

					{/* ── Modifiers ── */}
					<SectionLabel>Modifiers</SectionLabel>

					{/* Clip */}
					<div
						className="rounded-lg p-2.5 space-y-2"
						style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}
					>
						<div className="flex items-center gap-2">
							<input
								type="checkbox"
								id="clip-mod-toggle"
								checked={clip !== null}
								onChange={(e) =>
									onChange({
										...kind,
										clip_modifier: e.target.checked ? defaultClip() : null,
									})
								}
							/>
							<label
								htmlFor="clip-mod-toggle"
								className="text-xs font-medium cursor-pointer"
								style={{ color: clip ? "#ef4444" : "#737373" }}
							>
								✂ Clip / Scissor
							</label>
						</div>
						{clip && (
							<div className="space-y-1.5 pl-2">
								<BoundValueField
									label="X"
									value={clip.x}
									vars={vars}
									onChange={(v) =>
										onChange({ ...kind, clip_modifier: { ...clip, x: v } })
									}
								/>
								<BoundValueField
									label="Y"
									value={clip.y}
									vars={vars}
									onChange={(v) =>
										onChange({ ...kind, clip_modifier: { ...clip, y: v } })
									}
								/>
								<BoundValueField
									label="W"
									value={clip.w}
									vars={vars}
									onChange={(v) =>
										onChange({ ...kind, clip_modifier: { ...clip, w: v } })
									}
								/>
								<BoundValueField
									label="H"
									value={clip.h}
									vars={vars}
									onChange={(v) =>
										onChange({ ...kind, clip_modifier: { ...clip, h: v } })
									}
								/>
							</div>
						)}
					</div>

					{/* Array */}
					<div
						className="rounded-lg p-2.5 space-y-2"
						style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}
					>
						<div className="flex items-center gap-2">
							<span
								className="text-xs font-medium shrink-0"
								style={{ color: arrType !== "None" ? "#14b8a6" : "#737373" }}
							>
								⊞ Array
							</span>
							<div className="flex-1">
								<Dropdown
									value={arrType}
									onChange={(v) =>
										setArrayType(v as "None" | "Linear" | "Radial")
									}
									options={[
										{ value: "None", label: "None" },
										{ value: "Linear", label: "Linear" },
										{ value: "Radial", label: "Radial" },
									]}
								/>
							</div>
						</div>
						{arr?.type === "Linear" && (
							<div className="space-y-1.5 pl-2">
								<FieldRow label="Count">
									<input
										type="number"
										min={1}
										step={1}
										className={inputCls}
										value={arr.count}
										onChange={(e) =>
											onChange({
												...kind,
												array_modifier: {
													...arr,
													count: Math.max(1, parseInt(e.target.value) || 1),
												},
											})
										}
									/>
								</FieldRow>
								<BoundValueField
									label="ΔX"
									value={arr.offset_x}
									vars={vars}
									onChange={(v) =>
										onChange({
											...kind,
											array_modifier: { ...arr, offset_x: v },
										})
									}
								/>
								<BoundValueField
									label="ΔY"
									value={arr.offset_y}
									vars={vars}
									onChange={(v) =>
										onChange({
											...kind,
											array_modifier: { ...arr, offset_y: v },
										})
									}
								/>
							</div>
						)}
						{arr?.type === "Radial" && (
							<div className="space-y-1.5 pl-2">
								<FieldRow label="Count">
									<input
										type="number"
										min={1}
										step={1}
										className={inputCls}
										value={arr.count}
										onChange={(e) =>
											onChange({
												...kind,
												array_modifier: {
													...arr,
													count: Math.max(1, parseInt(e.target.value) || 1),
												},
											})
										}
									/>
								</FieldRow>
								<BoundValueField
									label="CX"
									value={arr.cx}
									vars={vars}
									onChange={(v) =>
										onChange({ ...kind, array_modifier: { ...arr, cx: v } })
									}
								/>
								<BoundValueField
									label="CY"
									value={arr.cy}
									vars={vars}
									onChange={(v) =>
										onChange({ ...kind, array_modifier: { ...arr, cy: v } })
									}
								/>
								<BoundValueField
									label="Start"
									value={arr.start_angle}
									vars={vars}
									onChange={(v) =>
										onChange({
											...kind,
											array_modifier: { ...arr, start_angle: v },
										})
									}
								/>
								<BoundValueField
									label="Arc"
									value={arr.arc_angle}
									vars={vars}
									onChange={(v) =>
										onChange({
											...kind,
											array_modifier: { ...arr, arc_angle: v },
										})
									}
								/>
							</div>
						)}
					</div>
				</div>
			);
		}
	}
}

// ── Binding fields ─────────────────────────────────────────────────

function BindingFields({
	kind,
	onChange,
	vars,
}: {
	kind: ElementKind;
	onChange: (k: ElementKind) => void;
	vars: VarEntry[];
}) {
	const fields: { label: string; key: string; value: BoundValue }[] = [];
	const collect = (label: string, key: string, value: BoundValue) =>
		fields.push({ label, key, value });

	switch (kind.type) {
		case "Rect":
			collect("X", "x", kind.x);
			collect("Y", "y", kind.y);
			collect("Width", "w", kind.w);
			collect("Height", "h", kind.h);
			break;
		case "Circle":
			collect("Center X", "cx", kind.cx);
			collect("Center Y", "cy", kind.cy);
			collect("Radius", "r", kind.r);
			break;
		case "Arc":
			collect("Center X", "cx", kind.cx);
			collect("Center Y", "cy", kind.cy);
			collect("Radius", "r", kind.r);
			collect("Start°", "a0", kind.a0);
			collect("End°", "a1", kind.a1);
			break;
		case "Line":
			collect("X1", "x1", kind.x1);
			collect("Y1", "y1", kind.y1);
			collect("X2", "x2", kind.x2);
			collect("Y2", "y2", kind.y2);
			break;
		case "Text":
			collect("X", "x", kind.x);
			collect("Y", "y", kind.y);
			collect("Content", "content", kind.content);
			collect("Font Size", "font_size", kind.font_size);
			break;
		case "Group":
			if (kind.translate_x)
				collect("Translate X", "translate_x", kind.translate_x);
			if (kind.translate_y)
				collect("Translate Y", "translate_y", kind.translate_y);
			if (kind.rotate) collect("Rotate", "rotate", kind.rotate);
			if (kind.scale_x) collect("Scale X", "scale_x", kind.scale_x);
			if (kind.scale_y) collect("Scale Y", "scale_y", kind.scale_y);
			if (kind.opacity) collect("Opacity", "opacity", kind.opacity);
			break;
	}

	if (kind.type === "Group") {
		const clip = kind.clip_modifier ?? null;
		const arr = kind.array_modifier ?? null;
		const extraFields: ReactElement[] = [];
		if (clip) {
			extraFields.push(
				<BoundValueField
					key="clip_x"
					label="Clip X"
					value={clip.x}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, clip_modifier: { ...clip, x: v } })
					}
				/>,
				<BoundValueField
					key="clip_y"
					label="Clip Y"
					value={clip.y}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, clip_modifier: { ...clip, y: v } })
					}
				/>,
				<BoundValueField
					key="clip_w"
					label="Clip W"
					value={clip.w}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, clip_modifier: { ...clip, w: v } })
					}
				/>,
				<BoundValueField
					key="clip_h"
					label="Clip H"
					value={clip.h}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, clip_modifier: { ...clip, h: v } })
					}
				/>,
			);
		}
		if (arr?.type === "Linear") {
			extraFields.push(
				<BoundValueField
					key="arr_ox"
					label="Arr ΔX"
					value={arr.offset_x}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, array_modifier: { ...arr, offset_x: v } })
					}
				/>,
				<BoundValueField
					key="arr_oy"
					label="Arr ΔY"
					value={arr.offset_y}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, array_modifier: { ...arr, offset_y: v } })
					}
				/>,
			);
		} else if (arr?.type === "Radial") {
			extraFields.push(
				<BoundValueField
					key="arr_cx"
					label="Arr CX"
					value={arr.cx}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, array_modifier: { ...arr, cx: v } })
					}
				/>,
				<BoundValueField
					key="arr_cy"
					label="Arr CY"
					value={arr.cy}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, array_modifier: { ...arr, cy: v } })
					}
				/>,
				<BoundValueField
					key="arr_sa"
					label="Start°"
					value={arr.start_angle}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, array_modifier: { ...arr, start_angle: v } })
					}
				/>,
				<BoundValueField
					key="arr_aa"
					label="Arc°"
					value={arr.arc_angle}
					vars={vars}
					onChange={(v) =>
						onChange({ ...kind, array_modifier: { ...arr, arc_angle: v } })
					}
				/>,
			);
		}
		if (fields.length === 0 && extraFields.length === 0) {
			return (
				<div
					className="text-xs italic text-center py-6"
					style={{ color: "#454545" }}
				>
					No bindable properties for this type
				</div>
			);
		}
		if (extraFields.length > 0 || fields.length > 0) {
			return (
				<div className="space-y-4">
					<p className="text-xs leading-5" style={{ color: "#737373" }}>
						Switch any field to <span style={{ color: "#60a5fa" }}>LVar</span>,{" "}
						<span style={{ color: "#4ade80" }}>AVar</span>, or{" "}
						<span style={{ color: "#c084fc" }}>Expr</span> to drive it from sim
						data at runtime.
					</p>
					{fields.map((f) => (
						<div key={f.key}>
							<BoundValueField
								label={f.label}
								value={f.value}
								vars={vars}
								onChange={(v) =>
									onChange({ ...kind, [f.key]: v } as ElementKind)
								}
							/>
						</div>
					))}
					{extraFields}
					{vars.length === 0 && (
						<div
							className="text-xs rounded-lg px-3 py-2.5 mt-2"
							style={{
								background: "rgba(245,158,11,0.1)",
								color: "#fbbf24",
								border: "1px solid rgba(245,158,11,0.2)",
							}}
						>
							No variables yet. Add them in the Variables tab first.
						</div>
					)}
				</div>
			);
		}
	}

	if (fields.length === 0) {
		return (
			<div
				className="text-xs italic text-center py-6"
				style={{ color: "#454545" }}
			>
				No bindable properties for this type
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<p className="text-xs leading-5" style={{ color: "#737373" }}>
				Switch any field to <span style={{ color: "#60a5fa" }}>LVar</span>,{" "}
				<span style={{ color: "#4ade80" }}>AVar</span>, or{" "}
				<span style={{ color: "#c084fc" }}>Expr</span> to drive it from sim data
				at runtime.
			</p>
			{fields.map((f) => (
				<div key={f.key}>
					<BoundValueField
						label={f.label}
						value={f.value}
						vars={vars}
						onChange={(v) => onChange({ ...kind, [f.key]: v } as ElementKind)}
					/>
				</div>
			))}
			{vars.length === 0 && (
				<div
					className="text-xs rounded-lg px-3 py-2.5 mt-2"
					style={{
						background: "rgba(245,158,11,0.1)",
						color: "#fbbf24",
						border: "1px solid rgba(245,158,11,0.2)",
					}}
				>
					No variables yet. Add them in the Variables tab first.
				</div>
			)}
		</div>
	);
}

// ── Reference image panel ──────────────────────────────────────────

function RefImagePanel({ img }: { img: RefImageMeta }) {
	const updateImage = useRefImageStore((s) => s.updateImage);
	const deleteImage = useRefImageStore((s) => s.deleteImage);
	const setSelectedId = useSceneStore((s) => s.setSelectedId);
	const scene = useSceneStore((s) => s.scene);

	const htmlImg = refImageElements.get(img.id);

	const numberInput = (
		label: string,
		value: number,
		onCommit: (v: number) => void,
		step = 1,
	) => (
		<FieldRow label={label}>
			<input
				type="number"
				step={step}
				className={inputCls}
				value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
				onChange={(e) => {
					const v = parseFloat(e.target.value);
					if (!Number.isNaN(v)) onCommit(v);
				}}
			/>
		</FieldRow>
	);

	const resetSize = () => {
		if (!htmlImg) return;
		const nw = htmlImg.naturalWidth;
		const nh = htmlImg.naturalHeight;
		if (!nw || !nh) return;
		const scale = Math.min(scene.width / nw, scene.height / nh, 1);
		const w = nw * scale;
		const h = nh * scale;
		updateImage(img.id, {
			w,
			h,
			x: (scene.width - w) / 2,
			y: (scene.height - h) / 2,
		});
	};

	const replaceImage = async () => {
		try {
			const newId = await pickRefImageViaDialog();
			if (!newId) return;
			// Swap the new image's position with the current one, then remove the old
			const newMeta = useRefImageStore
				.getState()
				.images.find((i) => i.id === newId);
			if (newMeta) {
				useRefImageStore.getState().updateImage(newId, {
					name: newMeta.name,
					x: img.x,
					y: img.y,
					w: img.w,
					h: img.h,
					opacity: img.opacity,
					locked: img.locked,
					visible: img.visible,
				});
			}
			deleteImage(img.id);
			setSelectedId(newId);
		} catch (err) {
			console.error("Failed to replace reference image:", err);
		}
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2 mb-1">
				<span
					className="text-[10px] font-semibold uppercase tracking-widest"
					style={{ color: "#454545" }}
				>
					Reference
				</span>
				<span className="text-xs truncate flex-1" style={{ color: "#737373" }}>
					{img.name}
				</span>
			</div>

			{/* Thumbnail */}
			{htmlImg && (
				<div
					className="w-full rounded-md overflow-hidden flex items-center justify-center"
					style={{
						background: "#0a0a0a",
						border: "1px solid #181818",
						maxHeight: 160,
					}}
				>
					<img
						src={htmlImg.src}
						alt={img.name}
						style={{
							maxWidth: "100%",
							maxHeight: 160,
							objectFit: "contain",
							opacity: img.opacity,
						}}
					/>
				</div>
			)}

			{/* Opacity */}
			<SectionLabel>Opacity</SectionLabel>
			<div className="flex items-center gap-2">
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
					className="w-14 text-center text-[11px] font-mono"
					style={{
						background: "#0f0f0f",
						border: "1px solid #181818",
						borderRadius: 6,
						color: "#e8e8e8",
						padding: "4px 6px",
						outline: "none",
					}}
					value={Math.round(img.opacity * 100)}
					onChange={(e) =>
						updateImage(img.id, {
							opacity:
								Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) / 100,
						})
					}
				/>
			</div>

			{/* Transform */}
			<SectionLabel>Transform</SectionLabel>
			<div className="space-y-2">
				{numberInput("X", img.x, (v) => updateImage(img.id, { x: v }))}
				{numberInput("Y", img.y, (v) => updateImage(img.id, { y: v }))}
				{numberInput("W", img.w, (v) =>
					updateImage(img.id, { w: Math.max(1, v) }),
				)}
				{numberInput("H", img.h, (v) =>
					updateImage(img.id, { h: Math.max(1, v) }),
				)}
			</div>

			{/* Toggles */}
			<SectionLabel>State</SectionLabel>
			<div className="flex items-center gap-3">
				<label
					className="flex items-center gap-1.5 text-[11px] cursor-pointer"
					style={{ color: "#a0a0a0" }}
				>
					<input
						type="checkbox"
						checked={img.visible}
						onChange={(e) => updateImage(img.id, { visible: e.target.checked })}
					/>
					Visible
				</label>
				<label
					className="flex items-center gap-1.5 text-[11px] cursor-pointer"
					style={{ color: "#a0a0a0" }}
				>
					<input
						type="checkbox"
						checked={img.locked}
						onChange={(e) => updateImage(img.id, { locked: e.target.checked })}
					/>
					Locked
				</label>
			</div>

			{/* Actions */}
			<div className="pt-2 space-y-1.5">
				<button
					className="w-full text-[11px] font-medium py-1.5 rounded-md transition-colors"
					style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}
					onMouseEnter={(e) => {
						(e.currentTarget as HTMLElement).style.background =
							"rgba(245,158,11,0.2)";
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLElement).style.background =
							"rgba(245,158,11,0.1)";
					}}
					onClick={resetSize}
					disabled={!htmlImg}
				>
					Reset Size
				</button>
				<button
					className="w-full text-[11px] font-medium py-1.5 rounded-md transition-colors"
					style={{ background: "rgba(99,102,241,0.1)", color: "#6366f1" }}
					onMouseEnter={(e) => {
						(e.currentTarget as HTMLElement).style.background =
							"rgba(99,102,241,0.2)";
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLElement).style.background =
							"rgba(99,102,241,0.1)";
					}}
					onClick={replaceImage}
				>
					Replace Image…
				</button>
			</div>
		</div>
	);
}

// ── Inspector ──────────────────────────────────────────────────────

export default function Inspector() {
	const [tab, setTab] = useState<"geo" | "style" | "binding" | "vars">("geo");
	const selectedId = useSceneStore((s) => s.selectedId);
	const scene = useSceneStore((s) => s.scene);
	const vars = useSceneStore((s) => s.vars);
	const updateElement = useSceneStore((s) => s.updateElement);
	const refImages = useRefImageStore((s) => s.images);

	const refImg = refImages.find((i) => i.id === selectedId);
	const selected: SceneElement | undefined = refImg
		? undefined
		: scene.elements.find((e) => e.id === selectedId);

	const getStyle = (kind: ElementKind): NvgStyle | null => {
		if ("style" in kind) return (kind as any).style;
		return null;
	};

	const handleKindChange = (newKind: ElementKind) => {
		if (selected) updateElement(selected.id, newKind);
	};
	const handleStyleChange = (newStyle: NvgStyle) => {
		if (!selected) return;
		updateElement(selected.id, {
			...selected.kind,
			style: newStyle,
		} as ElementKind);
	};

	const tabs = [
		{ key: "geo" as const, label: "Geometry" },
		{ key: "style" as const, label: "Style" },
		{ key: "binding" as const, label: "Binding" },
		{ key: "vars" as const, label: "Variables" },
	];

	return (
		<div
			className="flex flex-col shrink-0"
			style={{
				width: 288,
				background: "#080808",
				borderLeft: "1px solid #111111",
			}}
		>
			{/* Tab bar */}
			<div
				className="flex shrink-0"
				style={{ height: 42, borderBottom: "1px solid #111111" }}
			>
				{tabs.map((t) => {
					const disabled = !!refImg && t.key !== "vars";
					return (
						<button
							key={t.key}
							className="flex-1 text-[10px] font-semibold uppercase tracking-wider transition-colors relative"
							style={{
								color: disabled
									? "#242424"
									: tab === t.key
										? "#6366f1"
										: "#454545",
								background: "transparent",
								cursor: disabled ? "not-allowed" : "pointer",
							}}
							disabled={disabled}
							onClick={() => setTab(t.key)}
						>
							{t.label}
							{tab === t.key && !disabled && (
								<span
									className="absolute bottom-0 left-0 right-0"
									style={{
										height: 2,
										background: "#6366f1",
										borderRadius: "2px 2px 0 0",
									}}
								/>
							)}
						</button>
					);
				})}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-4 py-3">
				{refImg && tab !== "vars" ? (
					<RefImagePanel img={refImg} />
				) : tab === "vars" ? (
					<VarPanel />
				) : !selected ? (
					<div className="flex flex-col items-center justify-center h-32 gap-2">
						<span style={{ fontSize: 28, opacity: 0.1 }}>◈</span>
						<span className="text-xs" style={{ color: "#454545" }}>
							Select an element to inspect
						</span>
					</div>
				) : tab === "geo" ? (
					<>
						<div className="flex items-center gap-2 mb-3">
							<span
								className="text-[10px] font-semibold uppercase tracking-widest"
								style={{ color: "#454545" }}
							>
								{selected.kind.type}
							</span>
							<span className="text-xs truncate" style={{ color: "#737373" }}>
								{selected.name}
							</span>
						</div>
						<GeometryFields
							kind={selected.kind}
							onChange={handleKindChange}
							vars={vars}
						/>
					</>
				) : tab === "style" ? (
					(() => {
						const style = getStyle(selected.kind);
						return style ? (
							<StyleEditor style={style} onChange={handleStyleChange} />
						) : (
							<div
								className="text-xs italic text-center py-6"
								style={{ color: "#454545" }}
							>
								No style properties for this element type
							</div>
						);
					})()
				) : (
					<>
						<div className="flex items-center gap-2 mb-3">
							<span
								className="text-[10px] font-semibold uppercase tracking-widest"
								style={{ color: "#454545" }}
							>
								Bindings
							</span>
							<span className="text-xs truncate" style={{ color: "#737373" }}>
								{selected.name}
							</span>
						</div>
						<BindingFields
							kind={selected.kind}
							onChange={handleKindChange}
							vars={vars}
						/>
					</>
				)}
			</div>
		</div>
	);
}

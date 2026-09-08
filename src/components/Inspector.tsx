import { useState, type ReactElement } from "react";
import {
	useSceneStore,
	type ArrayModifier,
	type BoundValue,
	type ClipModifier,
	type ElementKind,
	type LineCap,
	type LineJoin,
	type NvgStyle,
	type PathKind,
	type SceneElement,
	type TextAlignH,
	type TextAlignV,
	type VarEntry,
} from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import {
	useRefImageStore,
	refImageElements,
	type RefImageMeta,
} from "../store/refImageStore";
import { pickRefImageViaDialog } from "../store/refImageLoader";
import { flattenScene, varMapOf, type SceneNode } from "../canvas/geometry";
import { canConvertToPath, toPathKind } from "../canvas/convert";
import VarPanel from "./VarPanel";
import { Dropdown } from "./Dropdown";
import PathPanel from "./inspector/PathPanel";
import {
	BoundValueField,
	FieldRow,
	ScrubNumber,
	SectionLabel,
	Segmented,
	alphaFromBound,
	colorFromBound,
	colorToBound,
	inputCls,
} from "./inspector/fields";

// ── Style editor ───────────────────────────────────────────────────

const SWATCHES = [
	"#e8e8e8",
	"#000000",
	"#ef4444",
	"#f59e0b",
	"#22c55e",
	"#06b6d4",
	"#6366f1",
	"#ec4899",
];

function PaintRow({
	label,
	color,
	onChange,
	onToggle,
	id,
}: {
	label: string;
	color: NvgStyle["fill"];
	onChange: (c: NvgStyle["fill"]) => void;
	onToggle: (on: boolean) => void;
	id: string;
}) {
	return (
		<div className="space-y-1.5">
			<div className="flex items-center gap-2">
				<input
					type="checkbox"
					id={id}
					checked={color !== null}
					onChange={(e) => onToggle(e.target.checked)}
				/>
				<label
					htmlFor={id}
					className="text-xs cursor-pointer flex-1"
					style={{ color: "#a0a0a0" }}
				>
					{label}
				</label>
				{color && (
					<div className="flex items-center gap-2">
						<input
							type="color"
							className="w-7 h-7 rounded-md cursor-pointer"
							value={colorFromBound(color)}
							onChange={(e) =>
								onChange(colorToBound(e.target.value, alphaFromBound(color)))
							}
						/>
						<div style={{ width: 58 }}>
							<ScrubNumber
								value={Math.round(alphaFromBound(color) * 100)}
								min={0}
								max={100}
								onChange={(v) =>
									onChange(
										colorToBound(
											colorFromBound(color),
											Math.min(100, Math.max(0, v)) / 100,
										),
									)
								}
								suffix="%"
							/>
						</div>
					</div>
				)}
			</div>
			{color && (
				<div className="flex gap-1 pl-6">
					{SWATCHES.map((s) => (
						<button
							type="button"
							key={s}
							title={s}
							onClick={() => onChange(colorToBound(s, alphaFromBound(color)))}
							style={{
								width: 16,
								height: 16,
								borderRadius: 4,
								background: s,
								border: "1px solid #262626",
								cursor: "pointer",
							}}
						/>
					))}
				</div>
			)}
		</div>
	);
}

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
			<PaintRow
				id="fill-toggle"
				label="Enable fill"
				color={style.fill}
				onToggle={(on) =>
					onChange({ ...style, fill: on ? colorToBound("#cccccc", 1) : null })
				}
				onChange={(c) => onChange({ ...style, fill: c })}
			/>

			<SectionLabel>Stroke</SectionLabel>
			<PaintRow
				id="stroke-toggle"
				label="Enable stroke"
				color={style.stroke}
				onToggle={(on) =>
					onChange({ ...style, stroke: on ? colorToBound("#ffffff", 1) : null })
				}
				onChange={(c) => onChange({ ...style, stroke: c })}
			/>

			{style.stroke && (
				<FieldRow label="Width">
					<ScrubNumber
						value={style.stroke_width}
						step={0.5}
						min={0}
						onChange={(v) => onChange({ ...style, stroke_width: v })}
						suffix="px"
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
	id,
	kind,
	onChange,
	vars,
}: {
	id: string;
	kind: ElementKind;
	onChange: (k: ElementKind) => void;
	vars: VarEntry[];
}) {
	const F = (
		label: string,
		value: BoundValue,
		key: string,
		opts: { step?: number; suffix?: string } = {},
	) => (
		<BoundValueField
			key={key}
			label={label}
			value={value}
			vars={vars}
			step={opts.step}
			suffix={opts.suffix}
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
					{F("Radius", kind.radius, "radius")}
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
					{F("A0", kind.a0, "a0", { step: 0.05, suffix: "rad" })}
					{F("A1", kind.a1, "a1", { step: 0.05, suffix: "rad" })}
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
					<p className="text-[10px] leading-4" style={{ color: "#4a4a4a" }}>
						Angles are radians, measured from 3 o&apos;clock. Drag the two dots on
						canvas to sweep the arc.
					</p>
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
					{F("Size", kind.font_size, "font_size", { suffix: "px" })}

					<SectionLabel>Content</SectionLabel>
					<Segmented
						value={kind.text === null ? "bound" : "static"}
						options={[
							{ value: "static", label: "Static text" },
							{ value: "bound", label: "Sim value" },
						]}
						onChange={(v) =>
							onChange({ ...kind, text: v === "static" ? (kind.text ?? "Label") : null })
						}
					/>
					{kind.text !== null ? (
						<FieldRow label="Text">
							<input
								className={inputCls}
								value={kind.text}
								onChange={(e) => onChange({ ...kind, text: e.target.value })}
								placeholder="Label"
							/>
						</FieldRow>
					) : (
						<>
							<BoundValueField
								label="Value"
								value={kind.content}
								vars={vars}
								onChange={(v) => onChange({ ...kind, content: v })}
							/>
							<FieldRow label="Dec">
								<ScrubNumber
									value={kind.decimals}
									min={0}
									max={6}
									onChange={(v) =>
										onChange({ ...kind, decimals: Math.round(Math.max(0, v)) })
									}
								/>
							</FieldRow>
						</>
					)}

					<SectionLabel>Alignment</SectionLabel>
					<Segmented<TextAlignH>
						value={kind.align_h}
						options={[
							{ value: "Left", label: "◧", title: "Left" },
							{ value: "Center", label: "▣", title: "Centre" },
							{ value: "Right", label: "◨", title: "Right" },
						]}
						onChange={(v) => onChange({ ...kind, align_h: v })}
					/>
					<Segmented<TextAlignV>
						value={kind.align_v}
						options={[
							{ value: "Top", label: "Top" },
							{ value: "Middle", label: "Mid" },
							{ value: "Baseline", label: "Base" },
							{ value: "Bottom", label: "Bot" },
						]}
						onChange={(v) => onChange({ ...kind, align_v: v })}
					/>

					<SectionLabel>Font</SectionLabel>
					<FieldRow label="Face">
						<input
							className={inputCls}
							value={kind.font}
							onChange={(e) => onChange({ ...kind, font: e.target.value })}
						/>
					</FieldRow>
					<p className="text-[10px] leading-4" style={{ color: "#4a4a4a" }}>
						The generated gauge calls <code>ctx.font_face()</code> with this name —
						register it with <code>ctx.create_font()</code> in your init.
					</p>
				</div>
			);
		case "Path":
			return (
				<PathPanel
					id={id}
					kind={kind}
					vars={vars}
					onChange={(k) => onChange(k)}
				/>
			);
		case "Group": {
			const clip = kind.clip_modifier ?? null;
			const arr = kind.array_modifier ?? null;
			const arrType: "None" | "Linear" | "Radial" = arr === null ? "None" : arr.type;

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
						{F("TX", kind.translate_x, "translate_x")}
						{F("TY", kind.translate_y, "translate_y")}
						{F("Rot", kind.rotate, "rotate", { suffix: "°" })}
						{F("SX", kind.scale_x, "scale_x", { step: 0.05 })}
						{F("SY", kind.scale_y, "scale_y", { step: 0.05 })}
					</div>

					<SectionLabel>Pivot</SectionLabel>
					<div className="space-y-2">
						{F("PX", kind.pivot_x, "pivot_x")}
						{F("PY", kind.pivot_y, "pivot_y")}
					</div>
					<p className="text-[10px] leading-4" style={{ color: "#4a4a4a" }}>
						Rotation and scale happen about the pivot — put it on a needle&apos;s hub
						and bind <strong>Rot</strong> to a sim variable.
					</p>

					<SectionLabel>Alpha</SectionLabel>
					{F("Opacity", kind.opacity, "opacity", { step: 0.05 })}

					{/* ── Modifiers ── */}
					<SectionLabel>Modifiers</SectionLabel>

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
								{(["x", "y", "w", "h"] as const).map((f) => (
									<BoundValueField
										key={f}
										label={f.toUpperCase()}
										value={clip[f]}
										vars={vars}
										onChange={(v) =>
											onChange({ ...kind, clip_modifier: { ...clip, [f]: v } })
										}
									/>
								))}
							</div>
						)}
					</div>

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
									onChange={(v) => setArrayType(v as "None" | "Linear" | "Radial")}
									options={[
										{ value: "None", label: "None" },
										{ value: "Linear", label: "Linear" },
										{ value: "Radial", label: "Radial" },
									]}
								/>
							</div>
						</div>
						{arr && (
							<div className="space-y-1.5 pl-2">
								<FieldRow label="Count">
									<ScrubNumber
										value={arr.count}
										min={1}
										onChange={(v) =>
											onChange({
												...kind,
												array_modifier: { ...arr, count: Math.max(1, Math.round(v)) },
											})
										}
									/>
								</FieldRow>
								{arr.type === "Linear" ? (
									<>
										<BoundValueField
											label="ΔX"
											value={arr.offset_x}
											vars={vars}
											onChange={(v) =>
												onChange({ ...kind, array_modifier: { ...arr, offset_x: v } })
											}
										/>
										<BoundValueField
											label="ΔY"
											value={arr.offset_y}
											vars={vars}
											onChange={(v) =>
												onChange({ ...kind, array_modifier: { ...arr, offset_y: v } })
											}
										/>
									</>
								) : (
									<>
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
											suffix="°"
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
											suffix="°"
											onChange={(v) =>
												onChange({ ...kind, array_modifier: { ...arr, arc_angle: v } })
											}
										/>
									</>
								)}
							</div>
						)}
					</div>
				</div>
			);
		}
	}
}

// ── Binding tab ────────────────────────────────────────────────────

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
			collect("Radius", "radius", kind.radius);
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
			collect("Start", "a0", kind.a0);
			collect("End", "a1", kind.a1);
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
			collect("Translate X", "translate_x", kind.translate_x);
			collect("Translate Y", "translate_y", kind.translate_y);
			collect("Rotate", "rotate", kind.rotate);
			collect("Scale X", "scale_x", kind.scale_x);
			collect("Scale Y", "scale_y", kind.scale_y);
			collect("Opacity", "opacity", kind.opacity);
			break;
	}

	const extraFields: ReactElement[] = [];
	if (kind.type === "Group") {
		const clip = kind.clip_modifier ?? null;
		const arr = kind.array_modifier ?? null;
		if (clip) {
			for (const f of ["x", "y", "w", "h"] as const) {
				extraFields.push(
					<BoundValueField
						key={`clip_${f}`}
						label={`Clip ${f.toUpperCase()}`}
						value={clip[f]}
						vars={vars}
						onChange={(v) =>
							onChange({ ...kind, clip_modifier: { ...clip, [f]: v } })
						}
					/>,
				);
			}
		}
		if (arr?.type === "Linear") {
			for (const f of ["offset_x", "offset_y"] as const) {
				extraFields.push(
					<BoundValueField
						key={`arr_${f}`}
						label={f === "offset_x" ? "Arr ΔX" : "Arr ΔY"}
						value={arr[f]}
						vars={vars}
						onChange={(v) =>
							onChange({ ...kind, array_modifier: { ...arr, [f]: v } })
						}
					/>,
				);
			}
		} else if (arr?.type === "Radial") {
			for (const [f, label] of [
				["cx", "Arr CX"],
				["cy", "Arr CY"],
				["start_angle", "Start°"],
				["arc_angle", "Arc°"],
			] as const) {
				extraFields.push(
					<BoundValueField
						key={`arr_${f}`}
						label={label}
						value={arr[f]}
						vars={vars}
						onChange={(v) =>
							onChange({ ...kind, array_modifier: { ...arr, [f]: v } })
						}
					/>,
				);
			}
		}
	}

	if (kind.type === "Path") {
		return (
			<div className="text-xs leading-5" style={{ color: "#737373" }}>
				Path anchors are bound individually — select an anchor in the Geometry
				tab and switch its X or Y to a variable.
			</div>
		);
	}

	if (fields.length === 0 && extraFields.length === 0) {
		return (
			<div className="text-xs italic text-center py-6" style={{ color: "#454545" }}>
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
						labelWidth={64}
						onChange={(v) => onChange({ ...kind, [f.key]: v } as ElementKind)}
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

// ── Reference image panel ──────────────────────────────────────────

function RefImagePanel({ img }: { img: RefImageMeta }) {
	const updateImage = useRefImageStore((s) => s.updateImage);
	const deleteImage = useRefImageStore((s) => s.deleteImage);
	const scene = useSceneStore((s) => s.scene);
	const htmlImg = refImageElements.get(img.id);

	const num = (
		label: string,
		value: number,
		onCommit: (v: number) => void,
		step = 1,
	) => (
		<FieldRow label={label}>
			<ScrubNumber value={value} onChange={onCommit} step={step} />
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

	const fitToArtboard = () =>
		updateImage(img.id, { x: 0, y: 0, w: scene.width, h: scene.height });

	const replaceImage = async () => {
		try {
			const newId = await pickRefImageViaDialog();
			if (!newId) return;
			const newMeta = useRefImageStore.getState().images.find((i) => i.id === newId);
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
			useEditorStore.getState().setSelection([newId]);
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

			{htmlImg && (
				<div
					className="w-full rounded-md overflow-hidden flex items-center justify-center"
					style={{ background: "#0a0a0a", border: "1px solid #181818", maxHeight: 160 }}
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

			<SectionLabel>Opacity</SectionLabel>
			<div className="flex items-center gap-2">
				<input
					type="range"
					min={0}
					max={1}
					step={0.01}
					value={img.opacity}
					className="flex-1"
					onChange={(e) => updateImage(img.id, { opacity: parseFloat(e.target.value) })}
				/>
				<div style={{ width: 58 }}>
					<ScrubNumber
						value={Math.round(img.opacity * 100)}
						min={0}
						max={100}
						suffix="%"
						onChange={(v) =>
							updateImage(img.id, {
								opacity: Math.min(100, Math.max(0, v)) / 100,
							})
						}
					/>
				</div>
			</div>

			<SectionLabel>Transform</SectionLabel>
			<div className="space-y-2">
				{num("X", img.x, (v) => updateImage(img.id, { x: v }))}
				{num("Y", img.y, (v) => updateImage(img.id, { y: v }))}
				{num("W", img.w, (v) => updateImage(img.id, { w: Math.max(1, v) }))}
				{num("H", img.h, (v) => updateImage(img.id, { h: Math.max(1, v) }))}
			</div>

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

			<div className="pt-2 space-y-1.5">
				<button
					className="w-full text-[11px] font-medium py-1.5 rounded-md"
					style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", cursor: "pointer" }}
					onClick={resetSize}
					disabled={!htmlImg}
				>
					Reset to Natural Size
				</button>
				<button
					className="w-full text-[11px] font-medium py-1.5 rounded-md"
					style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", cursor: "pointer" }}
					onClick={fitToArtboard}
				>
					Fit to Artboard
				</button>
				<button
					className="w-full text-[11px] font-medium py-1.5 rounded-md"
					style={{ background: "rgba(99,102,241,0.1)", color: "#6366f1", cursor: "pointer" }}
					onClick={replaceImage}
				>
					Replace Image…
				</button>
			</div>
		</div>
	);
}

// ── Element header ─────────────────────────────────────────────────

function ElementHeader({ node }: { node: SceneNode }) {
	const renameElement = useSceneStore((s) => s.renameElement);
	const setElementVisible = useSceneStore((s) => s.setElementVisible);
	const setElementLocked = useSceneStore((s) => s.setElementLocked);
	const updateElement = useSceneStore((s) => s.updateElement);
	const vars = useSceneStore((s) => s.vars);
	const el = node.el;

	const convert = () => {
		const p = toPathKind(el.kind, varMapOf(vars));
		if (p) updateElement(el.id, p);
	};

	return (
		<div className="space-y-2 mb-2">
			<div className="flex items-center gap-1.5">
				<span
					className="text-[10px] font-semibold uppercase tracking-widest shrink-0"
					style={{ color: "#454545" }}
				>
					{el.kind.type}
				</span>
				<input
					value={el.name}
					onChange={(e) => renameElement(el.id, e.target.value)}
					className="flex-1 min-w-0 bg-transparent text-xs outline-none rounded px-1 py-0.5"
					style={{ color: "#c8c8c8", border: "1px solid transparent" }}
					onFocus={(e) => {
						e.currentTarget.style.borderColor = "#262626";
						e.currentTarget.style.background = "#0f0f0f";
					}}
					onBlur={(e) => {
						e.currentTarget.style.borderColor = "transparent";
						e.currentTarget.style.background = "transparent";
					}}
				/>
				<button
					type="button"
					title={el.visible ? "Hide" : "Show"}
					onClick={() => setElementVisible(el.id, !el.visible)}
					className="shrink-0 w-5 h-5 rounded text-[11px]"
					style={{ color: el.visible ? "#6a6a6a" : "#333", cursor: "pointer" }}
				>
					{el.visible ? "◉" : "○"}
				</button>
				<button
					type="button"
					title={el.locked ? "Unlock" : "Lock"}
					onClick={() => setElementLocked(el.id, !el.locked)}
					className="shrink-0 w-5 h-5 rounded text-[11px]"
					style={{ color: el.locked ? "#f59e0b" : "#333", cursor: "pointer" }}
				>
					{el.locked ? "🔒" : "🔓"}
				</button>
			</div>

			{node.sceneBBox && (
				<div
					className="flex items-center gap-3 text-[10px] font-mono px-1"
					style={{ color: "#3f3f3f" }}
				>
					<span>x {node.sceneBBox.x.toFixed(1)}</span>
					<span>y {node.sceneBBox.y.toFixed(1)}</span>
					<span>w {node.sceneBBox.w.toFixed(1)}</span>
					<span>h {node.sceneBBox.h.toFixed(1)}</span>
				</div>
			)}

			{canConvertToPath(el.kind) && (
				<button
					type="button"
					onClick={convert}
					className="w-full text-[11px] font-medium py-1 rounded-md"
					style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", cursor: "pointer" }}
					title="Replace this shape with an editable path"
				>
					✎ Convert to Path
				</button>
			)}
		</div>
	);
}

// ── Inspector ──────────────────────────────────────────────────────

export default function Inspector() {
	const [tab, setTab] = useState<"geo" | "style" | "binding" | "vars">("geo");
	const scene = useSceneStore((s) => s.scene);
	const vars = useSceneStore((s) => s.vars);
	const updateElement = useSceneStore((s) => s.updateElement);
	const updateElementLive = useSceneStore((s) => s.updateElementLive);
	const refImages = useRefImageStore((s) => s.images);
	const selection = useEditorStore((s) => s.selection);

	const flat = flattenScene(scene.elements, varMapOf(vars));
	const selectedNodes = selection
		.map((id) => flat.find((n) => n.el.id === id))
		.filter((n): n is SceneNode => !!n);
	const node = selectedNodes.length === 1 ? selectedNodes[0] : null;
	const selected: SceneElement | undefined = node?.el;
	const refImg = refImages.find((i) => selection.includes(i.id));

	const getStyle = (kind: ElementKind): NvgStyle | null =>
		"style" in kind ? (kind as { style: NvgStyle }).style : null;

	// Geometry edits stream through the coalescing command so scrubbing a
	// field is a single undo step rather than one per keystroke.
	const handleKindChange = (newKind: ElementKind) => {
		if (!selected) return;
		updateElementLive(selected.id, newKind, `geo:${selected.id}`);
	};
	const handleStyleChange = (newStyle: NvgStyle) => {
		if (!selected) return;
		updateElementLive(
			selected.id,
			{ ...selected.kind, style: newStyle } as ElementKind,
			`style:${selected.id}`,
		);
	};
	const handlePathChange = (k: PathKind) => {
		if (!selected) return;
		updateElement(selected.id, k);
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
			style={{ width: 300, background: "#080808", borderLeft: "1px solid #111111" }}
		>
			<div className="flex shrink-0" style={{ height: 42, borderBottom: "1px solid #111111" }}>
				{tabs.map((t) => {
					const disabled = !!refImg && t.key !== "vars";
					return (
						<button
							key={t.key}
							className="flex-1 text-[10px] font-semibold uppercase tracking-wider transition-colors relative"
							style={{
								color: disabled ? "#242424" : tab === t.key ? "#6366f1" : "#454545",
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
									style={{ height: 2, background: "#6366f1", borderRadius: "2px 2px 0 0" }}
								/>
							)}
						</button>
					);
				})}
			</div>

			<div className="flex-1 overflow-y-auto px-4 py-3">
				{refImg && tab !== "vars" ? (
					<RefImagePanel img={refImg} />
				) : tab === "vars" ? (
					<VarPanel />
				) : selectedNodes.length > 1 ? (
					<MultiSelectPanel nodes={selectedNodes} />
				) : !selected || !node ? (
					<div className="flex flex-col items-center justify-center h-40 gap-2 px-4 text-center">
						<span style={{ fontSize: 28, opacity: 0.1 }}>◈</span>
						<span className="text-xs" style={{ color: "#454545" }}>
							Select an element to inspect
						</span>
						<span className="text-[10px] leading-4 mt-2" style={{ color: "#2e2e2e" }}>
							V select · A anchors · P pen · R rect · O circle
							<br />
							C arc · L line · T text · H hand
						</span>
					</div>
				) : tab === "geo" ? (
					<>
						<ElementHeader node={node} />
						<GeometryFields
							id={selected.id}
							kind={selected.kind}
							onChange={
								selected.kind.type === "Path"
									? (k) => handlePathChange(k as PathKind)
									: handleKindChange
							}
							vars={vars}
						/>
					</>
				) : tab === "style" ? (
					<>
						<ElementHeader node={node} />
						{(() => {
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
						})()}
					</>
				) : (
					<>
						<ElementHeader node={node} />
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

// ── Multi-selection summary ────────────────────────────────────────

function MultiSelectPanel({ nodes }: { nodes: SceneNode[] }) {
	const kinds = new Map<string, number>();
	for (const n of nodes)
		kinds.set(n.el.kind.type, (kinds.get(n.el.kind.type) ?? 0) + 1);

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<span
					className="text-[10px] font-semibold uppercase tracking-widest"
					style={{ color: "#454545" }}
				>
					Selection
				</span>
				<span className="text-xs" style={{ color: "#737373" }}>
					{nodes.length} elements
				</span>
			</div>

			<div
				className="rounded-lg overflow-hidden"
				style={{ border: "1px solid #1a1a1a", background: "#0b0b0b" }}
			>
				{[...kinds.entries()].map(([k, count]) => (
					<div
						key={k}
						className="flex items-center justify-between px-3 py-1.5 text-[11px]"
						style={{ borderBottom: "1px solid #131313", color: "#8a8a8a" }}
					>
						<span>{k}</span>
						<span style={{ color: "#4a4a4a" }}>×{count}</span>
					</div>
				))}
			</div>

			<p className="text-[11px] leading-4" style={{ color: "#5a5a5a" }}>
				Use the align bar above the canvas to line these up, or{" "}
				<strong style={{ color: "#818cf8" }}>Ctrl+G</strong> to group them.
				Arrow keys nudge; hold Shift for a larger step.
			</p>
		</div>
	);
}

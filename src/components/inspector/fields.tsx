import { useEffect, useRef, useState } from "react";
import type {
	BoundColor,
	BoundValue,
	VarEntry,
} from "../../store/sceneStore";
import { Dropdown } from "../Dropdown";

// ─── Value helpers ─────────────────────────────────────────────────

export const bvNumber = (bv: BoundValue): number =>
	bv.type === "Literal" ? bv.value : 0;

export const lit = (v: number): BoundValue => ({ type: "Literal", value: v });

export function colorFromBound(c: BoundColor | null): string {
	if (!c) return "#000000";
	const [r, g, b] = c.Rgba;
	const h = (n: number) =>
		Math.round(Math.max(0, Math.min(1, n)) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}

export function colorToBound(hex: string, alpha: number): BoundColor {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	return { Rgba: [r, g, b, alpha] };
}

export const alphaFromBound = (c: BoundColor | null): number =>
	c ? c.Rgba[3] : 1;

export type BVMode = "Literal" | "LVar" | "AVar" | "Expr";

// ─── Styling ───────────────────────────────────────────────────────

export const inputCls =
	"bg-[#0f0f0f] border border-[#181818] rounded-md text-[#e8e8e8] text-xs px-2.5 py-1.5 outline-none focus:border-[#6366f1] transition-colors w-full";

export function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div
			className="text-[10px] font-semibold uppercase tracking-widest mt-3 mb-1.5"
			style={{ color: "#454545" }}
		>
			{children}
		</div>
	);
}

export function FieldRow({
	label,
	children,
	width = 34,
}: {
	label: string;
	children: React.ReactNode;
	width?: number;
}) {
	return (
		<div className="flex items-center gap-2">
			<span
				className="text-[11px] shrink-0 text-right"
				style={{ color: "#737373", width }}
			>
				{label}
			</span>
			<div className="flex-1 min-w-0">{children}</div>
		</div>
	);
}

/**
 * A number field you can also scrub by dragging the label — the fastest way to
 * dial in geometry without leaving the canvas.
 */
export function ScrubNumber({
	value,
	onChange,
	step = 1,
	min,
	max,
	suffix,
}: {
	value: number;
	onChange: (v: number) => void;
	step?: number;
	min?: number;
	max?: number;
	suffix?: string;
}) {
	const [text, setText] = useState<string | null>(null);
	const dragRef = useRef<{ x: number; v: number } | null>(null);

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			const d = dragRef.current;
			if (!d) return;
			const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
			let next = d.v + (e.clientX - d.x) * step * mult;
			if (min !== undefined) next = Math.max(min, next);
			if (max !== undefined) next = Math.min(max, next);
			onChange(Math.round(next * 1000) / 1000);
		};
		const onUp = () => {
			if (dragRef.current) {
				dragRef.current = null;
				document.body.style.cursor = "";
			}
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
		return () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
		};
	}, [onChange, step, min, max]);

	const display =
		text ?? (Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "0");

	return (
		<div className="relative flex items-center">
			<input
				className={inputCls}
				value={display}
				onChange={(e) => {
					setText(e.target.value);
					const v = parseFloat(e.target.value);
					if (!Number.isNaN(v)) onChange(v);
				}}
				onBlur={() => setText(null)}
				onKeyDown={(e) => {
					if (e.key === "Enter") (e.target as HTMLInputElement).blur();
					if (e.key === "ArrowUp" || e.key === "ArrowDown") {
						e.preventDefault();
						const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
						onChange(value + (e.key === "ArrowUp" ? 1 : -1) * step * mult);
						setText(null);
					}
				}}
			/>
			<span
				className="absolute right-1.5 text-[10px] select-none pointer-events-none"
				style={{ color: "#3a3a3a" }}
			>
				{suffix}
			</span>
			<div
				className="absolute left-0 top-0 bottom-0"
				style={{ width: 7, cursor: "ew-resize" }}
				title="Drag to scrub"
				onMouseDown={(e) => {
					e.preventDefault();
					dragRef.current = { x: e.clientX, v: value };
					document.body.style.cursor = "ew-resize";
				}}
			/>
		</div>
	);
}

// ─── Bound value editor ────────────────────────────────────────────

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

export function BoundValueField({
	label,
	value,
	onChange,
	vars,
	step = 1,
	suffix,
	labelWidth,
}: {
	label: string;
	value: BoundValue;
	onChange: (bv: BoundValue) => void;
	vars: VarEntry[];
	step?: number;
	suffix?: string;
	labelWidth?: number;
}) {
	const mode = value.type as BVMode;

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

	const opts = (kind: "LVar" | "AVar") =>
		vars
			.filter((v) => v.kind === kind)
			.map((v) => ({
				value: v.id,
				label: v.id + (v.sim_name ? ` (${v.sim_name})` : ""),
			}));

	return (
		<FieldRow label={label} width={labelWidth}>
			<div className="flex items-center gap-1.5">
				<Dropdown
					compact
					pillStyle={MODE_PILL[mode]}
					value={mode}
					onChange={(v) => setMode(v as BVMode)}
					options={MODE_OPTIONS}
				/>

				{mode === "Literal" && (
					<ScrubNumber
						value={value.type === "Literal" ? value.value : 0}
						onChange={(v) => onChange(lit(v))}
						step={step}
						suffix={suffix}
					/>
				)}
				{mode === "LVar" && (
					<Dropdown
						value={value.type === "LVar" ? value.name : ""}
						onChange={(v) => onChange({ type: "LVar", name: v })}
						options={opts("LVar")}
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
						options={opts("AVar")}
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

/** A row of small segmented buttons — used for alignment and enum pickers. */
export function Segmented<T extends string>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: { value: T; label: React.ReactNode; title?: string }[];
	onChange: (v: T) => void;
}) {
	return (
		<div
			className="flex rounded-md overflow-hidden"
			style={{ background: "#0f0f0f", border: "1px solid #181818" }}
		>
			{options.map((o) => (
				<button
					type="button"
					key={o.value}
					title={o.title}
					onClick={() => onChange(o.value)}
					className="flex-1 text-[11px] py-1 transition-colors"
					style={{
						background: value === o.value ? "#6366f1" : "transparent",
						color: value === o.value ? "#ffffff" : "#8a8a8a",
						cursor: "pointer",
					}}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

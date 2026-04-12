import { useState } from "react";
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
} from "../store/sceneStore";
import VarPanel from "./VarPanel";

// ─── Helpers ───────────────────────────────────────────────────────

function bvNumber(bv: BoundValue): number {
  return bv.type === "Literal" ? bv.value : 0;
}

function lit(v: number): BoundValue {
  return { type: "Literal", value: v };
}

function colorFromBound(c: BoundColor | null): string {
  if (!c) return "#000000";
  const [r, g, b] = c.Rgba;
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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

// ─── BoundValueField ───────────────────────────────────────────────

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

  const modeColors: Record<BVMode, string> = {
    Literal: "bg-gray-700 text-gray-300",
    LVar: "bg-blue-900/70 text-blue-300",
    AVar: "bg-green-900/70 text-green-300",
    Expr: "bg-purple-900/70 text-purple-300",
  };

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="w-8 text-right opacity-60 shrink-0">{label}</span>

        {/* Mode selector */}
        <select
          className={`text-[10px] px-1 py-0.5 rounded border-0 cursor-pointer font-bold ${modeColors[mode]}`}
          value={mode}
          onChange={(e) => setMode(e.target.value as BVMode)}
        >
          <option value="Literal">Val</option>
          <option value="LVar">LVar</option>
          <option value="AVar">AVar</option>
          <option value="Expr">Expr</option>
        </select>

        {/* Value input */}
        {mode === "Literal" && (
          <input
            type="number"
            className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 text-xs outline-none focus:border-[#e94560]"
            value={value.type === "Literal" ? value.value : 0}
            onChange={(e) => onChange(lit(parseFloat(e.target.value) || 0))}
          />
        )}

        {mode === "LVar" && (
          <select
            className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 text-xs outline-none"
            value={value.type === "LVar" ? value.name : ""}
            onChange={(e) =>
              onChange({ type: "LVar", name: e.target.value })
            }
          >
            <option value="">— select var —</option>
            {vars
              .filter((v) => v.kind === "LVar")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} ({v.sim_name || "unnamed"})
                </option>
              ))}
          </select>
        )}

        {mode === "AVar" && (
          <select
            className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 text-xs outline-none"
            value={value.type === "AVar" ? value.name : ""}
            onChange={(e) => {
              const picked = vars.find((v) => v.id === e.target.value);
              onChange({
                type: "AVar",
                name: e.target.value,
                unit: picked?.unit ?? "Number",
                index: picked?.index ?? 0,
              });
            }}
          >
            <option value="">— select var —</option>
            {vars
              .filter((v) => v.kind === "AVar")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} ({v.sim_name || "unnamed"})
                </option>
              ))}
          </select>
        )}

        {mode === "Expr" && (
          <input
            type="text"
            placeholder="RPN expression"
            className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 text-xs font-mono outline-none focus:border-[#e94560]"
            value={value.type === "Expr" ? value.expr : ""}
            onChange={(e) => onChange({ type: "Expr", expr: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}

// ─── Style editor ──────────────────────────────────────────────────

function StyleEditor({
  style,
  onChange,
}: {
  style: NvgStyle;
  onChange: (s: NvgStyle) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider opacity-60 mt-2">
        Style
      </div>
      {/* Fill */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={style.fill !== null}
          onChange={(e) =>
            onChange({
              ...style,
              fill: e.target.checked ? colorToBound("#cccccc", 1) : null,
            })
          }
        />
        <span className="w-10 opacity-60">Fill</span>
        {style.fill && (
          <>
            <input
              type="color"
              className="w-6 h-6 border-0 p-0 bg-transparent cursor-pointer"
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
              className="w-14 bg-black/30 border border-[#2a2a4a] rounded px-1 py-0.5 text-xs"
              value={alphaFromBound(style.fill)}
              onChange={(e) =>
                onChange({
                  ...style,
                  fill: colorToBound(
                    colorFromBound(style.fill),
                    parseFloat(e.target.value) || 1,
                  ),
                })
              }
            />
          </>
        )}
      </label>
      {/* Stroke */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={style.stroke !== null}
          onChange={(e) =>
            onChange({
              ...style,
              stroke: e.target.checked ? colorToBound("#ffffff", 1) : null,
            })
          }
        />
        <span className="w-10 opacity-60">Stroke</span>
        {style.stroke && (
          <>
            <input
              type="color"
              className="w-6 h-6 border-0 p-0 bg-transparent cursor-pointer"
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
              className="w-14 bg-black/30 border border-[#2a2a4a] rounded px-1 py-0.5 text-xs"
              value={alphaFromBound(style.stroke)}
              onChange={(e) =>
                onChange({
                  ...style,
                  stroke: colorToBound(
                    colorFromBound(style.stroke),
                    parseFloat(e.target.value) || 1,
                  ),
                })
              }
            />
          </>
        )}
      </label>
      {style.stroke && (
        <label className="flex items-center gap-2 text-xs">
          <span className="w-10 text-right opacity-60">Width</span>
          <input
            type="number"
            min={0}
            step={0.5}
            className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 text-xs outline-none"
            value={style.stroke_width}
            onChange={(e) =>
              onChange({
                ...style,
                stroke_width: parseFloat(e.target.value) || 1,
              })
            }
          />
        </label>
      )}
      {/* Line cap */}
      <label className="flex items-center gap-2 text-xs">
        <span className="w-12 text-right opacity-60">Cap</span>
        <select
          className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1 py-0.5 text-xs"
          value={style.line_cap}
          onChange={(e) =>
            onChange({ ...style, line_cap: e.target.value as LineCap })
          }
        >
          <option value="Butt">Butt</option>
          <option value="Round">Round</option>
          <option value="Square">Square</option>
        </select>
      </label>
      {/* Line join */}
      <label className="flex items-center gap-2 text-xs">
        <span className="w-12 text-right opacity-60">Join</span>
        <select
          className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1 py-0.5 text-xs"
          value={style.line_join}
          onChange={(e) =>
            onChange({ ...style, line_join: e.target.value as LineJoin })
          }
        >
          <option value="Miter">Miter</option>
          <option value="Round">Round</option>
          <option value="Bevel">Bevel</option>
        </select>
      </label>
    </div>
  );
}

// ─── Geometry editors per kind ─────────────────────────────────────

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
        <div className="space-y-1.5">
          {F("X", kind.x, "x")}
          {F("Y", kind.y, "y")}
          {F("W", kind.w, "w")}
          {F("H", kind.h, "h")}
        </div>
      );
    case "Circle":
      return (
        <div className="space-y-1.5">
          {F("CX", kind.cx, "cx")}
          {F("CY", kind.cy, "cy")}
          {F("R", kind.r, "r")}
        </div>
      );
    case "Arc":
      return (
        <div className="space-y-1.5">
          {F("CX", kind.cx, "cx")}
          {F("CY", kind.cy, "cy")}
          {F("R", kind.r, "r")}
          {F("A0", kind.a0, "a0")}
          {F("A1", kind.a1, "a1")}
          <label className="flex items-center gap-2 text-xs">
            <span className="w-8 text-right opacity-60">Dir</span>
            <select
              className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1 py-0.5 text-xs"
              value={kind.dir}
              onChange={(e) =>
                onChange({ ...kind, dir: e.target.value as "Cw" | "Ccw" })
              }
            >
              <option value="Cw">Clockwise</option>
              <option value="Ccw">Counter-clockwise</option>
            </select>
          </label>
        </div>
      );
    case "Line":
      return (
        <div className="space-y-1.5">
          {F("X1", kind.x1, "x1")}
          {F("Y1", kind.y1, "y1")}
          {F("X2", kind.x2, "x2")}
          {F("Y2", kind.y2, "y2")}
        </div>
      );
    case "Text":
      return (
        <div className="space-y-1.5">
          {F("X", kind.x, "x")}
          {F("Y", kind.y, "y")}
          {F("Size", kind.font_size, "font_size")}
          <BoundValueField
            label="Text"
            value={kind.content}
            vars={vars}
            onChange={(v) => onChange({ ...kind, content: v })}
          />
          <label className="flex items-center gap-2 text-xs">
            <span className="w-8 text-right opacity-60">Font</span>
            <input
              className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 text-xs outline-none"
              value={kind.font}
              onChange={(e) => onChange({ ...kind, font: e.target.value })}
            />
          </label>
        </div>
      );
    case "Path":
      return (
        <div className="text-xs opacity-50 italic">
          Path commands ({kind.commands.length} cmds) — edit via code
        </div>
      );
    case "Group":
      return (
        <div className="text-xs opacity-50 italic">
          Group: {kind.children.length} children
        </div>
      );
  }
}

// ─── Binding tab — shows all BoundValue fields focused on var wiring ─

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

  const collect = (label: string, key: string, value: BoundValue) => {
    fields.push({ label, key, value });
  };

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
      collect("Start Angle", "a0", kind.a0);
      collect("End Angle", "a1", kind.a1);
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
    case "Path":
      // Path commands have nested BoundValues — not editable here
      break;
    case "Group":
      // Groups have no direct BoundValues
      break;
  }

  if (fields.length === 0) {
    return (
      <div className="text-xs opacity-40 text-center mt-4">
        No bindable properties for this element type
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs opacity-50">
        Switch any field from a literal value to LVar, AVar, or Expr to drive it
        from sim data at runtime.
      </div>
      {fields.map((f) => (
        <div key={f.key} className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider opacity-40 pl-10">
            {f.label}
          </div>
          <BoundValueField
            label=""
            value={f.value}
            vars={vars}
            onChange={(v) =>
              onChange({ ...kind, [f.key]: v } as ElementKind)
            }
          />
        </div>
      ))}

      {vars.length === 0 && (
        <div className="text-xs text-amber-400/80 bg-amber-900/20 rounded p-2 mt-2">
          No variables registered yet. Go to the Variables tab to add LVars or
          AVars first, then come back here to bind them.
        </div>
      )}
    </div>
  );
}

// ─── Main Inspector ────────────────────────────────────────────────

export default function Inspector() {
  const [tab, setTab] = useState<"geo" | "style" | "binding" | "vars">("geo");
  const selectedId = useSceneStore((s) => s.selectedId);
  const scene = useSceneStore((s) => s.scene);
  const vars = useSceneStore((s) => s.vars);
  const updateElement = useSceneStore((s) => s.updateElement);

  const selected: SceneElement | undefined = scene.elements.find(
    (e) => e.id === selectedId,
  );

  const getStyle = (kind: ElementKind): NvgStyle | null => {
    if ("style" in kind) return (kind as any).style;
    return null;
  };

  const handleKindChange = (newKind: ElementKind) => {
    if (selected) updateElement(selected.id, newKind);
  };

  const handleStyleChange = (newStyle: NvgStyle) => {
    if (!selected) return;
    const kind = { ...selected.kind, style: newStyle } as ElementKind;
    updateElement(selected.id, kind);
  };

  const tabs = [
    { key: "geo" as const, label: "Geometry" },
    { key: "style" as const, label: "Style" },
    { key: "binding" as const, label: "Binding" },
    { key: "vars" as const, label: "Variables" },
  ];

  return (
    <div className="w-[280px] flex flex-col border-l border-[#2a2a4a] bg-[#16213e]">
      {/* Tab bar */}
      <div className="flex border-b border-[#2a2a4a]">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${
              tab === t.key
                ? "text-[#e94560] border-b-2 border-[#e94560]"
                : "opacity-50 hover:opacity-80"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === "vars" ? (
          <VarPanel />
        ) : !selected ? (
          <div className="text-xs opacity-40 text-center mt-8">
            Select an element to inspect
          </div>
        ) : tab === "geo" ? (
          <>
            <div className="text-xs font-semibold opacity-60">
              {selected.kind.type}: {selected.name}
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
              <div className="text-xs opacity-40 text-center mt-4">
                No style for this element type
              </div>
            );
          })()
        ) : (
          /* binding tab */
          <>
            <div className="text-xs font-semibold opacity-60">
              Bindings: {selected.name}
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

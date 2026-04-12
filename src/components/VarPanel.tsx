import { useState } from "react";
import {
  useSceneStore,
  type VarEntry,
  type VarKind,
  type RustVarType,
} from "../store/sceneStore";
import { Dropdown } from "./Dropdown";

const inputCls =
  "bg-[#0f0f0f] border border-[#181818] rounded-md text-[#e8e8e8] text-xs px-2.5 py-1.5 outline-none focus:border-[#6366f1] transition-colors w-full";

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] shrink-0 w-10 text-right" style={{ color: "#737373" }}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function VarRow({ v, onUpdate, onDelete }: { v: VarEntry; onUpdate: (entry: VarEntry) => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const isLVar = v.kind === "LVar";
  const badgeBg = isLVar ? "rgba(59,130,246,0.15)" : "rgba(34,197,94,0.15)";
  const badgeColor = isLVar ? "#60a5fa" : "#4ade80";

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "#0a0a0a", border: "1px solid #141414" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          className="font-mono text-xs font-semibold truncate flex-1 text-left transition-colors"
          style={{ color: expanded ? "#e8e8e8" : "#a0a0a0" }}
          onClick={() => setExpanded(!expanded)}
        >
          <span style={{ color: "#454545", marginRight: 6 }}>{expanded ? "▾" : "▸"}</span>
          {v.id}
        </button>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0" style={{ background: badgeBg, color: badgeColor }}>
          {v.kind}
        </span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded transition-colors shrink-0 text-xs"
          style={{ color: "#454545" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.15)"; (e.currentTarget as HTMLElement).style.color = "#ef4444"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "#454545"; }}
          onClick={onDelete}
          title="Delete variable"
        >
          ✕
        </button>
      </div>

      {!expanded && (
        <div className="px-3 pb-2">
          <span className="text-[11px] truncate block" style={{ color: "#454545" }}>
            {v.sim_name || "(no sim name set)"}
          </span>
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: "1px solid #111111" }}>
          <div className="pt-2 space-y-2">
            <FieldRow label="ID">
              <input className={inputCls} value={v.id} onChange={(e) => onUpdate({ ...v, id: e.target.value })} />
            </FieldRow>
            <FieldRow label="Kind">
              <Dropdown
                value={v.kind}
                onChange={(val) => onUpdate({
                  ...v,
                  kind: val as VarKind,
                  unit: val === "AVar" ? v.unit || "Number" : v.unit,
                  index: val === "AVar" ? v.index ?? 0 : v.index,
                })}
                options={[
                  { value: "LVar", label: "LVar" },
                  { value: "AVar", label: "AVar" },
                ]}
              />
            </FieldRow>
            <FieldRow label="Name">
              <input
                className={inputCls}
                value={v.sim_name}
                placeholder={v.kind === "LVar" ? "L:MY_LOCAL_VAR" : "INDICATED ALTITUDE"}
                onChange={(e) => onUpdate({ ...v, sim_name: e.target.value })}
              />
            </FieldRow>
            <FieldRow label="Unit">
              <input
                className={inputCls}
                value={v.unit ?? ""}
                placeholder="Number"
                onChange={(e) => onUpdate({ ...v, unit: e.target.value || null })}
              />
            </FieldRow>
            {v.kind === "AVar" && (
              <FieldRow label="Index">
                <input type="number" min={0} className={inputCls} value={v.index ?? 0}
                  onChange={(e) => onUpdate({ ...v, index: parseInt(e.target.value) || 0 })} />
              </FieldRow>
            )}
            <FieldRow label="Type">
              <Dropdown
                value={v.rust_type}
                onChange={(val) => onUpdate({ ...v, rust_type: val as RustVarType })}
                options={[
                  { value: "F64",  label: "f64"  },
                  { value: "Bool", label: "bool" },
                  { value: "I32",  label: "i32"  },
                ]}
              />
            </FieldRow>
          </div>
        </div>
      )}

      {/* Preview slider */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderTop: "1px solid #111111" }}>
        <span className="text-[10px] shrink-0 font-medium" style={{ color: "#454545" }}>Preview</span>
        <input
          type="range" min={-1000} max={1000} step={0.1}
          value={v.preview_value}
          className="flex-1"
          onChange={(e) => onUpdate({ ...v, preview_value: parseFloat(e.target.value) })}
        />
        <input
          type="number"
          className="w-16 text-right text-[11px] font-mono"
          style={{ background: "#0f0f0f", border: "1px solid #181818", borderRadius: 6, color: "#e8e8e8", padding: "2px 6px", outline: "none" }}
          value={v.preview_value}
          onChange={(e) => onUpdate({ ...v, preview_value: parseFloat(e.target.value) || 0 })}
        />
      </div>
    </div>
  );
}

export default function VarPanel() {
  const vars = useSceneStore((s) => s.vars);
  const addVar = useSceneStore((s) => s.addVar);
  const updateVar = useSceneStore((s) => s.updateVar);
  const deleteVar = useSceneStore((s) => s.deleteVar);

  const handleAddNew = () => {
    const idx = vars.length + 1;
    addVar({ id: `var_${idx}`, kind: "LVar", sim_name: "", unit: null, index: null, rust_type: "F64", preview_value: 0 });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#454545" }}>Variables</span>
        <button
          className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors"
          style={{ background: "rgba(99,102,241,0.15)", color: "#6366f1" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#6366f1"; (e.currentTarget as HTMLElement).style.color = "white"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.15)"; (e.currentTarget as HTMLElement).style.color = "#6366f1"; }}
          onClick={handleAddNew}
        >
          + Add
        </button>
      </div>

      {vars.map((v) => (
        <VarRow key={v.id} v={v} onUpdate={(entry) => updateVar(v.id, entry)} onDelete={() => deleteVar(v.id)} />
      ))}

      {vars.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span style={{ fontSize: 24, opacity: 0.1 }}>⚡</span>
          <span className="text-xs" style={{ color: "#454545" }}>
            No variables yet.
            <br />Add LVars or AVars to bind element properties to sim data.
          </span>
        </div>
      )}
    </div>
  );
}

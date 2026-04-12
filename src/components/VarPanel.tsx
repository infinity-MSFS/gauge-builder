import { useState } from "react";
import {
  useSceneStore,
  type VarEntry,
  type VarKind,
  type RustVarType,
} from "../store/sceneStore";

function VarRow({
  v,
  onUpdate,
  onDelete,
}: {
  v: VarEntry;
  onUpdate: (entry: VarEntry) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-[#2a2a4a] rounded p-2 space-y-1 text-xs">
      <div className="flex items-center justify-between">
        <button
          className="font-mono font-semibold hover:text-[#e94560] text-left truncate flex-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"} {v.id}
        </button>
        <div className="flex items-center gap-1">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              v.kind === "LVar"
                ? "bg-blue-900/50 text-blue-300"
                : "bg-green-900/50 text-green-300"
            }`}
          >
            {v.kind}
          </span>
          <button
            className="px-1.5 py-0.5 bg-red-900/50 hover:bg-red-900/80 rounded text-[10px]"
            onClick={onDelete}
          >
            ✕
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-1.5 pt-1">
          <label className="flex items-center gap-2">
            <span className="w-12 opacity-60 shrink-0">ID</span>
            <input
              className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 font-mono outline-none focus:border-[#e94560]"
              value={v.id}
              onChange={(e) => onUpdate({ ...v, id: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-12 opacity-60 shrink-0">Kind</span>
            <select
              className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5"
              value={v.kind}
              onChange={(e) =>
                onUpdate({
                  ...v,
                  kind: e.target.value as VarKind,
                  unit: e.target.value === "AVar" ? v.unit || "Number" : v.unit,
                  index: e.target.value === "AVar" ? v.index ?? 0 : v.index,
                })
              }
            >
              <option value="LVar">LVar</option>
              <option value="AVar">AVar</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-12 opacity-60 shrink-0">Name</span>
            <input
              className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 outline-none focus:border-[#e94560]"
              value={v.sim_name}
              placeholder={
                v.kind === "LVar" ? "L:MY_LOCAL_VAR" : "INDICATED ALTITUDE"
              }
              onChange={(e) => onUpdate({ ...v, sim_name: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-12 opacity-60 shrink-0">Unit</span>
            <input
              className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 outline-none focus:border-[#e94560]"
              value={v.unit ?? ""}
              placeholder="Number"
              onChange={(e) =>
                onUpdate({ ...v, unit: e.target.value || null })
              }
            />
          </label>
          {v.kind === "AVar" && (
            <label className="flex items-center gap-2">
              <span className="w-12 opacity-60 shrink-0">Index</span>
              <input
                type="number"
                min={0}
                className="w-20 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 outline-none"
                value={v.index ?? 0}
                onChange={(e) =>
                  onUpdate({ ...v, index: parseInt(e.target.value) || 0 })
                }
              />
            </label>
          )}
          <label className="flex items-center gap-2">
            <span className="w-12 opacity-60 shrink-0">Type</span>
            <select
              className="flex-1 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5"
              value={v.rust_type}
              onChange={(e) =>
                onUpdate({ ...v, rust_type: e.target.value as RustVarType })
              }
            >
              <option value="F64">f64</option>
              <option value="Bool">bool</option>
              <option value="I32">i32</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="opacity-50 truncate">{v.sim_name || "(no sim name)"}</div>
      )}

      {/* Preview slider always visible */}
      <label className="flex items-center gap-2">
        <span className="opacity-60">Preview:</span>
        <input
          type="range"
          min={-1000}
          max={1000}
          step={0.1}
          value={v.preview_value}
          onChange={(e) =>
            onUpdate({ ...v, preview_value: parseFloat(e.target.value) })
          }
          className="flex-1"
        />
        <input
          type="number"
          className="w-16 text-right font-mono bg-black/30 border border-[#2a2a4a] rounded px-1 py-0.5"
          value={v.preview_value}
          onChange={(e) =>
            onUpdate({
              ...v,
              preview_value: parseFloat(e.target.value) || 0,
            })
          }
        />
      </label>
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
    addVar({
      id: `var_${idx}`,
      kind: "LVar",
      sim_name: "",
      unit: null,
      index: null,
      rust_type: "F64",
      preview_value: 0,
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
          Variables
        </span>
        <button
          className="text-xs px-2 py-0.5 bg-[#e94560] rounded hover:bg-[#e94560]/80"
          onClick={handleAddNew}
        >
          + Add
        </button>
      </div>

      {vars.map((v) => (
        <VarRow
          key={v.id}
          v={v}
          onUpdate={(entry) => updateVar(v.id, entry)}
          onDelete={() => deleteVar(v.id)}
        />
      ))}

      {vars.length === 0 && (
        <div className="text-xs opacity-40 text-center mt-4">
          No variables registered. Add LVars or AVars to bind element properties
          to sim data.
        </div>
      )}
    </div>
  );
}

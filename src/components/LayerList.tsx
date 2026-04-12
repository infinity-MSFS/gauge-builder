import { useState, useRef } from "react";
import {
  useSceneStore,
  type SceneElement,
  type ElementKindTag,
} from "../store/sceneStore";

const KIND_ICONS: Record<string, string> = {
  Rect:   "▭",
  Circle: "○",
  Arc:    "◠",
  Line:   "─",
  Text:   "T",
  Path:   "✏",
  Group:  "⊞",
};

const KIND_COLORS: Record<string, string> = {
  Rect:   "#6366f1",
  Circle: "#22c55e",
  Arc:    "#f59e0b",
  Line:   "#06b6d4",
  Text:   "#ec4899",
  Path:   "#a78bfa",
  Group:  "#737373",
};

function LayerRow({
  el,
  selected,
  onSelect,
  onToggleVisible,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  el: SceneElement;
  selected: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onRename: (name: string) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const color = KIND_COLORS[el.kind.type] ?? "#737373";

  return (
    <div
      className="group flex items-center gap-2 px-3 cursor-pointer select-none transition-colors"
      style={{
        height: 38,
        background: selected ? "rgba(99,102,241,0.1)" : undefined,
        borderLeft: selected ? "2px solid #6366f1" : "2px solid transparent",
      }}
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = "";
      }}
    >
      {/* Visibility toggle */}
      <button
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-opacity"
        style={{ color: el.visible ? "#737373" : "#454545", fontSize: 12 }}
        onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
        title={el.visible ? "Hide" : "Show"}
      >
        {el.visible ? "◉" : "◎"}
      </button>

      {/* Kind badge */}
      <span
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[11px] font-bold"
        style={{ color, background: `${color}18` }}
        title={el.kind.type}
      >
        {KIND_ICONS[el.kind.type] ?? "?"}
      </span>

      {/* Name */}
      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 text-xs outline-none rounded px-1 py-0.5 min-w-0"
          style={{ background: "#1c1c1c", border: "1px solid #6366f1", color: "#e8e8e8" }}
          defaultValue={el.name}
          autoFocus
          onBlur={(e) => { setEditing(false); onRename(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { setEditing(false); onRename((e.target as HTMLInputElement).value); }
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="flex-1 text-xs truncate"
          style={{ color: selected ? "#e8e8e8" : "#a0a0a0" }}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title={`${el.name} (double-click to rename)`}
        >
          {el.name}
        </span>
      )}
    </div>
  );
}

export default function LayerList() {
  const scene = useSceneStore((s) => s.scene);
  const selectedId = useSceneStore((s) => s.selectedId);
  const setSelectedId = useSceneStore((s) => s.setSelectedId);
  const addElement = useSceneStore((s) => s.addElement);
  const deleteElement = useSceneStore((s) => s.deleteElement);
  const setElementVisible = useSceneStore((s) => s.setElementVisible);
  const renameElement = useSceneStore((s) => s.renameElement);
  const reorderElements = useSceneStore((s) => s.reorderElements);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const dragIdx = useRef<number | null>(null);

  const kinds: ElementKindTag[] = ["Rect", "Circle", "Arc", "Line", "Text", "Path", "Group"];

  const handleDrop = (targetIdx: number) => {
    if (dragIdx.current === null || dragIdx.current === targetIdx) return;
    const ids = scene.elements.map((e) => e.id);
    const [moved] = ids.splice(dragIdx.current, 1);
    ids.splice(targetIdx, 0, moved);
    reorderElements(ids);
    dragIdx.current = null;
  };

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: 220, background: "#080808", borderRight: "1px solid #111111" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 42, borderBottom: "1px solid #111111" }}
      >
        <span className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: "#454545" }}>
          Layers
        </span>

        <div className="relative">
          <button
            className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors"
            style={{ background: showAddMenu ? "#6366f1" : "rgba(99,102,241,0.15)", color: showAddMenu ? "white" : "#6366f1" }}
            onClick={() => setShowAddMenu(!showAddMenu)}
          >
            + Add
          </button>

          {showAddMenu && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
              <div
                className="absolute right-0 top-full mt-1.5 z-50 rounded-lg overflow-hidden py-1"
                style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", boxShadow: "0 8px 32px rgba(0,0,0,0.8)", minWidth: 140 }}
              >
                {kinds.map((k) => (
                  <button
                    key={k}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-xs transition-colors"
                    style={{ color: "#a0a0a0" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "#e8e8e8"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "#a0a0a0"; }}
                    onClick={() => { addElement(k); setShowAddMenu(false); }}
                  >
                    <span style={{ color: KIND_COLORS[k], width: 16, textAlign: "center" }}>
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

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto">
        {scene.elements.map((el, idx) => (
          <LayerRow
            key={el.id}
            el={el}
            selected={selectedId === el.id}
            onSelect={() => setSelectedId(el.id)}
            onToggleVisible={() => setElementVisible(el.id, !el.visible)}
            onRename={(name) => renameElement(el.id, name)}
            onDragStart={() => { dragIdx.current = idx; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(idx)}
          />
        ))}

        {scene.elements.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
            <span style={{ fontSize: 28, opacity: 0.15 }}>⊞</span>
            <span className="text-xs" style={{ color: "#454545" }}>
              No elements yet.
              <br />Click <strong style={{ color: "#6366f1" }}>+ Add</strong> to start.
            </span>
          </div>
        )}
      </div>

      {/* Delete button */}
      {selectedId && (
        <div className="px-3 py-2.5 shrink-0" style={{ borderTop: "1px solid #111111" }}>
          <button
            className="w-full text-xs py-1.5 rounded-md font-medium transition-colors"
            style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.2)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.1)"; }}
            onClick={() => deleteElement(selectedId)}
          >
            Delete Selected
          </button>
        </div>
      )}
    </div>
  );
}



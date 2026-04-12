import { useState, useRef } from "react";
import {
  useSceneStore,
  type SceneElement,
  type ElementKindTag,
} from "../store/sceneStore";

const KIND_ICONS: Record<string, string> = {
  Rect: "▭",
  Circle: "●",
  Arc: "◠",
  Line: "╱",
  Text: "T",
  Path: "✎",
  Group: "▤",
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

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 cursor-pointer select-none text-sm border-b border-[#2a2a4a] ${
        selected ? "bg-[#e94560]/20 text-white" : "hover:bg-white/5"
      }`}
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        className="w-5 text-xs opacity-60 hover:opacity-100 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisible();
        }}
        title={el.visible ? "Hide" : "Show"}
      >
        {el.visible ? "👁" : "—"}
      </button>
      <span className="w-5 text-center shrink-0 opacity-50 text-xs">
        {KIND_ICONS[el.kind.type] || "?"}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 bg-transparent border-b border-white/30 outline-none text-sm"
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
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="flex-1 truncate"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
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

  const kinds: ElementKindTag[] = [
    "Rect",
    "Circle",
    "Arc",
    "Line",
    "Text",
    "Path",
    "Group",
  ];

  const handleDrop = (targetIdx: number) => {
    if (dragIdx.current === null || dragIdx.current === targetIdx) return;
    const ids = scene.elements.map((e) => e.id);
    const [moved] = ids.splice(dragIdx.current, 1);
    ids.splice(targetIdx, 0, moved);
    reorderElements(ids);
    dragIdx.current = null;
  };

  return (
    <div className="w-[220px] flex flex-col border-r border-[#2a2a4a] bg-[#16213e]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a4a]">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
          Layers
        </span>
        <div className="relative">
          <button
            className="text-xs px-2 py-0.5 bg-[#e94560] rounded hover:bg-[#e94560]/80"
            onClick={() => setShowAddMenu(!showAddMenu)}
          >
            + Add
          </button>
          {showAddMenu && (
            <div className="absolute right-0 top-full mt-1 bg-[#1a1a2e] border border-[#2a2a4a] rounded shadow-lg z-50">
              {kinds.map((k) => (
                <button
                  key={k}
                  className="block w-full text-left px-3 py-1 text-sm hover:bg-white/10"
                  onClick={() => {
                    addElement(k);
                    setShowAddMenu(false);
                  }}
                >
                  {KIND_ICONS[k]} {k}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {scene.elements.map((el, idx) => (
          <LayerRow
            key={el.id}
            el={el}
            selected={selectedId === el.id}
            onSelect={() => setSelectedId(el.id)}
            onToggleVisible={() => setElementVisible(el.id, !el.visible)}
            onRename={(name) => renameElement(el.id, name)}
            onDragStart={() => {
              dragIdx.current = idx;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(idx)}
          />
        ))}
        {scene.elements.length === 0 && (
          <div className="p-4 text-center text-xs opacity-40">
            No elements. Click "+ Add" above.
          </div>
        )}
      </div>

      {selectedId && (
        <div className="p-2 border-t border-[#2a2a4a]">
          <button
            className="w-full text-xs py-1 bg-red-900/50 hover:bg-red-900/80 rounded"
            onClick={() => deleteElement(selectedId)}
          >
            Delete Selected
          </button>
        </div>
      )}
    </div>
  );
}

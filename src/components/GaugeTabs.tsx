import { useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Copy, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { useProjectStore, type GaugeEntry } from "../store/projectStore";
import { useSceneStore } from "../store/sceneStore";

/**
 * Tab bar across the gauges registered in the open project. Switching tabs
 * writes the gauge being left behind, so there is no unsaved state to lose;
 * the bar is hidden entirely while the editor is on a loose scene file.
 */
export default function GaugeTabs() {
  const project = useProjectStore((s) => s.project);
  const busy = useProjectStore((s) => s.busy);
  const error = useProjectStore((s) => s.error);
  const clearError = useProjectStore((s) => s.clearError);
  const selectGauge = useProjectStore((s) => s.selectGauge);
  const addGauge = useProjectStore((s) => s.addGauge);
  const duplicateGauge = useProjectStore((s) => s.duplicateGauge);
  const renameGauge = useProjectStore((s) => s.renameGauge);
  const reorderGauges = useProjectStore((s) => s.reorderGauges);
  const deleteGauge = useProjectStore((s) => s.deleteGauge);

  // The open gauge's name lives in the scene, so a rename in Gauge Settings
  // shows on its tab straight away rather than waiting for the next save.
  const liveName = useSceneStore((s) => s.scene.gauge_name);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  if (!project) return null;

  const { gauges, active } = project.manifest;
  const labelOf = (g: GaugeEntry) => (g.id === active ? liveName : g.name);

  const startRename = (g: GaugeEntry) => {
    setMenu(null);
    setDraft(labelOf(g));
    setRenaming(g.id);
  };

  const commitRename = (id: string) => {
    const name = draft.trim();
    setRenaming(null);
    const current = gauges.find((g) => g.id === id);
    if (name && current && name !== labelOf(current)) renameGauge(id, name);
  };

  const handleDelete = async (g: GaugeEntry) => {
    setMenu(null);
    const ok = await confirm(
      `Delete "${labelOf(g)}"? Its scene file ${g.file} is removed from the project folder.`,
      { title: "Delete gauge", kind: "warning" },
    );
    if (ok) deleteGauge(g.id);
  };

  /** Drop `dragId` where `targetId` sits and persist the new tab order. */
  const commitDrop = (targetId: string) => {
    const from = gauges.findIndex((g) => g.id === dragId);
    const to = gauges.findIndex((g) => g.id === targetId);
    setDragId(null);
    setDropId(null);
    if (from === -1 || to === -1 || from === to) return;
    const ids = gauges.map((g) => g.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    reorderGauges(ids);
  };

  return (
    <div
      className="flex items-center shrink-0 select-none"
      style={{
        height: 32,
        background: "#050505",
        borderBottom: "1px solid #111111",
      }}
    >
      {/* Project identity */}
      <div
        className="flex items-center gap-1.5 px-3 shrink-0"
        title={project.root}
        style={{ borderRight: "1px solid #111111", height: "100%" }}
      >
        <FolderOpen size={11} color="#6366f1" />
        <span className="text-[11px] font-medium" style={{ color: "#8a8a8a" }}>
          {project.manifest.name}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto">
        {gauges.map((g) => {
          const isActive = g.id === active;
          return (
            <div
              key={g.id}
              draggable={renaming !== g.id}
              onDragStart={() => setDragId(g.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragId && dragId !== g.id) setDropId(g.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                commitDrop(g.id);
              }}
              onMouseDown={(e) => {
                // Middle-click closes, matching every other tabbed editor.
                if (e.button === 1) {
                  e.preventDefault();
                  handleDelete(g);
                }
              }}
              onClick={() => selectGauge(g.id)}
              onDoubleClick={() => startRename(g)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: g.id, x: e.clientX, y: e.clientY });
              }}
              className="group flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
              title={`${g.file} — ${g.width}×${g.height}`}
              style={{
                height: "100%",
                padding: "0 8px 0 10px",
                background: isActive ? "#0d0d0d" : "transparent",
                borderRight: "1px solid #111111",
                borderLeft:
                  dropId === g.id ? "2px solid #6366f1" : "2px solid transparent",
                boxShadow: isActive ? "inset 0 -2px 0 #6366f1" : "none",
                opacity: dragId === g.id ? 0.4 : 1,
              }}
            >
              {renaming === g.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(g.id)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(g.id);
                    if (e.key === "Escape") setRenaming(null);
                    e.stopPropagation();
                  }}
                  className="bg-[#0a0a0a] border border-[#6366f1] rounded text-[11px] px-1 py-0.5 outline-none"
                  style={{ width: 110, color: "#e8e8e8" }}
                />
              ) : (
                <span
                  className="text-[11px] truncate"
                  style={{
                    maxWidth: 160,
                    color: isActive ? "#e8e8e8" : "#737373",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {labelOf(g)}
                </span>
              )}

              <button
                type="button"
                title="Delete gauge"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(g);
                }}
                className="rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[rgba(239,68,68,0.14)]"
                style={{ color: "#5a5a5a", lineHeight: 0 }}
              >
                <X size={10} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          title="New gauge in this project"
          onClick={() => addGauge()}
          className="shrink-0 px-2 transition-colors hover:bg-[rgba(255,255,255,0.06)]"
          style={{ height: "100%", color: "#5a5a5a", lineHeight: 0 }}
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 px-3 shrink-0">
        {busy && (
          <span className="text-[10px] animate-pulse" style={{ color: "#f59e0b" }}>
            Saving…
          </span>
        )}
        {error && (
          <button
            type="button"
            onClick={clearError}
            title={`${error} — click to dismiss`}
            className="text-[10px] truncate"
            style={{ color: "#f87171", maxWidth: 320, cursor: "pointer" }}
          >
            {error}
          </button>
        )}
      </div>

      {menu && (
        <TabMenu
          x={menu.x}
          y={menu.y}
          onRename={() => {
            const g = gauges.find((t) => t.id === menu.id);
            if (g) startRename(g);
          }}
          onDuplicate={() => {
            setMenu(null);
            duplicateGauge(menu.id);
          }}
          onDelete={() => {
            const g = gauges.find((t) => t.id === menu.id);
            if (g) handleDelete(g);
          }}
        />
      )}
    </div>
  );
}

function TabMenu({
  x,
  y,
  onRename,
  onDuplicate,
  onDelete,
}: {
  x: number;
  y: number;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const item =
    "flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] text-left transition-colors cursor-pointer";

  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-md overflow-hidden py-1"
      style={{
        left: x,
        top: y,
        width: 168,
        background: "#0d0d0d",
        border: "1px solid #1e1e1e",
        boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
      }}
    >
      <button
        type="button"
        className={`${item} text-[#a0a0a0] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#e8e8e8]`}
        onClick={onRename}
      >
        <Pencil size={11} /> Rename
      </button>
      <button
        type="button"
        className={`${item} text-[#a0a0a0] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#e8e8e8]`}
        onClick={onDuplicate}
      >
        <Copy size={11} /> Duplicate
      </button>
      <div style={{ height: 1, background: "#161616", margin: "4px 0" }} />
      <button
        type="button"
        className={`${item} text-[#a0a0a0] hover:bg-[rgba(239,68,68,0.1)] hover:text-[#ef4444]`}
        onClick={onDelete}
      >
        <Trash2 size={11} /> Delete gauge
      </button>
    </div>
  );
}

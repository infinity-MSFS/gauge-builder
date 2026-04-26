import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  save as dialogSave,
  open as dialogOpen,
} from "@tauri-apps/plugin-dialog";
import { useSceneStore } from "./store/sceneStore";
import Canvas from "./components/Canvas";
import LayerList from "./components/LayerList";
import Inspector from "./components/Inspector";
import BuildPanel from "./components/BuildPanel";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dark } from "react-syntax-highlighter/dist/esm/styles/prism";

// ── Shared primitives ──────────────────────────────────────────────

function Sep() {
  return <div className="w-px h-4 bg-[#262626] mx-1 shrink-0" />;
}

function ToolBtn({
  onClick,
  title,
  children,
  variant = "ghost",
}: {
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
  variant?: "ghost" | "primary" | "danger";
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer select-none";
  const sizes = {
    ghost: "px-2.5 py-1",
    primary: "px-3 py-1.5",
    danger: "px-2.5 py-1",
  };
  const styles = {
    ghost:
      "text-[#a0a0a0] hover:text-[#e8e8e8] hover:bg-[rgba(255,255,255,0.06)]",
    primary: "bg-[#6366f1] hover:bg-[#818cf8] text-white",
    danger:
      "text-[#a0a0a0] hover:text-[#ef4444] hover:bg-[rgba(239,68,68,0.1)]",
  };
  return (
    <button
      type="button"
      className={`${base} ${sizes[variant]} ${styles[variant]}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

// ── Window controls (min / max / close) ───────────────────────────

function WindowControls() {
  const win = getCurrentWindow();
  return (
    <div className="flex items-center shrink-0" style={{ gap: 1 }}>
      <button
        type="button"
        title="Minimize"
        onClick={() => win.minimize()}
        className="w-8 h-8 flex items-center justify-center text-[#737373] hover:text-[#e8e8e8] hover:bg-[rgba(255,255,255,0.06)] transition-colors rounded"
        style={{ fontSize: 14 }}
      >
        ─
      </button>
      <button
        type="button"
        title="Maximize / Restore"
        onClick={() => win.toggleMaximize()}
        className="w-8 h-8 flex items-center justify-center text-[#737373] hover:text-[#e8e8e8] hover:bg-[rgba(255,255,255,0.06)] transition-colors rounded"
        style={{ fontSize: 11 }}
      >
        ▭
      </button>
      <button
        type="button"
        title="Close"
        onClick={() => win.destroy()}
        className="w-8 h-8 flex items-center justify-center text-[#737373] hover:text-[#ef4444] hover:bg-[rgba(239,68,68,0.12)] transition-colors rounded"
        style={{ fontSize: 13 }}
      >
        ✕
      </button>
    </div>
  );
}

// ── Gauge settings popover ─────────────────────────────────────────

function GaugeSettingsPopover() {
  const scene = useSceneStore((s) => s.scene);
  const setGaugeMeta = useSceneStore((s) => s.setGaugeMeta);

  const [open, setOpen] = useState(false);
  const [gaugeName, setGaugeName] = useState(scene.gauge_name);
  const [width, setWidth] = useState(scene.width);
  const [height, setHeight] = useState(scene.height);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGaugeName(scene.gauge_name);
    setWidth(scene.width);
    setHeight(scene.height);
  }, [scene.gauge_name, scene.width, scene.height]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const apply = () => {
    setGaugeMeta(gaugeName, width, height);
    setOpen(false);
  };

  const inputCls =
    "bg-[#0a0a0a] border border-[#1e1e1e] rounded-md text-[#e8e8e8] text-xs px-2.5 py-1.5 outline-none focus:border-[#6366f1] transition-colors w-full";

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium px-2.5 py-1 transition-colors cursor-pointer select-none text-[#a0a0a0] hover:text-[#e8e8e8] hover:bg-[rgba(255,255,255,0.06)]"
        title="Gauge settings"
      >
        <span style={{ fontSize: 12 }}>⚙</span>
        <span>{scene.gauge_name || "gauge"}</span>
        <span className="text-[#444]">
          {scene.width}×{scene.height}
        </span>
      </button>

      {open && (
        <div
          className="absolute top-full mt-1 left-0 z-50 rounded-lg overflow-hidden"
          style={{
            width: 240,
            background: "#0d0d0d",
            border: "1px solid #1e1e1e",
            boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
          }}
        >
          <div
            className="px-3 py-2"
            style={{ borderBottom: "1px solid #161616" }}
          >
            <span className="text-[10px] font-semibold text-[#555] uppercase tracking-wider">
              Gauge Settings
            </span>
          </div>
          <div className="flex flex-col gap-3 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#737373]">Name</span>
              <input
                className={inputCls}
                value={gaugeName}
                onChange={(e) => setGaugeName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                placeholder="my_gauge"
                autoFocus
              />
            </label>
            <div className="flex gap-2">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-[11px] text-[#737373]">Width</span>
                <input
                  type="number"
                  className={inputCls}
                  value={width}
                  onChange={(e) => setWidth(parseFloat(e.target.value) || 512)}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-[11px] text-[#737373]">Height</span>
                <input
                  type="number"
                  className={inputCls}
                  value={height}
                  onChange={(e) => setHeight(parseFloat(e.target.value) || 512)}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={apply}
              className="w-full rounded-md text-xs font-medium py-1.5 transition-colors bg-[#6366f1] hover:bg-[#818cf8] text-white cursor-pointer"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Toolbar / Title bar ────────────────────────────────────────────

function Toolbar() {
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const saveScene = useSceneStore((s) => s.saveScene);
  const loadScene = useSceneStore((s) => s.loadScene);

  const handleSave = async () => {
    const path = await dialogSave({
      title: "Save scene",
      defaultPath: "scene.ron",
      filters: [{ name: "RON Scene", extensions: ["ron"] }],
    });
    if (path) await saveScene(path);
  };

  const handleLoad = async () => {
    const result = await dialogOpen({
      title: "Open scene",
      multiple: false,
      filters: [{ name: "RON Scene", extensions: ["ron"] }],
    });
    const path = Array.isArray(result) ? result[0] : result;
    if (path) await loadScene(path);
  };
  const fetchCodegenPreview = useSceneStore((s) => s.fetchCodegenPreview);
  const codegenPreview = useSceneStore((s) => s.codegenPreview);
  const [showCodePreview, setShowCodePreview] = useState(false);

  const handlePreviewCode = async () => {
    await fetchCodegenPreview();
    setShowCodePreview(true);
  };

  return (
    <>
      {/* The header is the Tauri drag region; interactive children must stop drag propagation */}
      <header
        data-tauri-drag-region
        className="flex items-center shrink-0 select-none"
        style={{
          height: 44,
          background: "#050505",
          borderBottom: "1px solid #111111",
        }}
      >
        {/* Left: brand + actions — stop drag so clicks work */}
        <div
          className="flex items-center gap-1 px-3"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="text-xs font-semibold text-[#6366f1] tracking-tight mr-1 select-none">
            Infinity Gauge Builder
          </span>

          <Sep />

          <GaugeSettingsPopover />

          <Sep />

          <ToolBtn onClick={undo} title="Undo (Ctrl+Z)">
            ↩ Undo
          </ToolBtn>
          <ToolBtn onClick={redo} title="Redo (Ctrl+Shift+Z)">
            ↪ Redo
          </ToolBtn>

          <Sep />

          <ToolBtn onClick={handleSave} title="Save scene">
            ↓ Save
          </ToolBtn>
          <ToolBtn onClick={handleLoad} title="Load scene">
            ↑ Load
          </ToolBtn>

          <Sep />

          <ToolBtn onClick={handlePreviewCode} variant="primary">
            ◈ Preview Code
          </ToolBtn>
        </div>

        {/* Spacer — drag region fills the middle */}
        <div
          className="flex-1"
          data-tauri-drag-region
          style={{ height: "100%" }}
        />

        {/* Right: window controls — stop drag so clicks work */}
        <div onMouseDown={(e) => e.stopPropagation()}>
          <WindowControls />
        </div>
      </header>

      {showCodePreview && codegenPreview && (
        <CodePreviewModal
          preview={codegenPreview}
          onClose={() => setShowCodePreview(false)}
        />
      )}
    </>
  );
}

// ── Code preview modal ─────────────────────────────────────────────

function CodePreviewModal({
  preview,
  onClose,
}: {
  preview: {
    gauge_rs: string;
    draw_rs: string;
    vars_rs: string;
    cargo_toml: string;
  };
  onClose: () => void;
}) {
  const [tab, setTab] = useState<
    "gauge_rs" | "draw_rs" | "vars_rs" | "cargo_toml"
  >("gauge_rs");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  const files = {
    gauge_rs: { label: "gauge.rs", content: preview.gauge_rs },
    draw_rs: { label: "draw.rs", content: preview.draw_rs },
    vars_rs: { label: "vars.rs", content: preview.vars_rs },
    cargo_toml: { label: "Cargo.toml", content: preview.cargo_toml },
  };

  useEffect(() => {
    setCopyState("idle");
  }, [tab]);

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState("error");
      return;
    }

    await navigator.clipboard.writeText(files[tab].content);
    setCopyState("copied");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-xl overflow-hidden"
        style={{
          width: "80vw",
          height: "78vh",
          background: "#080808",
          border: "1px solid #1a1a1a",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4"
          style={{
            height: 44,
            borderBottom: "1px solid #111111",
            background: "#050505",
          }}
        >
          <div className="flex gap-1">
            {(Object.keys(files) as (keyof typeof files)[]).map((key) => (
              <button
                key={key}
                style={{
                  padding: "3px 12px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: "monospace",
                  background: tab === key ? "#6366f1" : "transparent",
                  color: tab === key ? "white" : "#737373",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                className="hover:text-[#e8e8e8]"
                onClick={() => setTab(key)}
              >
                {files[key].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {copyState === "error" && (
              <span className="text-[11px] text-[#f87171]">
                Clipboard unavailable
              </span>
            )}
            <ToolBtn
              onClick={() => void handleCopy()}
              title={`Copy ${files[tab].label}`}
              variant={copyState === "copied" ? "primary" : "ghost"}
            >
              {copyState === "copied" ? "✓ Copied" : "⧉ Copy"}
            </ToolBtn>
            <button
              style={{
                color: "#737373",
                fontSize: 18,
                lineHeight: 1,
                cursor: "pointer",
                padding: "2px 6px",
              }}
              className="hover:text-[#ef4444] rounded transition-colors"
              onClick={onClose}
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Code */}
        <pre
          className="flex-1 overflow-auto font-mono leading-5"
          style={{
            padding: "16px 20px",
            fontSize: 12,
            color: "#a8ff78",
            background: "#000000",
          }}
        >
          <SyntaxHighlighter
            language={files[tab].label.endsWith(".toml") ? "toml" : "rust"}
            style={dark}
            customStyle={{
              background: "transparent",
              border: "none",
              padding: 0,
            }}
          >
            {files[tab].content}
          </SyntaxHighlighter>
        </pre>
      </div>
    </div>
  );
}

// ── App root ───────────────────────────────────────────────────────

export default function App() {
  const fetchScene = useSceneStore((s) => s.fetchScene);
  const fetchVars = useSceneStore((s) => s.fetchVars);

  useEffect(() => {
    fetchScene();
    fetchVars();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useSceneStore.getState().undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        useSceneStore.getState().redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex flex-col h-screen" style={{ background: "#000000" }}>
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <LayerList />
        <Canvas />
        <Inspector />
      </div>
      <BuildPanel />
    </div>
  );
}

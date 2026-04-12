import { useEffect, useState } from "react";
import { useSceneStore } from "./store/sceneStore";
import Canvas from "./components/Canvas";
import LayerList from "./components/LayerList";
import Inspector from "./components/Inspector";
import BuildPanel from "./components/BuildPanel";

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
  const base = "inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer select-none";
  const sizes = {
    ghost:   "px-2.5 py-1",
    primary: "px-3 py-1.5",
    danger:  "px-2.5 py-1",
  };
  const styles = {
    ghost:   "text-[#a0a0a0] hover:text-[#e8e8e8] hover:bg-[rgba(255,255,255,0.06)]",
    primary: "bg-[#6366f1] hover:bg-[#818cf8] text-white",
    danger:  "text-[#a0a0a0] hover:text-[#ef4444] hover:bg-[rgba(239,68,68,0.1)]",
  };
  return (
    <button className={`${base} ${sizes[variant]} ${styles[variant]}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

// ── Toolbar ────────────────────────────────────────────────────────

function Toolbar() {
  const scene = useSceneStore((s) => s.scene);
  const setGaugeMeta = useSceneStore((s) => s.setGaugeMeta);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const saveScene = useSceneStore((s) => s.saveScene);
  const loadScene = useSceneStore((s) => s.loadScene);
  const fetchCodegenPreview = useSceneStore((s) => s.fetchCodegenPreview);
  const codegenPreview = useSceneStore((s) => s.codegenPreview);

  const [gaugeName, setGaugeName] = useState(scene.gauge_name);
  const [width, setWidth] = useState(scene.width);
  const [height, setHeight] = useState(scene.height);
  const [showCodePreview, setShowCodePreview] = useState(false);

  useEffect(() => {
    setGaugeName(scene.gauge_name);
    setWidth(scene.width);
    setHeight(scene.height);
  }, [scene.gauge_name, scene.width, scene.height]);

  const applyMeta = () => setGaugeMeta(gaugeName, width, height);

  const handlePreviewCode = async () => {
    await fetchCodegenPreview();
    setShowCodePreview(true);
  };

  const inputCls =
    "bg-[#0f0f0f] border border-[#181818] rounded-md text-[#e8e8e8] text-xs px-2.5 py-1.5 outline-none focus:border-[#6366f1] transition-colors";

  return (
    <>
      <header
        className="flex items-center gap-1 px-3 shrink-0"
        style={{ height: 44, background: "#050505", borderBottom: "1px solid #111111" }}
      >
        {/* App brand */}
        <span className="text-xs font-semibold text-[#6366f1] tracking-tight mr-2 select-none">
          gauge-builder
        </span>

        <Sep />

        {/* Gauge meta */}
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#737373]">Name</span>
          <input
            className={`w-28 ${inputCls}`}
            value={gaugeName}
            onChange={(e) => setGaugeName(e.target.value)}
            onBlur={applyMeta}
            onKeyDown={(e) => e.key === "Enter" && applyMeta()}
            placeholder="my_gauge"
          />
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#737373]">W</span>
          <input
            type="number"
            className={`w-14 ${inputCls}`}
            value={width}
            onChange={(e) => setWidth(parseFloat(e.target.value) || 512)}
            onBlur={applyMeta}
            onKeyDown={(e) => e.key === "Enter" && applyMeta()}
          />
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#737373]">H</span>
          <input
            type="number"
            className={`w-14 ${inputCls}`}
            value={height}
            onChange={(e) => setHeight(parseFloat(e.target.value) || 512)}
            onBlur={applyMeta}
            onKeyDown={(e) => e.key === "Enter" && applyMeta()}
          />
        </label>

        <Sep />

        <ToolBtn onClick={undo} title="Undo (Ctrl+Z)">↩ Undo</ToolBtn>
        <ToolBtn onClick={redo} title="Redo (Ctrl+Shift+Z)">↪ Redo</ToolBtn>

        <Sep />

        <ToolBtn onClick={() => saveScene("./scene.ron")} title="Save scene">
          ↓ Save
        </ToolBtn>
        <ToolBtn onClick={() => loadScene("./scene.ron")} title="Load scene">
          ↑ Load
        </ToolBtn>

        <Sep />

        <ToolBtn onClick={handlePreviewCode} variant="primary">
          ◈ Preview Code
        </ToolBtn>
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
  preview: { gauge_rs: string; draw_rs: string; vars_rs: string; cargo_toml: string };
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"gauge_rs" | "draw_rs" | "vars_rs" | "cargo_toml">("gauge_rs");

  const files = {
    gauge_rs:  { label: "gauge.rs",   content: preview.gauge_rs },
    draw_rs:   { label: "draw.rs",    content: preview.draw_rs },
    vars_rs:   { label: "vars.rs",    content: preview.vars_rs },
    cargo_toml:{ label: "Cargo.toml", content: preview.cargo_toml },
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
          style={{ height: 44, borderBottom: "1px solid #111111", background: "#050505" }}
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
          <button
            style={{ color: "#737373", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "2px 6px" }}
            className="hover:text-[#ef4444] rounded transition-colors"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Code */}
        <pre
          className="flex-1 overflow-auto font-mono leading-5"
          style={{ padding: "16px 20px", fontSize: 12, color: "#a8ff78", background: "#000000" }}
        >
          {files[tab].content}
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

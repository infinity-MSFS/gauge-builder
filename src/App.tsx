import { useEffect, useState } from "react";
import { useSceneStore } from "./store/sceneStore";
import Canvas from "./components/Canvas";
import LayerList from "./components/LayerList";
import Inspector from "./components/Inspector";
import BuildPanel from "./components/BuildPanel";

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

  const applyMeta = () => {
    setGaugeMeta(gaugeName, width, height);
  };

  const handlePreviewCode = async () => {
    await fetchCodegenPreview();
    setShowCodePreview(true);
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#16213e] border-b border-[#2a2a4a] text-xs">
        <label className="flex items-center gap-1">
          <span className="opacity-60">Gauge:</span>
          <input
            className="w-32 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 outline-none focus:border-[#e94560]"
            value={gaugeName}
            onChange={(e) => setGaugeName(e.target.value)}
            onBlur={applyMeta}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="opacity-60">W:</span>
          <input
            type="number"
            className="w-16 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 outline-none"
            value={width}
            onChange={(e) => setWidth(parseFloat(e.target.value) || 512)}
            onBlur={applyMeta}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="opacity-60">H:</span>
          <input
            type="number"
            className="w-16 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 outline-none"
            value={height}
            onChange={(e) => setHeight(parseFloat(e.target.value) || 512)}
            onBlur={applyMeta}
          />
        </label>

        <div className="h-4 w-px bg-[#2a2a4a] mx-1" />

        <button
          className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded"
          onClick={undo}
          title="Undo (Ctrl+Z)"
        >
          ↩
        </button>
        <button
          className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded"
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↪
        </button>

        <div className="h-4 w-px bg-[#2a2a4a] mx-1" />

        <button
          className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded"
          onClick={() => saveScene("./scene.ron")}
        >
          Save
        </button>
        <button
          className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded"
          onClick={() => loadScene("./scene.ron")}
        >
          Load
        </button>

        <div className="h-4 w-px bg-[#2a2a4a] mx-1" />

        <button
          className="px-2 py-0.5 bg-purple-900/50 hover:bg-purple-900/80 rounded"
          onClick={handlePreviewCode}
        >
          Preview Code
        </button>
      </div>

      {/* Code preview modal */}
      {showCodePreview && codegenPreview && (
        <CodePreviewModal
          preview={codegenPreview}
          onClose={() => setShowCodePreview(false)}
        />
      )}
    </>
  );
}

function CodePreviewModal({
  preview,
  onClose,
}: {
  preview: { gauge_rs: string; draw_rs: string; vars_rs: string; cargo_toml: string };
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"gauge_rs" | "draw_rs" | "vars_rs" | "cargo_toml">("gauge_rs");

  const files = {
    gauge_rs: { label: "gauge.rs", content: preview.gauge_rs },
    draw_rs: { label: "draw.rs", content: preview.draw_rs },
    vars_rs: { label: "vars.rs", content: preview.vars_rs },
    cargo_toml: { label: "Cargo.toml", content: preview.cargo_toml },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[80vw] h-[80vh] bg-[#1a1a2e] border border-[#2a2a4a] rounded-lg flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#2a2a4a]">
          <div className="flex gap-1">
            {(Object.keys(files) as (keyof typeof files)[]).map((key) => (
              <button
                key={key}
                className={`px-3 py-1 text-xs rounded ${
                  tab === key
                    ? "bg-[#e94560] text-white"
                    : "bg-white/10 hover:bg-white/20"
                }`}
                onClick={() => setTab(key)}
              >
                {files[key].label}
              </button>
            ))}
          </div>
          <button className="text-lg hover:text-[#e94560]" onClick={onClose}>
            ✕
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-5 text-green-300/90">
          {files[tab].content}
        </pre>
      </div>
    </div>
  );
}

export default function App() {
  const fetchScene = useSceneStore((s) => s.fetchScene);
  const fetchVars = useSceneStore((s) => s.fetchVars);

  useEffect(() => {
    fetchScene();
    fetchVars();
  }, []);

  // Global keyboard shortcuts
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
    <div className="flex flex-col h-screen">
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

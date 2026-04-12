import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSceneStore, type BuildModeType } from "../store/sceneStore";
import { Dropdown } from "./Dropdown";

const inputCls =
  "bg-[#0f0f0f] border border-[#181818] rounded-md text-[#e8e8e8] text-xs px-2 py-1 outline-none focus:border-[#6366f1] transition-colors";

export default function BuildPanel() {
  const buildLogs = useSceneStore((s) => s.buildLogs);
  const building = useSceneStore((s) => s.building);
  const addBuildLog = useSceneStore((s) => s.addBuildLog);
  const setBuildDone = useSceneStore((s) => s.setBuildDone);
  const runBuild = useSceneStore((s) => s.runBuild);
  const emitProject = useSceneStore((s) => s.emitProject);

  const [outputDir, setOutputDir] = useState("./output");
  const [mode, setMode] = useState<BuildModeType>("CodegenOnly");
  const [msfsSdkPath, setMsfsSdkPath] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten1 = listen<{ line: string; kind: "stdout" | "stderr" }>("build_log", (e) => addBuildLog(e.payload));
    const unlisten2 = listen<{ success: boolean; elapsed_ms: number }>("build_done", (e) => {
      addBuildLog({
        line: `\n── Build ${e.payload.success ? "succeeded ✓" : "FAILED ✗"} (${e.payload.elapsed_ms}ms)`,
        kind: e.payload.success ? "stdout" : "stderr",
      });
      setBuildDone();
    });
    return () => { unlisten1.then((f) => f()); unlisten2.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [buildLogs]);

  const handleBuild = async () => {
    await emitProject(outputDir);
    if (mode !== "CodegenOnly") {
      await runBuild(outputDir, mode, msfsSdkPath);
    } else {
      addBuildLog({ line: "Codegen complete — files written to " + outputDir, kind: "stdout" });
    }
  };

  return (
    <div style={{ background: "#050505", borderTop: "1px solid #0f0f0f" }}>
      {/* Controls */}
      <div
        className="flex items-center gap-2 px-3"
        style={{ height: 44 }}
      >
        {/* Collapse toggle */}
        <button
          className="text-[11px] transition-colors shrink-0"
          style={{ color: "#454545" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#a0a0a0")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#454545")}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Show log" : "Hide log"}
        >
          {collapsed ? "▲" : "▼"}
        </button>

        <span className="text-[10px] font-semibold uppercase tracking-widest shrink-0" style={{ color: "#454545" }}>
          Build
        </span>

        <div className="w-px h-4 shrink-0" style={{ background: "#262626" }} />

        <label className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px]" style={{ color: "#737373" }}>Output</span>
          <input
            className={`w-36 ${inputCls}`}
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
          />
        </label>

        <div className="shrink-0">
          <Dropdown
            value={mode}
            onChange={(v) => setMode(v as BuildModeType)}
            options={[
              { value: "CodegenOnly", label: "Codegen Only" },
              { value: "CheckOnly",   label: "Check Only"   },
              { value: "FullBuild",   label: "Full Build (WASM)" },
            ]}
          />
        </div>

        {mode === "FullBuild" && (
          <input
            placeholder="MSFS SDK path"
            className={`w-44 ${inputCls}`}
            value={msfsSdkPath}
            onChange={(e) => setMsfsSdkPath(e.target.value)}
          />
        )}

        <div className="flex-1" />

        {building && (
          <span className="text-[11px] animate-pulse" style={{ color: "#f59e0b" }}>
            Building…
          </span>
        )}

        <button
          className="px-4 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0"
          style={{
            background: building ? "#262626" : "#6366f1",
            color: building ? "#454545" : "white",
            cursor: building ? "not-allowed" : "pointer",
          }}
          disabled={building}
          onClick={handleBuild}
        >
          {building ? "Building…" : "▶ Build"}
        </button>
      </div>

      {/* Log output */}
      {!collapsed && (
        <div
          ref={logRef}
          className="overflow-y-auto font-mono leading-[18px]"
          style={{
            height: 120,
            padding: "8px 16px",
            fontSize: 11,
            background: "#000000",
            borderTop: "1px solid #0f0f0f",
          }}
        >
          {buildLogs.map((log, i) => (
            <div
              key={i}
              style={{ color: log.kind === "stderr" ? "#f87171" : "#86efac", whiteSpace: "pre-wrap" }}
            >
              {log.line}
            </div>
          ))}
          {buildLogs.length === 0 && (
            <span style={{ color: "#333" }}>Build output will appear here…</span>
          )}
        </div>
      )}
    </div>
  );
}

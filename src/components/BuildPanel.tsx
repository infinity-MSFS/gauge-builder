import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSceneStore, type BuildModeType } from "../store/sceneStore";

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
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten1 = listen<{ line: string; kind: "stdout" | "stderr" }>(
      "build_log",
      (e) => addBuildLog(e.payload),
    );
    const unlisten2 = listen<{ success: boolean; elapsed_ms: number }>(
      "build_done",
      (e) => {
        addBuildLog({
          line: `\n--- Build ${e.payload.success ? "succeeded" : "FAILED"} (${e.payload.elapsed_ms}ms) ---`,
          kind: e.payload.success ? "stdout" : "stderr",
        });
        setBuildDone();
      },
    );
    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
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
    <div className="border-t border-[#2a2a4a] bg-[#0f3460]/50">
      {/* Controls row */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <label className="flex items-center gap-1">
          <span className="opacity-60">Output:</span>
          <input
            className="w-40 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 outline-none"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
          />
        </label>
        <select
          className="bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5"
          value={mode}
          onChange={(e) => setMode(e.target.value as BuildModeType)}
        >
          <option value="CodegenOnly">Codegen Only</option>
          <option value="CheckOnly">Check Only</option>
          <option value="FullBuild">Full Build (WASM)</option>
        </select>
        {mode === "FullBuild" && (
          <input
            placeholder="MSFS SDK path"
            className="w-48 bg-black/30 border border-[#2a2a4a] rounded px-1.5 py-0.5 outline-none"
            value={msfsSdkPath}
            onChange={(e) => setMsfsSdkPath(e.target.value)}
          />
        )}
        <button
          className={`px-3 py-0.5 rounded font-semibold ${
            building
              ? "bg-gray-600 cursor-not-allowed"
              : "bg-[#e94560] hover:bg-[#e94560]/80"
          }`}
          disabled={building}
          onClick={handleBuild}
        >
          {building ? "Building..." : "Build"}
        </button>
      </div>
      {/* Log area */}
      <div
        ref={logRef}
        className="h-32 overflow-y-auto px-3 py-1 font-mono text-[11px] leading-4 bg-black/40"
      >
        {buildLogs.map((log, i) => (
          <div
            key={i}
            className={log.kind === "stderr" ? "text-red-400" : "text-green-300/80"}
          >
            {log.line}
          </div>
        ))}
        {buildLogs.length === 0 && (
          <span className="opacity-30">Build output will appear here...</span>
        )}
      </div>
    </div>
  );
}

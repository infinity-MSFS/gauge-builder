import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useSceneStore } from "./sceneStore";
import { useRefImageStore, refImageElements } from "./refImageStore";

const MAX_NAME_LEN = 24;

function trimName(name: string): string {
  if (name.length <= MAX_NAME_LEN) return name;
  return name.slice(0, MAX_NAME_LEN - 3) + "...";
}

function bytesToDataURL(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function mimeFromExt(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":  return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "bmp":  return "image/bmp";
    case "gif":  return "image/gif";
    case "svg":  return "image/svg+xml";
    default:     return "image/png";
  }
}

export function loadRefImageFromDataURL(
  src: string,
  name: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scene = useSceneStore.getState().scene;
      const scale = Math.min(scene.width / img.width, scene.height / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const id = `ref_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      refImageElements.set(id, img);
      useRefImageStore.getState().addImage({
        id,
        name: trimName(name),
        x: (scene.width - w) / 2,
        y: (scene.height - h) / 2,
        w,
        h,
        opacity: 0.5,
        locked: false,
        visible: true,
      });
      useSceneStore.getState().setSelectedId(id);
      resolve(id);
    };
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

export function loadRefImageFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      loadRefImageFromDataURL(src, file.name).then(resolve, reject);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function pickRefImageViaDialog(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"],
      },
    ],
  });
  if (!picked || typeof picked !== "string") return null;
  const bytes = await readFile(picked);
  const dataURL = bytesToDataURL(bytes, mimeFromExt(picked));
  const name = picked.replace(/\\/g, "/").split("/").pop() ?? "Reference";
  return loadRefImageFromDataURL(dataURL, name);
}

export async function loadRefImageFromClipboard(
  items: DataTransferItemList | null,
): Promise<string | null> {
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        const ext = item.type.split("/")[1] ?? "png";
        const name = `Pasted.${ext}`;
        return loadRefImageFromFile(
          new File([file], name, { type: item.type }),
        );
      }
    }
  }
  return null;
}

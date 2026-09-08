import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useSceneStore } from "./sceneStore";
import { useEditorStore } from "./editorStore";
import { useRefImageStore, refImageElements, refImageData } from "./refImageStore";
import { bytesToDataURL, mimeFromExt, fileNameOf } from "./imageBytes";

const MAX_NAME_LEN = 24;

function trimName(name: string): string {
  if (name.length <= MAX_NAME_LEN) return name;
  return name.slice(0, MAX_NAME_LEN - 3) + "...";
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
      refImageData.set(id, src);
      useRefImageStore.getState().addImage({
        id,
        name: trimName(name),
        sourceName: name,
        x: (scene.width - w) / 2,
        y: (scene.height - h) / 2,
        w,
        h,
        opacity: 0.5,
        locked: false,
        visible: true,
      });
      useEditorStore.getState().setSelection([id]);
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
  const name = fileNameOf(picked);
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

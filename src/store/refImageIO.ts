import { readFile } from "@tauri-apps/plugin-fs";
import {
  useRefImageStore,
  refImageElements,
  refImageData,
} from "./refImageStore";
import {
  bytesToDataURL,
  mimeFromExt,
  base64FromDataURL,
  fileNameOf,
} from "./imageBytes";

/** Reference image handed to the backend on save/export — meta plus pixels. */
export interface RefImageInput {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  source_name: string;
  /** base64, no `data:` prefix. */
  data: string;
}

/** Reference image as recorded in a scene RON. */
export interface RefImageRecord {
  id: string;
  name: string;
  /** Path relative to the RON's own directory, e.g. `refs/alt_panel_1f2e.png`. */
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
}

/**
 * Snapshot every loaded reference image for the backend, which writes the bytes
 * into the project's `refs/` folder and records the paths in the scene RON.
 */
export function collectRefImageInputs(): RefImageInput[] {
  return useRefImageStore.getState().images.flatMap((img) => {
    const dataURL = refImageData.get(img.id);
    // An image whose pixels went missing (restored from a deleted file) would
    // otherwise be written out empty — drop it instead.
    if (!dataURL) return [];
    const { sourceName, ...meta } = img;
    return [
      { ...meta, source_name: sourceName, data: base64FromDataURL(dataURL) },
    ];
  });
}

/** Directory holding `path`, with separators normalized to `/`. */
function dirOf(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const cut = norm.lastIndexOf("/");
  return cut === -1 ? "." : norm.slice(0, cut);
}

/**
 * Repopulate the reference layer from a freshly opened project: each record's
 * `file` is resolved against the RON's directory and decoded back into an
 * image, keeping the geometry the project was saved with.
 */
export async function restoreRefImages(
  scenePath: string,
  records: RefImageRecord[],
): Promise<void> {
  useRefImageStore.getState().clear();
  const dir = dirOf(scenePath);

  for (const rec of records) {
    const path = `${dir}/${rec.file}`;
    try {
      const bytes = await readFile(path);
      const dataURL = bytesToDataURL(bytes, mimeFromExt(rec.file));
      await decodeInto(rec, dataURL);
    } catch (err) {
      console.error(`Reference image "${rec.name}" (${path}) failed to load:`, err);
    }
  }
}

function decodeInto(rec: RefImageRecord, dataURL: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      refImageElements.set(rec.id, img);
      refImageData.set(rec.id, dataURL);
      const { file, ...meta } = rec;
      useRefImageStore.getState().addImage({
        ...meta,
        sourceName: fileNameOf(file),
      });
      resolve();
    };
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataURL;
  });
}

import { create } from "zustand";

export interface RefImageMeta {
  id: string;
  name: string;
  /** Original file name — its extension picks the suffix used on export. */
  sourceName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
}

interface RefImageStore {
  images: RefImageMeta[];
  addImage: (meta: RefImageMeta) => void;
  updateImage: (id: string, patch: Partial<RefImageMeta>) => void;
  deleteImage: (id: string) => void;
  reorderImages: (ids: string[]) => void;
  /** Drop every reference image — used when a project is opened. */
  clear: () => void;
}

// Module-level maps: id → decoded image, id → original data URL. Kept out of
// zustand so the pixels never take part in state diffing; the data URLs are
// what gets written into a project's refs/ folder on save or export.
export const refImageElements = new Map<string, HTMLImageElement>();
export const refImageData = new Map<string, string>();

export const useRefImageStore = create<RefImageStore>((set) => ({
  images: [],

  addImage: (meta) =>
    set((s) => ({ images: [...s.images, meta] })),

  updateImage: (id, patch) =>
    set((s) => ({
      images: s.images.map((img) =>
        img.id === id ? { ...img, ...patch } : img
      ),
    })),

  deleteImage: (id) => {
    refImageElements.delete(id);
    refImageData.delete(id);
    set((s) => ({ images: s.images.filter((img) => img.id !== id) }));
  },

  clear: () => {
    refImageElements.clear();
    refImageData.clear();
    set({ images: [] });
  },

  reorderImages: (ids) =>
    set((s) => {
      const map = new Map(s.images.map((img) => [img.id, img]));
      return { images: ids.map((id) => map.get(id)!).filter(Boolean) };
    }),
}));

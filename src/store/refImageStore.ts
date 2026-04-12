import { create } from "zustand";

export interface RefImageMeta {
  id: string;
  name: string;
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
}

// Module-level map: id → HTMLImageElement (not in zustand to avoid serialization)
export const refImageElements = new Map<string, HTMLImageElement>();

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
    set((s) => ({ images: s.images.filter((img) => img.id !== id) }));
  },

  reorderImages: (ids) =>
    set((s) => {
      const map = new Map(s.images.map((img) => [img.id, img]));
      return { images: ids.map((id) => map.get(id)!).filter(Boolean) };
    }),
}));

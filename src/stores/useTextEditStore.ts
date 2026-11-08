import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { JSONContent } from "@tiptap/core";
import { useAppStore } from "@/stores/useAppStore";
import { STORES } from "@/utils/indexedDB";
import {
  createSplitIndexedDBPersistStorage,
  type SplitPersistSnapshot,
} from "@/utils/splitIndexedDBPersistStorage";

export interface TextEditInstance {
  instanceId: string;
  filePath: string | null;
  contentJson: JSONContent | null;
  hasUnsavedChanges: boolean;
}

export interface TextEditStoreState {
  // Instance management
  instances: Record<string, TextEditInstance>;

  // Instance actions
  createInstance: (instanceId: string) => void;
  removeInstance: (instanceId: string) => void;
  updateInstance: (
    instanceId: string,
    updates: Partial<Omit<TextEditInstance, "instanceId">>
  ) => void;
  getInstanceByPath: (path: string) => TextEditInstance | null;
  getInstanceIdByPath: (path: string) => string | null;
  getForegroundInstance: () => TextEditInstance | null;
}

type TextEditPersistedState = Pick<TextEditStoreState, "instances">;

/**
 * Saved, clean documents are re-read from the virtual file system on restore.
 * Untitled documents and unsaved edits keep their editor JSON so a reload
 * doesn't discard a draft.
 */
export function contentJsonForPersist(
  instance: Pick<
    TextEditInstance,
    "filePath" | "contentJson" | "hasUnsavedChanges"
  >
): JSONContent | null {
  if (!instance.filePath || instance.hasUnsavedChanges) {
    return instance.contentJson;
  }
  return null;
}

const splitTextEditState = (
  state: TextEditPersistedState
): SplitPersistSnapshot<TextEditPersistedState> => ({
  metadata: { instances: {} },
  rows: {
    [STORES.TEXTEDIT_INSTANCES]: Object.entries(state.instances).map(
      ([instanceId, instance]) => ({
        key: instanceId,
        value: { instance },
        revision: instance,
      })
    ),
  },
});

const mergeTextEditState = (
  metadata: TextEditPersistedState,
  rows: Readonly<Record<string, readonly { key: string; value: Record<string, unknown> }[]>>
): TextEditPersistedState => {
  const instances: Record<string, TextEditInstance> = {};
  for (const row of rows[STORES.TEXTEDIT_INSTANCES] ?? []) {
    const instance = row.value.instance;
    if (
      instance &&
      typeof instance === "object" &&
      !Array.isArray(instance) &&
      "instanceId" in instance
    ) {
      instances[row.key] = instance as TextEditInstance;
    }
  }
  return { ...metadata, instances };
};

export const useTextEditStore = create<TextEditStoreState>()(
  persist(
    (set, get) => ({
      instances: {},

      createInstance: (instanceId) =>
        set((state) => {
          if (state.instances[instanceId]) {
            return state;
          }

          return {
            instances: {
              ...state.instances,
              [instanceId]: {
                instanceId,
                filePath: null,
                contentJson: null,
                hasUnsavedChanges: false,
              },
            },
          };
        }),

      removeInstance: (instanceId) =>
        set((state) => {
          const newInstances = { ...state.instances };
          delete newInstances[instanceId];
          return { instances: newInstances };
        }),

      updateInstance: (instanceId, updates) =>
        set((state) => {
          if (!state.instances[instanceId]) return state;
          return {
            instances: {
              ...state.instances,
              [instanceId]: {
                ...state.instances[instanceId],
                ...updates,
              },
            },
          };
        }),

      getInstanceByPath: (path) => {
        const instances = Object.values(get().instances);
        return instances.find((inst) => inst.filePath === path) || null;
      },

      getInstanceIdByPath: (path) => {
        const instances = get().instances;
        for (const [id, instance] of Object.entries(instances)) {
          if (instance.filePath === path) {
            return id;
          }
        }
        return null;
      },

      getForegroundInstance: () => {
        const appStore = useAppStore.getState();
        const foregroundInstance = appStore.getForegroundInstance();

        if (!foregroundInstance || foregroundInstance.appId !== "textedit") {
          return null;
        }

        return get().instances[foregroundInstance.instanceId] || null;
      },
    }),
    {
      name: "ryos:textedit",
      storage: createSplitIndexedDBPersistStorage<TextEditPersistedState>({
        stores: [STORES.TEXTEDIT_INSTANCES],
        layoutVersion: 1,
        persistVersion: 0,
        split: splitTextEditState,
        merge: mergeTextEditState,
      }),
      partialize: (state) => ({
        instances: Object.fromEntries(
          Object.entries(state.instances).map(([id, inst]) => [
            id,
            {
              ...inst,
              contentJson: contentJsonForPersist(inst),
            },
          ])
        ),
      }),
    }
  )
);

// Reading prefs for Ghost documents (CHECKLIST-36 §12a): one set for every
// TextEdit window, kept in localStorage apart from the IndexedDB instances.
export const READER_FONTS = {
  site: { label: "OpenDyslexic", stack: '"OpenDyslexic", Arial, sans-serif' },
  lucida: { label: "Lucida Grande", stack: '"LucidaGrande", "Lucida Grande", sans-serif' },
  geneva: { label: "Geneva", stack: '"Geneva-12", Geneva, sans-serif' },
  garamond: { label: "Garamond", stack: '"EB Garamond", Georgia, serif' },
  monaco: { label: "Monaco", stack: '"Monaco", ui-monospace, monospace' },
} as const;
export type ReaderFont = keyof typeof READER_FONTS;
// Zoom on a 16px body: 12, 16, 20, 24, 32px, all base 4.
export const READER_SIZES = [0.75, 1, 1.25, 1.5, 2] as const;
export const READER_DEFAULT_SIZE = 1;

interface ReaderPrefs {
  font: ReaderFont;
  size: number; // index into READER_SIZES
  wide: boolean; // View alt "width"
  update: (p: Partial<Omit<ReaderPrefs, "update">>) => void;
}

export const useReaderPrefs = create<ReaderPrefs>()(
  persist(
    (set) => ({
      font: "site",
      size: READER_DEFAULT_SIZE,
      wide: false,
      update: (p) => set(p),
    }),
    { name: "ryos:textedit-reader", version: 1 }
  )
);

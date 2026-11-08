import { create } from "zustand";
import { useStoreShallow } from "./helpers";
import { persist } from "zustand/middleware";
import { shouldUpdatePlaybackTime } from "./playbackTime";
import { createIndexedDBPersistStorage } from "@/utils/indexedDBPersistStorage";
import {
  resetPlaybackConfirmation,
  stopPlayback,
} from "@/shared/media/confirmedPlayback";
import { createTransportActions } from "@/shared/media/transport";

// The video item shape now lives in the shared MediaCore library model
// (`Video` is a strict subset of the music `Track`). Re-exported here for
// compatibility with existing importers.
export type { VideoItem as Video } from "@/shared/media/library";
import type { VideoItem as Video } from "@/shared/media/library";

// Playlist is filled from Ghost video posts (lib/ghost listVideos); not persisted.
export const DEFAULT_VIDEOS: Video[] = [];

interface VideoStoreState {
  videos: Video[];
  currentVideoId: string | null;
  loopAll: boolean;
  loopCurrent: boolean;
  isShuffled: boolean;
  /** Desired player state, including an in-flight play attempt. */
  playbackRequested: boolean;
  /** True only after ReactPlayer emits `onPlay`. */
  isPlaying: boolean;
  /**
   * Transient playback clock reported by ReactPlayer's `onProgress`. NOT
   * persisted. `playedSeconds` is the fine-grained value (drives the seek
   * bar); `elapsedTime` is the floored-second value (drives the LCD readout)
   * and only changes ~1x/sec. Living here — rather than in `useVideosLogic`
   * reducer state — keeps the ~1Hz tick from re-rendering the whole Videos
   * tree; only the leaf subscribers re-render. Mirrors the iPod pattern.
   */
  playedSeconds: number;
  elapsedTime: number;
  // actions
  setVideos: (videos: Video[] | ((prev: Video[]) => Video[])) => void;
  setCurrentVideoId: (videoId: string | null) => void;
  setLoopAll: (val: boolean) => void;
  setLoopCurrent: (val: boolean) => void;
  setIsShuffled: (val: boolean) => void;
  togglePlay: () => void;
  /** Request play or stop; `true` remains pending until `confirmPlayback`. */
  setIsPlaying: (val: boolean) => void;
  confirmPlayback: () => void;
  /** Update the playback clock from a progress tick (fine + floored). */
  setPlaybackTime: (seconds: number) => void;
  /** Reset the playback clock to zero (e.g. on track change). */
  resetPlaybackTime: () => void;
  // derived state helpers
  getCurrentIndex: () => number;
  getCurrentVideo: () => Video | null;
}

const CURRENT_VIDEO_STORE_VERSION = 9; // playlist no longer persisted

const getInitialState = () => ({
  videos: DEFAULT_VIDEOS,
  currentVideoId: DEFAULT_VIDEOS.length > 0 ? DEFAULT_VIDEOS[0].id : null,
  loopAll: true,
  loopCurrent: false,
  isShuffled: false,
  ...stopPlayback(),
  playedSeconds: 0,
  elapsedTime: 0,
});

export const useVideoStore = create<VideoStoreState>()(
  persist(
    (set, get) => ({
      ...getInitialState(),

      setVideos: (videosOrUpdater) => {
        set((state) => {
          const newVideos =
            typeof videosOrUpdater === "function"
              ? (videosOrUpdater as (prev: Video[]) => Video[])(state.videos)
              : videosOrUpdater;

          // Validate currentVideoId when videos change
          let currentVideoId = state.currentVideoId;
          if (
            currentVideoId &&
            !newVideos.find((v) => v.id === currentVideoId)
          ) {
            currentVideoId = newVideos.length > 0 ? newVideos[0].id : null;
          }

          return {
            videos: newVideos,
            currentVideoId,
            ...(currentVideoId !== state.currentVideoId
              ? resetPlaybackConfirmation(state)
              : {}),
          };
        });
      },
      setCurrentVideoId: (videoId) =>
        set((state) => {
          // Ensure videoId exists in videos array
          const validVideoId =
            videoId && state.videos.find((v) => v.id === videoId)
              ? videoId
              : null;
          return {
            currentVideoId: validVideoId,
            ...(validVideoId !== state.currentVideoId
              ? resetPlaybackConfirmation(state)
              : {}),
          };
        }),
      setLoopAll: (val) => set({ loopAll: val }),
      setLoopCurrent: (val) => set({ loopCurrent: val }),
      setIsShuffled: (val) => set({ isShuffled: val }),
      ...createTransportActions<VideoStoreState>(set),
      setPlaybackTime: (seconds) =>
        set((state) => {
          const flooredSeconds = Math.floor(seconds);
          const nextPlayed = shouldUpdatePlaybackTime(
            state.playedSeconds,
            seconds
          )
            ? seconds
            : state.playedSeconds;
          // `elapsedTime` only flips on whole-second boundaries, so it
          // re-renders the LCD readout subscriber at most ~1x/sec.
          if (
            nextPlayed === state.playedSeconds &&
            flooredSeconds === state.elapsedTime
          ) {
            return {};
          }
          return { playedSeconds: nextPlayed, elapsedTime: flooredSeconds };
        }),
      resetPlaybackTime: () => set({ playedSeconds: 0, elapsedTime: 0 }),

      // Derived state helpers
      getCurrentIndex: () => {
        const state = get();
        return state.currentVideoId
          ? state.videos.findIndex((v) => v.id === state.currentVideoId)
          : -1;
      },
      getCurrentVideo: () => {
        const state = get();
        return state.currentVideoId
          ? state.videos.find((v) => v.id === state.currentVideoId) || null
          : null;
      },
    }),
    {
      name: "ryos:videos",
      version: CURRENT_VIDEO_STORE_VERSION,
      storage: createIndexedDBPersistStorage(),
      partialize: (state) => ({
        loopAll: state.loopAll,
        loopCurrent: state.loopCurrent,
        isShuffled: state.isShuffled,
      }),
    }
  )
);

/**
 * Shallow-equality selector hook for this store. Co-located with the store
 * (rather than a central helpers barrel) so importing it doesn't pull other
 * stores into the bundle.
 */
export function useVideoStoreShallow<T>(
  selector: (state: ReturnType<typeof useVideoStore.getState>) => T
): T {
  return useStoreShallow(useVideoStore, selector);
}

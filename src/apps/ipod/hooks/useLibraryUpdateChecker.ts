import { useEffect } from "react";
import { useIpodStore } from "@/stores/useIpodStore";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// QNTNs (CHECKLIST-36 §23): no ryOS song server to poll. The library re-reads
// Ghost each time the iPod opens (never at desktop boot); "Sync Library"
// re-reads it on demand.
export function useLibraryUpdateChecker(isActive: boolean) {
  const { t } = useTranslation();
  const syncLibrary = useIpodStore((state) => state.syncLibrary);

  useEffect(() => {
    if (!isActive) return;
    // No first-track default: with nothing chosen yet, iPod opens on its menu, not a poem (CHECKLIST-36 §55).
    const chosen = useIpodStore.getState().currentSongId;
    void useIpodStore.getState().initializeLibrary().then(() => {
      if (!chosen) useIpodStore.setState({ currentSongId: null });
    });
  }, [isActive]);

  // Manual sync function that syncs with server library
  const manualSync = async () => {
    try {
      const wasEmptyBefore = useIpodStore.getState().tracks.length === 0;
      const result = await syncLibrary();

      if (result.newTracksAdded > 0 || result.tracksUpdated > 0) {
        const message =
          wasEmptyBefore && result.newTracksAdded > 0
            ? t("apps.ipod.dialogs.addedSongsToTop", {
                count: result.newTracksAdded,
                plural: result.newTracksAdded === 1 ? "" : "s",
              })
            : t("apps.ipod.dialogs.addedNewSongsToTop", {
                newCount: result.newTracksAdded,
                newPlural: result.newTracksAdded === 1 ? "" : "s",
                updatedText:
                  result.tracksUpdated > 0
                    ? t("apps.ipod.dialogs.andUpdated", {
                        count: result.tracksUpdated,
                        plural: result.tracksUpdated === 1 ? "" : "s",
                      })
                    : "",
                total: result.totalTracks,
              });

        toast.success(t("apps.ipod.dialogs.librarySynced"), {
          description: message,
        });
      } else {
        toast.info(t("apps.ipod.dialogs.librarySynced"), {
          description: t("apps.ipod.dialogs.libraryUpToDateWithSongs", {
            count: result.totalTracks,
          }),
        });
      }
      return true;
    } catch (error) {
      console.error("Error during library sync:", error);
      toast.error(t("apps.ipod.dialogs.syncFailed"), {
        description: t("apps.ipod.dialogs.failedToSyncWithServerLibrary"),
      });
      return false;
    }
  };

  return { manualCheck: manualSync, manualSync };
}

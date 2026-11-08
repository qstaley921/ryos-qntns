import { AppHelpAboutDialogs } from "@/components/shared/AppHelpAboutDialogs";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { ShareItemDialog } from "@/components/dialogs/ShareItemDialog";
import { appMetadata } from "../..";
import type { VideosAppController } from "./useVideosAppController";

type VideosAppDialogsProps = {
  c: VideosAppController;
};

export function VideosAppDialogs({ c }: VideosAppDialogsProps) {
  const {
    t,
    translatedHelpItems,
    isHelpDialogOpen,
    setIsHelpDialogOpen,
    isAboutDialogOpen,
    setIsAboutDialogOpen,
    isConfirmClearOpen,
    setIsConfirmClearOpen,
    isShareDialogOpen,
    setIsShareDialogOpen,
    setVideos,
    safeSetCurrentVideoId,
    setIsPlaying,
    getCurrentVideo,
    videosGenerateShareUrl,
  } = c;

  return (
    <>
      <AppHelpAboutDialogs
        appId="videos"
        helpItems={translatedHelpItems}
        metadata={appMetadata}
        isHelpOpen={isHelpDialogOpen}
        onHelpOpenChange={setIsHelpDialogOpen}
        isAboutOpen={isAboutDialogOpen}
        onAboutOpenChange={setIsAboutDialogOpen}
      />
      <ConfirmDialog
        isOpen={isConfirmClearOpen}
        onOpenChange={setIsConfirmClearOpen}
        onConfirm={() => {
          setVideos([]);
          safeSetCurrentVideoId(null);
          setIsPlaying(false);
          setIsConfirmClearOpen(false);
        }}
        title={t("apps.videos.dialogs.clearPlaylistTitle")}
        description={t("apps.videos.dialogs.clearPlaylistDescription")}
      />
      <ShareItemDialog
        isOpen={isShareDialogOpen}
        onClose={() => setIsShareDialogOpen(false)}
        itemType={t("apps.videos.dialogs.videoItemType")}
        itemIdentifier={getCurrentVideo()?.id || ""}
        title={getCurrentVideo()?.title}
        details={getCurrentVideo()?.artist}
        generateShareUrl={videosGenerateShareUrl}
      />
    </>
  );
}

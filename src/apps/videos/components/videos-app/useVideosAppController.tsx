import { useMemo } from "react";
import type { AppProps, VideosInitialData } from "@/apps/base/types";
import { VideosMenuBar } from "../VideosMenuBar";
import { useVideosLogic } from "../../hooks/useVideosLogic";

export type UseVideosAppControllerArgs = Pick<
  AppProps<VideosInitialData>,
  "isWindowOpen" | "onClose" | "isForeground" | "initialData" | "instanceId"
>;

export function useVideosAppController({
  isWindowOpen,
  onClose,
  isForeground,
  initialData,
  instanceId,
}: UseVideosAppControllerArgs) {
  const logic = useVideosLogic({
    isWindowOpen,
    isForeground,
    initialData,
    instanceId,
  });

  const {
    videos,
    currentVideoId,
    safeSetCurrentVideoId,
    setIsPlaying,
    setIsHelpDialogOpen,
    setIsAboutDialogOpen,
    setIsConfirmClearOpen,
    toggleShuffle,
    setLoopAll,
    loopAll,
    setLoopCurrent,
    loopCurrent,
    togglePlay,
    nextVideo,
    previousVideo,
    isPlaying,
    isShuffled,
    handleFullScreen,
    handleShareVideo,
  } = logic;

  const menuBar = (
    <VideosMenuBar
      onClose={onClose}
      onShowHelp={() => setIsHelpDialogOpen(true)}
      onShowAbout={() => setIsAboutDialogOpen(true)}
      videos={videos}
      currentVideoId={currentVideoId}
      onPlayVideo={(videoId) => {
        safeSetCurrentVideoId(videoId);
        setIsPlaying(true);
      }}
      onClearPlaylist={() => {
        setIsConfirmClearOpen(true);
      }}
      onShufflePlaylist={toggleShuffle}
      onToggleLoopAll={() => setLoopAll(!loopAll)}
      onToggleLoopCurrent={() => setLoopCurrent(!loopCurrent)}
      onTogglePlay={() => {
        togglePlay();
      }}
      onNext={nextVideo}
      onPrevious={previousVideo}
      isPlaying={isPlaying}
      isLoopAll={loopAll}
      isLoopCurrent={loopCurrent}
      isShuffled={isShuffled}
      onFullScreen={handleFullScreen}
      onShareVideo={handleShareVideo}
    />
  );

  const shouldShowWhiteNoise = useMemo(
    () => videos.length > 0 && !isPlaying && !logic.isFullScreen,
    [videos.length, isPlaying, logic.isFullScreen]
  );

  return {
    ...logic,
    menuBar,
    shouldShowWhiteNoise,
  };
}

export type VideosAppController = ReturnType<typeof useVideosAppController>;

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useSound, Sounds } from "@/hooks/useSound";
import { useTranslation } from "react-i18next";

interface BootScreenProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onBootComplete?: () => void;
  title?: string;
  debugMode?: boolean;
}

export function BootScreen({
  isOpen,
  onOpenChange,
  onBootComplete,
  title,
  debugMode = false,
}: BootScreenProps) {
  const { play } = useSound(Sounds.BOOT, 0.5);
  type BootState = { progress: number };
  type BootAction =
    | { type: "reset" }
    | { type: "setProgress"; value: number }
    | { type: "increment"; amount: number };
  const initialState: BootState = { progress: 0 };
  const reducer = (state: BootState, action: BootAction): BootState => {
    switch (action.type) {
      case "reset":
        return initialState;
      case "setProgress":
        return { progress: Math.max(0, Math.min(100, action.value)) };
      case "increment":
        return {
          progress: Math.min(100, state.progress + action.amount),
        };
      default:
        return state;
    }
  };
  const [{ progress }, dispatch] = useReducer(reducer, initialState);
  const { t } = useTranslation();
  const localizedTitle = title ?? t("common.system.systemRestoring");
  const dialogDescription = localizedTitle;
  const onBootCompleteRef = useRef(onBootComplete);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onBootCompleteRef.current = onBootComplete;
    onOpenChangeRef.current = onOpenChange;
  }, [onBootComplete, onOpenChange]);

  const completeBoot = useCallback(() => {
    onBootCompleteRef.current?.();
    onOpenChangeRef.current(false);
  }, []);

  const handleDone = completeBoot;

  useEffect(() => {
    let progressInterval: number | undefined;
    let completeTimer: number | undefined;

    if (!isOpen) {
      dispatch({ type: "reset" });
      return undefined;
    }

    if (debugMode) {
      dispatch({ type: "setProgress", value: 100 });
      return undefined;
    }

    const soundTimer = window.setTimeout(() => {
      play();
    }, 100);

    progressInterval = window.setInterval(() => {
      dispatch({ type: "increment", amount: Math.random() * 10 });
    }, 100);

    const bootTimer = window.setTimeout(() => {
      window.clearInterval(progressInterval);
      progressInterval = undefined;
      dispatch({ type: "setProgress", value: 100 });

      completeTimer = window.setTimeout(completeBoot, 500);
    }, 2000);

    return () => {
      window.clearInterval(progressInterval);
      window.clearTimeout(bootTimer);
      window.clearTimeout(soundTimer);
      window.clearTimeout(completeTimer);
    };
  }, [isOpen, play, completeBoot, debugMode]);

  if (!isOpen) return null;

  // Aqua boot screen (the only theme, CHECKLIST-35 §7)
    return (
      <Dialog open={isOpen} onOpenChange={() => {}} modal>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className="fixed inset-0 z-[75] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            style={{ 
              position: "fixed", 
              top: 0, 
              left: 0, 
              right: 0, 
              bottom: 0,
              backgroundColor: "var(--os-accent-boot-bg, #4566a0)"
            }}
          />
          <DialogContent
            className="p-0 w-[calc(100%-24px)] border-none shadow-xl max-w-lg z-[80] outline-none macosx-dialog rounded-none"
            style={{ 
              position: "fixed", 
              zIndex: 80,
              borderRadius: 0,
              backgroundImage: "var(--os-pinstripe-window)",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
            }}
          >
            <VisuallyHidden>
              <DialogTitle>{localizedTitle}</DialogTitle>
              <DialogDescription>{dialogDescription}</DialogDescription>
            </VisuallyHidden>
            <div 
              className="flex flex-col items-center justify-center pt-2 pb-12 px-16 min-h-[280px] w-full"
              onClick={debugMode ? handleDone : undefined}
              style={debugMode ? { cursor: "pointer" } : undefined}
            >
              {/* Apple logo */}
              <img
                src="/icons/macosx/apple.png"
                alt="Apple"
                className="boot-screen-apple-logo size-[120px] object-contain"
                style={{ marginBottom: "-30px" }}
              />
              {/* ryOS X text */}
              <h1 
                className="text-[52px] mb-6"
                style={{ 
                  // Theme tokens so dark mode flips the boot title to a
                  // light glyph against the dark pinstripe surface.
                  color: "var(--os-color-text-primary, #333333)",
                  fontFamily: "AppleGaramond, 'Apple Garamond', 'Times New Roman', serif",
                  letterSpacing: "1px",
                  textShadow: "0 1px 2px rgba(0, 0, 0, 0.15)"
                }}
              >
                ryOS X
              </h1>
              {/* Progress bar - using aqua-progress classes */}
              <div className="aqua-progress w-[220px] h-[20px] rounded-none" style={{ borderRadius: 0 }}>
                <div
                  className="aqua-progress-fill transition-all duration-200 rounded-none"
                  style={{ width: `${progress}%`, borderRadius: 0 }}
                />
              </div>
              {/* Status text */}
              <p 
                className="text-[12px] mt-5"
                style={{ 
                  color: "var(--os-color-text-primary, #000000)",
                  fontFamily: "LucidaGrande, 'Lucida Grande', sans-serif"
                }}
              >
                {localizedTitle}
              </p>
            </div>
          </DialogContent>
        </DialogPrimitive.Portal>
      </Dialog>
    );
}

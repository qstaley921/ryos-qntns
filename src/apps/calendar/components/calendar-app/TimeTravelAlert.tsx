import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ThemedIcon } from "@/components/shared/ThemedIcon";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { cn } from "@/lib/utils";

/** ryOS's ConfirmDialog look with the one OK button (ConfirmDialog always carries Cancel). */
export function TimeTravelAlert({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isWindowsTheme, isMacOSTheme } = useThemeFlags();
  const text = "Time traveling not allowed";
  const font = cn(isWindowsTheme ? "font-['Pixelated_MS_Sans_Serif',Arial] text-[11px]" : "font-geneva-12 text-[12px]");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-w-[400px]", isWindowsTheme && "p-0 overflow-hidden")}>
        <DialogTitle className="sr-only">Calendar</DialogTitle>
        <DialogDescription className="sr-only">{text}</DialogDescription>
        <DialogHeader>Calendar</DialogHeader>
        <div className={isWindowsTheme ? "p-2 px-4" : "p-6"}>
          <div className="flex gap-3 items-start">
            <ThemedIcon name="warn.png" alt="Warning" className="size-[32px] mt-0.5 [image-rendering:pixelated]" width={32} height={32} />
            <p className={cn("text-neutral-900 mb-2 leading-tight", font)}>{text}</p>
          </div>
          <div className="mt-2 flex justify-end">
            <Button autoFocus variant={isMacOSTheme ? "default" : "retro"} onClick={onClose} className={cn(!isMacOSTheme && "h-7", font)}>OK</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

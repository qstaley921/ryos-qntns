import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { getAuthor, type GhostAuthor } from "@/lib/ghost/author";
import { cn } from "@/lib/utils";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const NAME = "Quentin Staley";

export function AboutQntnsDialog({ isOpen, onOpenChange }: Props) {
  const { isWindowsTheme, currentTheme } = useThemeFlags();
  const [a, setA] = useState<Partial<GhostAuthor> | null>(null);

  useEffect(() => {
    // Failure keeps the name and tagline with an empty headshot circle.
    if (isOpen && !a) getAuthor().then(setA, () => setA({}));
  }, [isOpen, a]);

  const content = (
    <div className={cn("flex flex-col items-center gap-2 p-4 text-center max-h-[70vh] overflow-y-auto", currentTheme === "macosx" ? "font-os-ui text-[13px]" : "text-[11px]")}>
      <div className="size-32 rounded-full bg-neutral-200 overflow-hidden">
        {a?.profile_image && <img src={a.profile_image} alt={NAME} className="size-full object-cover" />}
      </div>
      <div className="text-[15px] font-bold">{a?.name ?? NAME}</div>
      <div>The artistic home of Quentin Staley</div>
      {a?.bio && <p>{a.bio}</p>}
      <a href="/quentin-staley/" target="_blank" rel="noreferrer" className="text-os-link hover:underline">More about Quentin</a>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-[400px]", isWindowsTheme && "p-0 overflow-hidden")} disableSheet>
        <DialogTitle className="sr-only">About QNTNs</DialogTitle>
        <DialogDescription className="sr-only">About the author of this site</DialogDescription>
        <DialogHeader>About QNTNs</DialogHeader>
        {isWindowsTheme ? <div className="window-body">{content}</div> : content}
      </DialogContent>
    </Dialog>
  );
}

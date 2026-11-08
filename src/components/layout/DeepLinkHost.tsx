import { useEffect, useState } from "react";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import { listDocs, type GhostDoc } from "@/lib/ghost";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { AboutQntnsDialog } from "@/components/dialogs/AboutQntnsDialog";

// CHECKLIST-35 §60: /<slug>/ opens that post in TextEdit, /about/ opens About QNTNs,
// /graffiti/?wall=<page> opens Paint on that wall, an unknown slug shows an alert.
// Read once at boot from location.pathname; no new network call beyond the list.
export function DeepLinkHost() {
  const launchApp = useLaunchApp();
  const [missing, setMissing] = useState<string | null>(null);
  const [about, setAbout] = useState(false);

  useEffect(() => {
    const slug = location.pathname.split("/").filter(Boolean)[0];
    if (!slug) return;
    if (slug === "graffiti") {
      launchApp("paint", { initialData: { ghost: { slug: new URLSearchParams(location.search).get("wall") ?? "" } } });
      return;
    }
    if (slug === "about") return setAbout(true);
    let live = true;
    listDocs().then(({ docs }) => {
      if (!live) return;
      const d = docs.find((x: GhostDoc) => x.slug === slug);
      if (d) launchApp("textedit", { initialData: { ghost: d } });
      else setMissing(slug);
    });
    return () => { live = false; };
  }, [launchApp]);

  return (
    <>
      <ConfirmDialog
        isOpen={missing !== null}
        onOpenChange={(o) => !o && setMissing(null)}
        onConfirm={() => setMissing(null)}
        title="Not Found"
        description={`The page “${missing}” could not be found.`}
      />
      <AboutQntnsDialog isOpen={about} onOpenChange={setAbout} />
    </>
  );
}

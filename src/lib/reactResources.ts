import { preload, preinit } from "react-dom";

type FetchResource = {
  href: string;
  priority?: "low" | "high";
};

const STYLE_RESOURCES = ["/fonts/fonts.css"];

const FETCH_RESOURCES: FetchResource[] = [
  { href: "/data/filesystem.json", priority: "high" },
  { href: "/data/applets.json" },
];

let primed = false;

export function primeReactResources(): void {
  if (primed || typeof window === "undefined") {
    return;
  }

  primed = true;

  STYLE_RESOURCES.forEach((href) =>
    safely(() =>
      preinit(href, {
        as: "style",
        fetchPriority: "high",
      })
    )
  );

  FETCH_RESOURCES.forEach((resource) =>
    safely(() =>
      preload(resource.href, {
        as: "fetch",
        crossOrigin: "use-credentials",
        fetchPriority: resource.priority ?? "low",
      })
    )
  );
}

function safely(action: () => void) {
  try {
    action();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[react-resources] Failed to prime resource", error);
    }
  }
}

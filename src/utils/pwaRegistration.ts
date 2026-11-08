import { registerSW } from "virtual:pwa-register";
import { createClientLogger } from "@/utils/logger";

const log = createClientLogger("PWA");
let hasRegistered = false;

export function initPwaRegistration(): void {
  // The Ghost theme serves the build under /assets/r-<stamp>/, where sw.js could only control that folder (CHECKLIST-35 §8c).
  if (hasRegistered || !("serviceWorker" in navigator) || import.meta.env.BASE_URL !== "/") {
    return;
  }
  hasRegistered = true;

  registerSW({
    // This module is itself imported from the idle bootstrap queue, so the
    // registration can start immediately without entering the paint path.
    immediate: true,
    onRegisteredSW(_serviceWorkerUrl, registration) {
      log.debug("Service worker registered", {
        active: Boolean(registration?.active),
      });
    },
    onRegisterError(error) {
      hasRegistered = false;
      console.warn("[ryOS] Service worker registration failed:", error);
    },
  });
}

/**
 * §6: the one network gate. ryOS's server is gone and the theme's CLAUDE.md
 * allows exactly these origins: this site (minus ryOS's old /api and /ws),
 * qntns.com and its Ghost API host, and the Worker. Anything else fails the
 * way an offline request does, so every caller takes its existing failure path.
 */
const ALLOWED_ORIGINS = new Set([
  "https://qntns.com",
  "https://qntns.ghost.io",
  "https://qntns-reads.qstaley921.workers.dev",
  "wss://qntns-reads.qstaley921.workers.dev",
]);

export function isAllowedUrl(input: string | URL): boolean {
  let url: URL;
  try {
    url = new URL(String(input), location.href);
  } catch {
    return false;
  }
  if (url.protocol === "blob:" || url.protocol === "data:") return true;
  const sameOrigin =
    url.host === location.host && /^(https?|wss?):$/.test(url.protocol);
  if (sameOrigin) return !/^\/(api|ws)(\/|$)/.test(url.pathname);
  return ALLOWED_ORIGINS.has(url.origin);
}

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : String(input);

function installNetworkAllowlist(): void {
  if (typeof window === "undefined") return;

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) =>
    isAllowedUrl(urlOf(input))
      ? realFetch(input, init)
      : Promise.reject(new TypeError("Failed to fetch"));

  const RealWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(RealWebSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>) {
      if (!isAllowedUrl(args[0])) throw new DOMException("Blocked", "SecurityError");
      return new target(...args);
    },
  });

  if (window.EventSource) {
    window.EventSource = new Proxy(window.EventSource, {
      construct(target, args: ConstructorParameters<typeof EventSource>) {
        if (!isAllowedUrl(args[0])) throw new DOMException("Blocked", "SecurityError");
        return new target(...args);
      },
    });
  }

  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => isAllowedUrl(url) && realBeacon(url, data);
  }

  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    if (!isAllowedUrl(url)) throw new DOMException("Blocked", "SecurityError");
    return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
}

installNetworkAllowlist();

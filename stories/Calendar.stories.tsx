import { useLayoutEffect, useState } from "react";
import { AppMount } from "./mount";

// Story stub: the Worker is never called. Slots are next weekdays at 10:00; /cal/book answers 200 locally.
const stubWorker = (Story: () => JSX.Element) => <Stubbed Story={Story} />;

// Installed before the app mounts (render waits for it), restored on unmount so other stories keep the real fetch.
const Stubbed = ({ Story }: { Story: () => JSX.Element }) => {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const real = window.fetch;
    const slot = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(10, 0, 0, 0); return x.toISOString(); };
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (!u.includes("qntns-reads.qstaley921.workers.dev")) return real(input, init);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (u.includes("/cal/slots")) return json({ slots: [0, 1, 2].map(slot) });
      if (u.includes("/cal/event")) return json({ locations: [{ type: "link", label: "Video call" }, { type: "phone", label: "Phone" }] });
      return json({}); // /cal/book and anything else: no network
    }) as typeof fetch;
    setReady(true);
    return () => { window.fetch = real; };
  }, []);
  return ready ? <Story /> : null;
};

export default { title: "Apps/Calendar", component: AppMount, args: { id: "calendar" }, decorators: [stubWorker] };
export const Empty = {}; // alts: add named exports with { args: { initialData } }

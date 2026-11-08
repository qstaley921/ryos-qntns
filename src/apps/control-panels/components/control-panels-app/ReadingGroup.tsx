import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ControlPanelsPrefFormRow } from "./ControlPanelsPrefFormRow";

// "Reading" group (CHECKLIST-35 §58): the site settings from the theme's
// settings-menu.js besides sound (dropped, Q16). Subscribe mirrors the theme's row: GET/PUT /members/api/member, signed in
// only. A failed call leaves the switch where it was, silently.
const MEMBER_API = "/members/api/member";

const memberApi = async (body?: { subscribed: boolean }) => {
  const res = await fetch(MEMBER_API, {
    method: body ? "PUT" : "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(String(res.status));
  const nl = (await res.json())?.newsletters;
  return Array.isArray(nl) ? nl.length > 0 : undefined;
};

export function ReadingGroup({ signedIn }: { signedIn: boolean }) {
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    memberApi()
      .then((on) => on !== undefined && setSubscribed(on))
      .catch(() => {});
  }, [signedIn]);

  const toggle = async (want: boolean) => {
    if (busy) return;
    setBusy(true);
    setSubscribed(want);
    try {
      const got = await memberApi({ subscribed: want });
      setSubscribed(got ?? want);
    } catch {
      setSubscribed(!want);
    }
    setBusy(false);
  };

  return (
    <div className="control-panels-pref-form-section">
      <div className="text-[13px] font-geneva-12 font-medium mb-2">Reading</div>
      {signedIn && (
        <ControlPanelsPrefFormRow label="Subscribe" description="Email me new posts">
          <Switch
            checked={subscribed}
            onCheckedChange={toggle}
            className="data-[state=checked]:bg-[#000000]"
          />
        </ControlPanelsPrefFormRow>
      )}
    </div>
  );
}

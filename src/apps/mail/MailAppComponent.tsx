import { useEffect, useRef, useState } from "react";
import { AppProps } from "@/apps/base/types";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { AppMenuBarMenus } from "@/components/shared/menubar/AppMenuBarMenus";
import { checkContact, sendMessage } from "./api";
import { contactKey, formatContact } from "./contact";
import { SendIcon } from "./SendIcon";

const PAUSE = 800;
const INVALID = "Invalid phone number/email";
const NOT_LISTED = "Not in QNTNs contact. Try again or send without verification.";

// Send-only compose window: no inbox, no mailboxes.
export function MailAppComponent({
  isWindowOpen,
  isForeground,
  onClose,
  instanceId,
  skipInitialSound,
  onNavigateNext,
  onNavigatePrevious,
}: AppProps) {
  const { isWindowsTheme } = useThemeFlags();
  const chrome = useAppMenuBarChrome("mail", "Mail");
  const [contact, setContact] = useState("");
  const [valid, setValid] = useState(false);
  const [message, setMessage] = useState("");
  const [matched, setMatched] = useState(false);
  const [help, setHelp] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const known = useRef(new Map<string, boolean>());
  const turn = useRef(0);

  // After a pause on a valid contact: check once per distinct value.
  useEffect(() => {
    const mine = ++turn.current;
    setMatched(false);
    if (!contact) return setHelp("");
    if (!valid) {
      setHelp("");
      const t = setTimeout(() => setHelp(INVALID), PAUSE);
      return () => clearTimeout(t);
    }
    setHelp("");
    const t = setTimeout(async () => {
      const key = await contactKey(contact);
      let ok = known.current.get(key);
      if (ok === undefined) {
        const r = await checkContact(key);
        if (r === null) return; // unknown: no mark, no help
        ok = r;
        known.current.set(key, ok);
      }
      if (mine !== turn.current) return;
      setMatched(ok);
      if (!ok) setHelp(NOT_LISTED);
    }, PAUSE);
    return () => clearTimeout(t);
  }, [contact, valid]);

  const canSend = !sending && !sent && message.trim() !== "";

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setHelp("");
    setStatus("Sending…");
    try {
      // The key goes only when the check matched, so the email never disagrees with the screen.
      await sendMessage(message.trim(), matched ? await contactKey(contact) : "");
      setContact("");
      setSent(true);
      setStatus("Sent. Thank you.");
    } catch {
      setStatus("Couldn't send. Try again.");
    }
    setSending(false);
  };

  const field = "flex items-center gap-2 border-b border-black/20 px-3 py-1.5 text-[13px]";
  const label = "w-16 shrink-0 text-right text-black/50";

  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={isWindowsTheme}
      isForeground={isForeground}
      menuBar={
        <AppMenuBarShell
          isWindowsTheme={chrome.isWindowsTheme}
          isMacOSTheme={chrome.isMacOSTheme}
          appId={chrome.appId}
          appName={chrome.appName}
          isShareDialogOpen={chrome.isShareDialogOpen}
          setIsShareDialogOpen={chrome.setIsShareDialogOpen}
        >
          <AppMenuBarMenus
            menus={[
              {
                label: "File",
                items: [
                  { type: "action", label: "Send", onClick: send, disabled: !canSend },
                  { type: "separator" },
                  { type: "action", label: "Close", onClick: onClose, shortcutId: "close" },
                ],
              },
            ]}
          />
        </AppMenuBarShell>
      }
      windowFrameProps={{
        title: "New Message",
        onClose,
        isForeground,
        appId: "mail",
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
      }}
    >
      <div className="flex h-full w-full flex-col bg-white text-black">
        {/* Mail 2–3 New Message toolbar: icon in a glossy capsule, label under it.
            Only Send does anything here, so Attach/Address/Fonts/Colors are left out.
            Budget: 8 pad + 28 capsule + 4 gap + 16 label + 8 pad = 64px; 1px rule exempt. */}
        <div className="flex items-center justify-between border-b border-black/30 bg-gradient-to-b from-[#e8e8e8] to-[#c4c4c4] px-3 py-2">
          <button
            type="button"
            onClick={send}
            aria-disabled={!canSend}
            className={`flex w-16 flex-col items-center gap-1 ${canSend ? "" : "opacity-50"}`}
          >
            <span className="flex h-7 w-10 items-center justify-center rounded-full border border-black/40 bg-gradient-to-b from-white via-[#ececec] to-[#bdbdbd] shadow-[inset_0_1px_0_white] active:from-[#d0d0d0] active:to-[#a8a8a8]">
              <SendIcon />
            </span>
            <span className="h-4 text-[12px] leading-4 text-black/80">
              {sending ? "Sending…" : "Send"}
            </span>
          </button>
          <span className="text-[12px] text-black/60">
            {matched ? "Verified" : "Unverified"}
          </span>
        </div>
        <label className={field}>
          <span className={label}>To:</span>
          <span className="flex-1">QNTN</span>
        </label>
        <label className={field}>
          <span className={label}>From:</span>
          <input
            className="flex-1 bg-transparent outline-none"
            placeholder="Phone or email"
            autoComplete="off"
            inputMode="email"
            value={contact}
            readOnly={sending || sent}
            aria-invalid={!!contact && !valid && help === INVALID}
            onChange={(e) => {
              const next = formatContact(e.target.value);
              setContact(next.value);
              setValid(next.valid);
              setStatus("");
            }}
          />
        </label>
        <div className={`${field} min-h-[28px] text-[12px]`} aria-live="polite">
          <span className={label} />
          <span className="flex-1 text-black/60">
            {help || status || "Feedback is anonymous: only a one-way key of your contact is sent."}
          </span>
        </div>
        <textarea
          className="min-h-0 flex-1 resize-none bg-white p-3 text-[13px] outline-none"
          placeholder="What is it like being on the other side of me?"
          value={message}
          readOnly={sending || sent}
          onChange={(e) => {
            setMessage(e.target.value);
            setStatus("");
          }}
        />
      </div>
    </AppWindowShell>
  );
}

import { useEffect, useState } from "react";
import { AppProps } from "@/apps/base/types";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { AppMenuBarMenus } from "@/components/shared/menubar/AppMenuBarMenus";
import { sendMessage } from "./api";
import { formatEmail, isPersonal } from "./contact";
import { SendIcon } from "./SendIcon";

const PAUSE = 800;
const INVALID = "Invalid email";
const NOT_PERSONAL = "Use your personal email (Gmail, iCloud, Outlook…).";

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
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [subject, setSubject] = useState("Say hello");
  const [valid, setValid] = useState(false);
  const [message, setMessage] = useState("");
  const [help, setHelp] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // After a pause on a typed email: say what is wrong with it.
  useEffect(() => {
    setHelp("");
    if (!contact || (valid && isPersonal(contact))) return;
    const t = setTimeout(() => setHelp(valid ? NOT_PERSONAL : INVALID), PAUSE);
    return () => clearTimeout(t);
  }, [contact, valid]);

  // Mirrors the Worker: name ≤100, no control chars; a valid email; a message.
  const nameOk = name.trim() !== "" && name.trim().length <= 100;
  const canSend = !sending && !sent && nameOk && valid && isPersonal(contact) && message.trim() !== "";

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setHelp("");
    setStatus("Sending…");
    try {
      await sendMessage({
        message: message.trim(),
        name: name.trim(),
        email: contact,
        subject: subject.trim(),
      });
      setSent(true);
      setStatus("Sent. Thank you.");
    } catch {
      setStatus("Couldn't send. Try again.");
    }
    setSending(false);
  };

  const field = "flex items-center gap-2 border-b border-black/20 px-3 py-2 text-[13px]";
  const label = "shrink-0 text-black/50";

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
        {/* Mail 2–3 New Message toolbar: Send (icon in a glossy
            capsule, label under it) at the right end. Attach/Address/Fonts/Colors left out.
            Budget: 8 pad + 28 capsule + 4 gap + 16 label + 8 pad = 64px.
*/}
        <div className="flex items-center justify-between border-b border-black/30 bg-gradient-to-b from-[#e8e8e8] to-[#c4c4c4] px-3 py-2">
          <span />
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
        </div>
        <label className={field}>
          <span className={label}>To:</span>
          <span className="flex-1">QNTN</span>
        </label>
        <label className={field}>
          <span className={label}>Name:</span>
          <input
            className="flex-1 bg-transparent outline-none"
            placeholder="Your name"
            autoComplete="name"
            maxLength={100}
            required
            value={name}
            readOnly={sending || sent}
            onChange={(e) => {
              // No control chars: the Worker refuses a name with any (CR/LF are headers).
              setName(e.target.value.replace(/[\u0000-\u001f\u007f]/g, ""));
              setStatus("");
            }}
          />
        </label>
        <label className={field}>
          <span className={label}>From:</span>
          <input
            className="flex-1 bg-transparent outline-none"
            type="email"
            placeholder="Your email"
            autoComplete="email"
            inputMode="email"
            required
            value={contact}
            readOnly={sending || sent}
            aria-invalid={!!help}
            onChange={(e) => {
              const next = formatEmail(e.target.value);
              setContact(next.value);
              setValid(next.valid);
              setStatus("");
            }}
          />
        </label>
        <label className={field}>
          <span className={label}>Subject:</span>
          <input
            className="flex-1 bg-transparent outline-none"
            autoComplete="off"
            maxLength={200}
            value={subject}
            readOnly={sending || sent}
            onChange={(e) => {
              setSubject(e.target.value.replace(/[\u0000-\u001f\u007f]/g, ""));
              setStatus("");
            }}
          />
        </label>
        {/* Live region stays mounted (announcements need it present before text arrives); the row's border and height only exist while there is text. */}
        <div
          className={help || status ? `${field} min-h-[28px] text-[12px]` : "sr-only"}
          aria-live="polite"
        >
          <span className="flex-1 text-black/60">{help || status}</span>
        </div>
        <textarea
          className="min-h-0 flex-1 resize-none bg-white p-3 text-[13px] outline-none"
          placeholder="Write your message…"
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

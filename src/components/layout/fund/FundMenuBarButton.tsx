import { useState } from "react";
import { FundDialog } from "./FundDialog";

// Opens on load after a Stripe return (?funded=1) so the thanks line shows.
export function FundMenuBarButton() {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get("funded") === "1");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center h-full px-2"
        aria-haspopup="dialog"
      >
        Fund
      </button>
      <FundDialog isOpen={open} onOpenChange={setOpen} />
    </>
  );
}

import type React from "react";
import { cn } from "@/lib/utils";
import { IpodWheel } from "../IpodWheel";
import { IpodScreenArea } from "./IpodScreenArea";
import type { IpodAppController } from "./useIpodAppController";

// Green 1st-gen iPod mini (CHECKLIST-36 §56), drawn in CSS: an anodised
// aluminium tube (lit across its width, where the long edges curve away) with
// light plastic end caps. 224×400 keeps the mini's 51:91 mm face (0.56).
// Height budget: cap 12 + top gap 16 + LCD 152 + gap 28 + wheel 160 = 368; 32 left below.
const MINI_BODY: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  background: [
    "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, rgba(0,0,0,0.035) 1px 2px)",
    "linear-gradient(90deg, #7f9757 0%, #a5bd74 10%, #c4d79a 30%, #d2e2aa 46%, #bdd292 64%, #a3bb72 88%, #829a5a 100%)",
  ].join(", "),
  boxShadow: "0 8px 24px rgba(40,52,24,0.35), inset 0 0 0 1px rgba(60,78,34,0.45)",
};
const MINI_CAP: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  height: 12,
  background: "linear-gradient(90deg, #c9cbc4, #eceee8 40%, #e2e4dd 70%, #c4c6bf)",
  borderStyle: "solid",
  borderWidth: 0,
  borderColor: "rgba(70,80,60,0.35)",
};

type IpodDeviceBodyProps = {
  c: IpodAppController;
};

export function IpodDeviceBody({ c }: IpodDeviceBodyProps) {
  const {
    containerRef,
    theme,
    scale,
    handleWheelClick,
    handleWheelRotation,
    handleWheelGestureEnd,
    handleSectorHold,
    handleMenuButton,
    handleCenterLongPress,
  } = c;
  const mini = theme === "mini";
  const width = mini ? "224px" : "250px";

  return (
    <div
      ref={containerRef}
      className="ipod-device-surface ipod-force-font flex flex-col items-center justify-center w-full h-full p-4 select-none"
      style={{ position: "relative", overflow: "hidden", contain: "layout style paint" }}
    >
      <div
        className={cn(
          "ipod-force-font h-[400px] flex flex-col items-center",
          mini
            ? "w-[224px] rounded-[12px] px-4 pt-7"
            : "w-[250px] rounded-2xl shadow-xl border border-black/40 p-4 pb-8",
          !mini && (theme === "classic" ? "bg-white/85" : "bg-black/85")
        )}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center",
          transition: "transform 0.2s ease",
          minWidth: width,
          minHeight: "400px",
          maxWidth: width,
          maxHeight: "400px",
          contain: "layout style paint",
          willChange: "transform",
          backfaceVisibility: "hidden",
          ...(mini ? MINI_BODY : null),
        }}
      >
        {mini && <div aria-hidden style={{ ...MINI_CAP, top: 0, borderBottomWidth: 1 }} />}
        {mini && <div aria-hidden style={{ ...MINI_CAP, bottom: 0, borderTopWidth: 1 }} />}
        {mini ? (
          // The mini's screen is monochrome: everything on it goes grey, cover art included.
          <div className="w-full" style={{ filter: "grayscale(1) contrast(0.92)" }}>
            <IpodScreenArea c={c} />
          </div>
        ) : (
          <IpodScreenArea c={c} />
        )}
        <IpodWheel
          theme={theme}
          onWheelClick={handleWheelClick}
          onWheelRotation={handleWheelRotation}
          onWheelGestureEnd={handleWheelGestureEnd}
          onSectorHold={handleSectorHold}
          onMenuButton={handleMenuButton}
          onCenterLongPress={handleCenterLongPress}
        />
      </div>
    </div>
  );
}

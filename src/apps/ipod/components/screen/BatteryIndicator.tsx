import { isModernIpodUiVariant } from "../../constants";

interface BatteryIndicatorProps {
  backlightOn: boolean;
  /** Classic = monochrome blue 4-bar; modern = continuous green fill. */
  variant?: "classic" | "modern";
}

/** Always drawn full. No battery reads, no charging animation. */
export function BatteryIndicator({
  backlightOn,
  variant = "classic",
}: BatteryIndicatorProps) {
  const isModern = isModernIpodUiVariant(variant);

  if (isModern) {
    // Compact iPod nano 6G/7G battery: 14×7 pill slot in the 16px titlebar.
    return (
      <div className="flex items-center">
        <div className="relative h-[9px] w-[14px] shrink-0 overflow-hidden ipod-modern-battery-container">
          <div
            className="absolute inset-y-0 left-0 ipod-modern-battery-fill"
            style={{ width: "100%" }}
          />
        </div>
        <div className="-ml-[1px] h-[5px] w-[2px] shrink-0 ipod-modern-battery-cap" />
      </div>
    );
  }

  return (
    <div className="flex items-center">
      {/* Battery outline */}
      <div className="relative w-[19px] h-[10px] border border-[#0a3667] bg-transparent">
        {/* Battery bars: all four filled */}
        <div className="absolute inset-[1px] flex gap-[1px]">
          {[1, 2, 3, 4].map((bar) => (
            <div key={bar} className="flex-1 h-full bg-[#0a3667]" />
          ))}
        </div>
      </div>
      {/* Battery tip */}
      <div className="w-[2px] h-[4px] bg-[#0a3667] relative">
        <div
          className={`w-[2px] h-[2px] absolute top-[1px] left-[-2px] right-[0px] mx-auto ${
            backlightOn ? "bg-[#c5e0f5]" : "bg-[#8a9da9]"
          }`}
        />
      </div>
    </div>
  );
}

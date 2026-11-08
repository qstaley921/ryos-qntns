import { useCallback, useMemo } from "react";
import { useAppHelpAboutDialogs } from "@/hooks/useAppHelpAboutDialogs";
import { useTranslation } from "react-i18next";
import { useTranslatedHelpItems } from "@/hooks/useTranslatedHelpItems";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useDashboardStore, type WidgetType } from "@/stores/useDashboardStore";
import { helpItems } from "../metadata";
import { QNTNS_WIDGETS, isQntnsWidget, type QntnsWidgetType } from "../widgets";
import { useShallow } from "zustand/react/shallow";
import { Emoji } from "@/components/shared/Emoji";

export function useDashboardLogic() {
  const { t } = useTranslation();
  const helpItemsWithEmojiIcons = useMemo(
    () =>
      helpItems.map((item) => ({
        ...item,
        icon: <Emoji emoji={item.icon} size={20} />,
      })),
    []
  );
  const translatedHelpItems = useTranslatedHelpItems(
    "dashboard",
    helpItemsWithEmojiIcons
  );

  const { currentTheme, isWindowsTheme } = useThemeFlags();

  const {
    isHelpDialogOpen,
    setIsHelpDialogOpen,
    isAboutDialogOpen,
    setIsAboutDialogOpen,
  } = useAppHelpAboutDialogs();

  const {
    widgets,
    mobileOrder,
    addWidget,
    removeWidget,
    moveWidget,
    reorderMobileWidgets,
    bringToFront,
    resetToDefaults,
  } = useDashboardStore(
    useShallow((state) => ({
      widgets: state.widgets,
      mobileOrder: state.mobileOrder,
      addWidget: state.addWidget,
      removeWidget: state.removeWidget,
      moveWidget: state.moveWidget,
      reorderMobileWidgets: state.reorderMobileWidgets,
      bringToFront: state.bringToFront,
      resetToDefaults: state.resetToDefaults,
    }))
  );

  const handleAddWidget = useCallback(
    (type: QntnsWidgetType) => {
      const size = { ...QNTNS_WIDGETS.find((w) => w.type === type)!.size };

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 20;
      const padding = 20;
      const bottomReserved = 120;

      const currentWidgets = useDashboardStore.getState().widgets.filter((w) => isQntnsWidget(w.type));
      const maxZ = Math.max(0, ...currentWidgets.map((w) => w.zIndex ?? 0));

      const overlaps = (
        cx: number,
        cy: number,
        cw: number,
        ch: number
      ): boolean =>
        currentWidgets.some((w) => {
          const wx = w.position.x - padding;
          const wy = w.position.y - padding;
          const ww = w.size.width + padding * 2;
          const wh = w.size.height + padding * 2;
          return cx < wx + ww && cx + cw > wx && cy < wy + wh && cy + ch > wy;
        });

      const step = 20;
      const maxX = vw - size.width - margin;
      const maxY = vh - size.height - bottomReserved;
      let placed = false;
      let x = margin;
      let y = margin;

      for (let cy = margin; cy <= maxY; cy += step) {
        for (let cx = margin; cx <= maxX; cx += step) {
          if (!overlaps(cx, cy, size.width, size.height)) {
            x = cx;
            y = cy;
            placed = true;
            break;
          }
        }
        if (placed) break;
      }

      if (!placed) {
        const cascade = (currentWidgets.length % 10) * 30;
        x = Math.max(margin, Math.min(margin + cascade, maxX));
        y = Math.max(margin, Math.min(margin + cascade, maxY));
      }

      // The store types only ryOS's widgets; it persists any string, and the overlay renders only ours.
      addWidget({ type: type as unknown as WidgetType, position: { x, y }, size, zIndex: maxZ + 1 });
    },
    [addWidget]
  );

  return {
    t,
    translatedHelpItems,
    currentTheme,
    isWindowsTheme,
    isHelpDialogOpen,
    setIsHelpDialogOpen,
    isAboutDialogOpen,
    setIsAboutDialogOpen,
    widgets,
    mobileOrder,
    handleAddWidget,
    removeWidget,
    moveWidget,
    reorderMobileWidgets,
    bringToFront,
    resetToDefaults,
  };
}

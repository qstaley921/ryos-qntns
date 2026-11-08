import { useTranslation } from "react-i18next";
import { AppMenuBarMenus } from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppStoreShallow } from "@/stores/useAppStore";

/**
 * §57a fallback for a front app that renders no menu bar: File ▸ Close Window
 * only (the bold app menu already has About/Quit). Never Finder's menus.
 * MacTopMenuBar should render `children ?? <FallbackAppMenus />` for an active app.
 */
export function FallbackAppMenus() {
  const { t } = useTranslation();
  const { id, close } = useAppStoreShallow((s) => ({
    id: s.foregroundInstanceId,
    close: s.closeAppInstance,
  }));
  return (
    <AppMenuBarMenus
      menus={[
        {
          label: t("common.menu.file"),
          items: [
            {
              type: "action",
              label: t("common.menu.close"),
              onClick: () => id && close(id),
              shortcutId: "close",
            },
          ],
        },
      ]}
    />
  );
}

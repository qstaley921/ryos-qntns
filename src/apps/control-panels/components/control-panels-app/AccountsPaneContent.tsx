import { useState } from "react";
import { ThemedIcon } from "@/components/shared/ThemedIcon";
import type { AIModel } from "@/types/aiModels";
import type { AIModelInfo } from "@/types/aiModels";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LanguageCode } from "@/stores/useLanguageStore";
import type { RealtimeConnectionState } from "@/lib/pusherClient";
import type { Contact } from "@/utils/contacts";
import type { TelegramLinkedAccount } from "@/api/telegram";
import { cn } from "@/lib/utils";
import type { TabStyleConfig } from "@/utils/tabStyles";
import {
  SYSTEM_FONT_OPTIONS,
  THEME_DEFAULT_SYSTEM_FONT,
  type SystemFontId,
} from "@/themes/systemFonts";
import { controlPanelItemIconShell } from "./constants";
import { ReadingGroup } from "./ReadingGroup";
import { AccountProfileHeader } from "./AccountProfileHeader";
import { ControlPanelsPrefFormRow } from "./ControlPanelsPrefFormRow";
import {
  ELEVENLABS_TTS_VOICES,
  getTtsVoiceLabel,
  OPENAI_TTS_VOICES,
} from "./ttsVoiceOptions";
import type { EmailStatusResponse } from "@/shared/contracts/auth";
import { useControlPanelsTabClasses } from "./useControlPanelsTabClasses";
import type { ControlPanelPaneId } from "./controlPanelsCategories";

export type AccountsPaneContentProps = {
  t: (key: string, opts?: Record<string, unknown>) => string;
  tabStyles: TabStyleConfig;
  username: string | null;
  myContact: Contact | null;
  accountAvatarLabel: string;
  accountAvatarInitials: string;
  realtimeStatus: RealtimeConnectionState;
  accountJoinedAt?: number | null;
  locale: LanguageCode;
  debugMode: boolean;
  isAdmin: boolean;
  promptSetUsername: () => void;
  promptLogin: () => void;
  telegramLinkedAccount: TelegramLinkedAccount | null;
  openTelegramDialog: () => void;
  isTelegramStatusLoading: boolean;
  recoveryEmailStatus: EmailStatusResponse | null;
  isEmailStatusLoading: boolean;
  refreshRecoveryEmailStatus: () => Promise<EmailStatusResponse | null>;
  logout: () => void;
  handleLogoutAllDevices: () => void;
  isLoggingOutAllDevices: boolean;
  setPasswordInput: (value: string) => void;
  setPasswordError: (error: string | null) => void;
  setIsPasswordDialogOpen: (open: boolean) => void;
  setDebugMode: (enabled: boolean) => void;
  showResizers: boolean;
  setShowResizers: (enabled: boolean) => void;
  systemFont: SystemFontId;
  setSystemFont: (font: SystemFontId) => void;
  AI_MODELS: AIModelInfo[];
  aiModel: AIModel | null;
  setAiModel: (model: AIModel | null) => void;
  ttsModel: "openai" | "elevenlabs" | null;
  setTtsModel: (model: "openai" | "elevenlabs" | null) => void;
  ttsVoice: string | null;
  setTtsVoice: (voice: string | null) => void;
  handleShowBootScreen: () => void;
  handleTriggerAppCrashTest: () => void;
  handleTriggerDesktopCrashTest: () => void;
  onNavigateToPane?: (paneId: ControlPanelPaneId) => void;
};

type AccountsPaneTab = "accounts" | "debug";

export function AccountsPaneContent({
  t,
  username,
  myContact,
  accountAvatarLabel,
  accountAvatarInitials,
  realtimeStatus,
  accountJoinedAt,
  locale,
  debugMode,
  isAdmin,
  promptSetUsername,
  promptLogin,
  logout,
  setDebugMode,
  showResizers,
  setShowResizers,
  systemFont,
  setSystemFont,
  AI_MODELS,
  aiModel,
  setAiModel,
  ttsModel,
  setTtsModel,
  ttsVoice,
  setTtsVoice,
  handleShowBootScreen,
  handleTriggerAppCrashTest,
  handleTriggerDesktopCrashTest,
}: AccountsPaneContentProps) {
  const [accountsTab, setAccountsTab] = useState<AccountsPaneTab>("accounts");
  const { barClassName, triggerClassName, triggerStyle } =
    useControlPanelsTabClasses();
  const selectedSystemFont =
    SYSTEM_FONT_OPTIONS.find((option) => option.id === systemFont) ??
    SYSTEM_FONT_OPTIONS[0];


  return (
    <div className="control-panels-pref-form control-panels-pref-form-tabbed h-full overflow-y-auto">
      <div className="control-panels-pref-tabbed">
        <AccountProfileHeader
          t={t}
          username={username}
          myContact={myContact}
          accountAvatarLabel={accountAvatarLabel}
          accountAvatarInitials={accountAvatarInitials}
          realtimeStatus={realtimeStatus}
          accountJoinedAt={accountJoinedAt}
          locale={locale}
          promptSetUsername={promptSetUsername}
          promptLogin={promptLogin}
        />
        <div
          role="tablist"
          className={cn("control-panels-pref-tab-bar", barClassName)}
          aria-label={t("apps.control-panels.panes.accounts")}
        >
          <button
            type="button"
            role="tab"
            className={triggerClassName}
            style={triggerStyle}
            data-state={accountsTab === "accounts" ? "active" : "inactive"}
            aria-selected={accountsTab === "accounts"}
            onClick={() => setAccountsTab("accounts")}
          >
            {t("apps.control-panels.accountsTabs.accounts")}
          </button>
          {isAdmin && (
            <button
              type="button"
              role="tab"
              className={triggerClassName}
              style={triggerStyle}
              data-state={accountsTab === "debug" ? "active" : "inactive"}
              aria-selected={accountsTab === "debug"}
              onClick={() => setAccountsTab("debug")}
            >
              {t("apps.control-panels.accountsTabs.debug")}
            </button>
          )}
        </div>
        <div className="control-panels-pref-well">
          <div
            role="tabpanel"
            className="control-panels-pref-tab-panel"
            hidden={accountsTab !== "accounts"}
            aria-hidden={accountsTab !== "accounts"}
          >
            {/* Ghost member account (CHECKLIST-37 §29): sign in and create
                account live in the header above; signed in, this is sign out.
                ryOS's recovery email, Telegram and .Mac rows need its account
                server, so they are gone. */}
            {username && (
              <div className="control-panels-pref-form-section">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <ThemedIcon
                      name="mail.png"
                      alt=""
                      className={cn(controlPanelItemIconShell, "object-contain")}
                    />
                    <span className="text-[13px] font-geneva-12 font-medium truncate">
                      {username}
                    </span>
                  </div>
                  <Button variant="retro" onClick={logout} className="h-7">
                    {t("common.auth.logOut")}
                  </Button>
                </div>
              </div>
            )}
            <ReadingGroup signedIn={!!username} />
          </div>
          {isAdmin && (
            <div
              role="tabpanel"
              className="control-panels-pref-tab-panel"
              hidden={accountsTab !== "debug"}
              aria-hidden={accountsTab !== "debug"}
            >
              <div className="control-panels-pref-form-section">
                <ControlPanelsPrefFormRow
                  label={t("apps.control-panels.debugMode")}
                  description={t("apps.control-panels.debugModeDescription")}
                >
                  <Switch
                    checked={debugMode}
                    onCheckedChange={setDebugMode}
                    className="data-[state=checked]:bg-[#000000]"
                  />
                </ControlPanelsPrefFormRow>
                {debugMode && (
                  <>
                    <ControlPanelsPrefFormRow
                      label={t("apps.control-panels.showResizers")}
                      description={t("apps.control-panels.showResizersDescription")}
                    >
                      <Switch
                        checked={showResizers}
                        onCheckedChange={setShowResizers}
                        className="data-[state=checked]:bg-[#000000]"
                      />
                    </ControlPanelsPrefFormRow>
                    <ControlPanelsPrefFormRow
                      label={t("apps.control-panels.systemFont")}
                      description={t("apps.control-panels.systemFontDescription")}
                    >
                      <Select
                        value={systemFont}
                        onValueChange={(value) => setSystemFont(value as SystemFontId)}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder={t("apps.control-panels.select")}>
                            {systemFont === THEME_DEFAULT_SYSTEM_FONT
                              ? t("apps.control-panels.systemFontThemeDefault")
                              : selectedSystemFont.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="system-font-select-content">
                          {SYSTEM_FONT_OPTIONS.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.id === THEME_DEFAULT_SYSTEM_FONT
                                ? t("apps.control-panels.systemFontThemeDefault")
                                : option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </ControlPanelsPrefFormRow>
                    {isAdmin && (
                    <ControlPanelsPrefFormRow
                      label={t("apps.control-panels.aiModel")}
                      description={t("apps.control-panels.aiModelDescription")}
                    >
                      <Select
                        value={
                          aiModel &&
                          AI_MODELS.some((model) => model.id === aiModel)
                            ? aiModel
                            : "__null__"
                        }
                        onValueChange={(value) =>
                          setAiModel(value === "__null__" ? null : (value as AIModel))
                        }
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder={t("apps.control-panels.select")}>
                            {aiModel || t("apps.control-panels.select")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__null__">
                            {t("apps.control-panels.default")}
                          </SelectItem>
                          {AI_MODELS.map((model) => (
                            <SelectItem key={model.id} value={model.id as string}>
                              {model.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </ControlPanelsPrefFormRow>
                    )}
                    <ControlPanelsPrefFormRow
                      label={t("apps.control-panels.ttsModel")}
                      description={t("apps.control-panels.ttsModelDescription")}
                    >
                      <Select
                        value={ttsModel || "__null__"}
                        onValueChange={(value) =>
                          setTtsModel(
                            value === "__null__"
                              ? null
                              : (value as "openai" | "elevenlabs")
                          )
                        }
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder={t("apps.control-panels.select")}>
                            {ttsModel || t("apps.control-panels.select")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__null__">
                            {t("apps.control-panels.default")}
                          </SelectItem>
                          <SelectItem value="openai">
                            {t("apps.control-panels.openai")}
                          </SelectItem>
                          <SelectItem value="elevenlabs">
                            {t("apps.control-panels.elevenlabs")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </ControlPanelsPrefFormRow>
                    {ttsModel && (
                      <ControlPanelsPrefFormRow
                        label={t("apps.control-panels.ttsVoice")}
                        description={
                          ttsModel === "elevenlabs"
                            ? t("apps.control-panels.elevenlabsVoiceId")
                            : t("apps.control-panels.openaiVoice")
                        }
                      >
                        {ttsModel === "elevenlabs" ? (
                          <Select
                            value={ttsVoice || "__null__"}
                            onValueChange={(value) =>
                              setTtsVoice(value === "__null__" ? null : value)
                            }
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue placeholder={t("apps.control-panels.select")}>
                                {getTtsVoiceLabel(
                                  t,
                                  "elevenlabs",
                                  ttsVoice,
                                  t("apps.control-panels.select")
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__null__">
                                {t("apps.control-panels.select")}
                              </SelectItem>
                              {ELEVENLABS_TTS_VOICES.map((voice) => (
                                <SelectItem key={voice.value} value={voice.value}>
                                  {t(voice.labelKey)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Select
                            value={ttsVoice || "__null__"}
                            onValueChange={(value) =>
                              setTtsVoice(value === "__null__" ? null : value)
                            }
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue placeholder={t("apps.control-panels.select")}>
                                {getTtsVoiceLabel(
                                  t,
                                  "openai",
                                  ttsVoice,
                                  t("apps.control-panels.select")
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__null__">
                                {t("apps.control-panels.select")}
                              </SelectItem>
                              {OPENAI_TTS_VOICES.map((voice) => (
                                <SelectItem key={voice.value} value={voice.value}>
                                  {t(voice.labelKey)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </ControlPanelsPrefFormRow>
                    )}
                    <ControlPanelsPrefFormRow
                      label={t("apps.control-panels.bootScreen")}
                      description={t("apps.control-panels.bootScreenDescription")}
                    >
                      <Button
                        type="button"
                        variant="retro"
                        onClick={handleShowBootScreen}
                        className="w-fit"
                      >
                        {t("apps.control-panels.show")}
                      </Button>
                    </ControlPanelsPrefFormRow>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="retro"
                        onClick={handleTriggerAppCrashTest}
                        className="flex-1"
                      >
                        {t("apps.control-panels.crashApp")}
                      </Button>
                      <Button
                        type="button"
                        variant="retro"
                        onClick={handleTriggerDesktopCrashTest}
                        className="flex-1"
                      >
                        {t("apps.control-panels.crashDesktop")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

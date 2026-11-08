import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  ThemedTabsList,
  ThemedTabsTrigger,
  ThemedTabsContent,
} from "@/components/shared/ThemedTabs";

// Sign in is the subscribe (CHECKLIST-37 §29): both tabs take one email and
// Ghost mails a magic link. The props are ryOS's own so every caller still
// compiles; the "username" fields carry the email, the password props are
// unused (Ghost has no passwords, so no reset or recovery email either).
interface LoginDialogProps {
  /* Common */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** When the dialog opens, choose which tab is active first */
  initialTab?: "login" | "signup";

  /* Login fields */
  usernameInput: string;
  onUsernameInputChange: (value: string) => void;
  passwordInput: string;
  onPasswordInputChange: (value: string) => void;
  onLoginSubmit: () => Promise<void>;
  isLoginLoading: boolean;
  loginError: string | null;

  /* Sign-up fields */
  newUsername: string;
  onNewUsernameChange: (value: string) => void;
  newPassword: string;
  onNewPasswordChange: (value: string) => void;
  onSignUpSubmit: () => Promise<void>;
  isSignUpLoading: boolean;
  signUpError: string | null;
}

export function LoginDialog({
  isOpen,
  onOpenChange,
  initialTab = "login",
  usernameInput,
  onUsernameInputChange,
  onLoginSubmit,
  isLoginLoading,
  loginError,
  newUsername,
  onNewUsernameChange,
  onSignUpSubmit,
  isSignUpLoading,
  signUpError,
}: LoginDialogProps) {
  const [activeTab, setActiveTab] = useState<"login" | "signup">(initialTab);
  const { isWindowsTheme, isMacOSTheme } = useThemeFlags();
  const { t } = useTranslation();
  const dialogTitle = t("common.auth.dialogTitle");

  // Reset to the initial tab whenever the dialog is reopened
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (activeTab === "login") {
      if (!isLoginLoading) await onLoginSubmit();
    } else if (!isSignUpLoading) {
      await onSignUpSubmit();
    }
  };

  const themeFont = isWindowsTheme
    ? "font-['Pixelated_MS_Sans_Serif',Arial] text-[11px]"
    : "font-geneva-12 text-[12px]";

  const themeFontStyle: React.CSSProperties | undefined = isWindowsTheme
    ? {
        fontFamily: '"Pixelated MS Sans Serif", "ArkPixel", Arial',
        fontSize: "11px",
      }
    : undefined;

  const emailField = (
    value: string,
    onChange: (v: string) => void,
    focus: boolean,
    disabled: boolean
  ) => (
    <div className="space-y-2">
      <Label className={cn("text-neutral-700", themeFont)} style={themeFontStyle}>
        Email
      </Label>
      <Input
        type="email"
        autoComplete="email"
        autoFocus={focus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("shadow-none h-8", themeFont)}
        style={themeFontStyle}
        disabled={disabled}
      />
    </div>
  );

  const isActionLoading =
    activeTab === "login" ? isLoginLoading : isSignUpLoading;
  const activeError = activeTab === "login" ? loginError : signUpError;
  const activeEmail = activeTab === "login" ? usernameInput : newUsername;

  // Close when an action finishes without an error.
  const prevLoading = React.useRef(isActionLoading);
  useEffect(() => {
    if (isOpen && prevLoading.current && !isActionLoading && !activeError) {
      onOpenChange(false);
    }
    prevLoading.current = isActionLoading;
  }, [isOpen, isActionLoading, activeError, onOpenChange]);

  const dialogContent = (
    <div className="pt-3 pb-6 px-6">
      <form onSubmit={handleSubmit}>
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "login" | "signup")}
          className="w-full"
        >
          <ThemedTabsList className="w-full">
            <ThemedTabsTrigger value="signup">
              {t("common.auth.createAccount")}
            </ThemedTabsTrigger>
            <ThemedTabsTrigger value="login">
              {t("common.auth.logIn")}
            </ThemedTabsTrigger>
          </ThemedTabsList>

          <ThemedTabsContent value="signup">
            <div className="p-4">
              {emailField(newUsername, onNewUsernameChange, activeTab === "signup", isSignUpLoading)}
            </div>
          </ThemedTabsContent>

          <ThemedTabsContent value="login">
            <div className="p-4">
              {emailField(usernameInput, onUsernameInputChange, activeTab === "login", isLoginLoading)}
            </div>
          </ThemedTabsContent>
        </Tabs>

        {activeError && (
          <p
            className={cn("text-red-600 mt-3", themeFont)}
            style={themeFontStyle}
          >
            {activeError}
          </p>
        )}

        <DialogFooter className="mt-6 gap-1.5 sm:justify-end">
          <Button
            type="submit"
            variant="retro"
            disabled={isActionLoading || !activeEmail.trim()}
            className={cn("w-full sm:w-auto h-7", themeFont)}
            style={themeFontStyle}
          >
            {isActionLoading
              ? activeTab === "login"
                ? t("common.auth.loggingIn")
                : t("common.auth.creatingAccount")
              : activeTab === "login"
              ? t("common.auth.logIn")
              : t("common.auth.createAccount")}
          </Button>
        </DialogFooter>
      </form>
    </div>
  );

  const srDescription = (
    <DialogDescription className="sr-only">
      {activeTab === "login"
        ? t("common.auth.loginDescription")
        : t("common.auth.signupDescription")}
    </DialogDescription>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("max-w-[400px]", isWindowsTheme && "p-0 overflow-hidden")}
        style={isWindowsTheme ? { fontSize: "11px" } : undefined}
        onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
      >
        {isWindowsTheme ? (
          <>
            {/* The themed titlebar is decorative; expose an accessible name/description for screen readers. */}
            <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
            {srDescription}
            <DialogHeader>{dialogTitle}</DialogHeader>
            <div className="window-body">{dialogContent}</div>
          </>
        ) : isMacOSTheme ? (
          <>
            <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
            {srDescription}
            <DialogHeader>{dialogTitle}</DialogHeader>
            {dialogContent}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-normal text-[16px]">
                {dialogTitle}
              </DialogTitle>
              {srDescription}
            </DialogHeader>
            {dialogContent}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

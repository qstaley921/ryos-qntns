// Sign in is the subscribe (CHECKLIST-37 §29): the ryOS dialogs in front of a
// Ghost member, by magic link. No ryOS account server is called. The exported
// names are ryOS's own so every caller still compiles; the password and token
// ones are inert (Ghost has neither).
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useMember, sendMagicLink, signOut } from "@/lib/ghost/members";

const FAIL = "Couldn't send. Try again.";
const sent = (email: string) =>
  toast.success("Check your email", {
    description: `We sent a sign-in link to ${email.trim()}.`,
  });

export function useAuth() {
  const member = useMember();
  const username = member ? member.email : null;
  const isAuthenticated = !!member;

  const [isUsernameDialogOpen, setIsUsernameDialogOpen] = useState(false);
  const [usernameDialogInitialTab, setUsernameDialogInitialTab] = useState<
    "login" | "signup"
  >("signup");
  // Create-account email (ryOS's "new username" field).
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSettingUsername, setIsSettingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const [isVerifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyTokenInput, setVerifyTokenInput] = useState("");
  const [verifyPasswordInput, setVerifyPasswordInput] = useState("");
  // Sign-in email (ryOS's "username" field).
  const [verifyUsernameInput, setVerifyUsernameInput] = useState("");
  const [isVerifyingToken, setIsVerifyingToken] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [isLogoutConfirmDialogOpen, setIsLogoutConfirmDialogOpen] =
    useState(false);

  const openUsernameDialog = useCallback((tab: "login" | "signup") => {
    setNewUsername("");
    setUsernameError(null);
    setUsernameDialogInitialTab(tab);
    setIsUsernameDialogOpen(true);
  }, []);

  const promptSetUsername = useCallback(() => {
    openUsernameDialog("signup");
  }, [openUsernameDialog]);

  const promptLogin = useCallback(() => {
    openUsernameDialog("login");
  }, [openUsernameDialog]);

  // Create account: a Ghost member on the signup newsletters (= subscribe).
  const submitUsernameDialog = useCallback(async () => {
    setIsSettingUsername(true);
    setUsernameError(null);
    try {
      await sendMagicLink(newUsername, "signup");
      sent(newUsername);
      setIsUsernameDialogOpen(false);
      setNewUsername("");
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : FAIL);
    } finally {
      setIsSettingUsername(false);
    }
  }, [newUsername]);

  const promptVerifyToken = useCallback(() => {
    setVerifyUsernameInput("");
    setVerifyError(null);
    setVerifyDialogOpen(true);
  }, []);

  // Sign in. ryOS's signature is kept; its password/token argument is ignored.
  const handleVerifyTokenSubmit = useCallback(
    async (_input?: string, _isPassword?: boolean) => {
      setIsVerifyingToken(true);
      setVerifyError(null);
      try {
        await sendMagicLink(verifyUsernameInput, "signin");
        sent(verifyUsernameInput);
        setVerifyDialogOpen(false);
        setIsUsernameDialogOpen(false);
      } catch (err) {
        setVerifyError(err instanceof Error ? err.message : FAIL);
      } finally {
        setIsVerifyingToken(false);
      }
    },
    [verifyUsernameInput]
  );

  // Ghost has no passwords.
  const setPassword = useCallback(
    async (_password: string, _currentPassword: string) => ({
      ok: false as const,
      error: "This account signs in by email link; it has no password.",
    }),
    []
  );

  const promptLogout = useCallback(async () => {
    setIsLogoutConfirmDialogOpen(true);
  }, []);

  const confirmLogout = useCallback(() => {
    setIsLogoutConfirmDialogOpen(false);
    void signOut();
  }, []);

  return {
    username,
    isAuthenticated,

    promptSetUsername,
    promptLogin,
    usernameDialogInitialTab,
    isUsernameDialogOpen,
    setIsUsernameDialogOpen,
    newUsername,
    setNewUsername,
    newPassword,
    setNewPassword,
    isSettingUsername,
    usernameError,
    submitUsernameDialog,
    setUsernameError,

    promptVerifyToken,
    isVerifyDialogOpen,
    setVerifyDialogOpen,
    verifyTokenInput,
    setVerifyTokenInput,
    verifyPasswordInput,
    setVerifyPasswordInput,
    verifyUsernameInput,
    setVerifyUsernameInput,
    isVerifyingToken,
    verifyError,
    handleVerifyTokenSubmit,

    setPassword,

    logout: promptLogout,
    confirmLogout,
    isLogoutConfirmDialogOpen,
    setIsLogoutConfirmDialogOpen,
  };
}

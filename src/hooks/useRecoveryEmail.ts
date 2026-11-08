import type { EmailStatusResponse } from "@/shared/contracts/auth";

// Inert (CHECKLIST-37 §29): a Ghost member's email is the account, so there is
// no recovery email and no ryOS account server to ask. Shape kept for callers.
const refreshRecoveryEmailStatus = async (): Promise<EmailStatusResponse | null> => null;

export function useRecoveryEmail(_opts: {
  username?: string | null;
  isAuthenticated?: boolean;
}) {
  return {
    recoveryEmailStatus: null as EmailStatusResponse | null,
    isEmailStatusLoading: false,
    refreshRecoveryEmailStatus,
  };
}

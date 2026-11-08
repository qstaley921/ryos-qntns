// Inert (CHECKLIST-37 §29): the join date came from the ryOS account server,
// which a Ghost member never calls. Shape kept for callers.
const refreshAccountJoinDate = async (): Promise<number | null> => null;

export function useAccountJoinDate(_opts: {
  username?: string | null;
  isAuthenticated?: boolean;
}) {
  return { accountJoinedAt: null as number | null, refreshAccountJoinDate };
}

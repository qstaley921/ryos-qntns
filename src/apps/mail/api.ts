// The one Worker origin. Every call optional; check is silent on failure.
const FEEDBACK_URL = "https://qntns-reads.qstaley921.workers.dev/feedback";
const post = (url: string, body: unknown, ms: number) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });

// true / false from the Worker, else null (unknown: no mark, no help).
export const checkContact = async (key: string): Promise<boolean | null> => {
  try {
    const res = await post(FEEDBACK_URL + "/check", { key }, 4000);
    if (!res.ok) return null;
    const { match } = await res.json();
    return typeof match === "boolean" ? match : null;
  } catch {
    return null;
  }
};

// Throws on failure; the caller shows "Couldn't send. Try again."
export const sendMessage = async (message: string, key: string) => {
  const res = await post(FEEDBACK_URL, { message, key }, 8000);
  if (!res.ok) throw new Error();
};

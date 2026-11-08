// The one Worker origin.
const FEEDBACK_URL = "https://qntns-reads.qstaley921.workers.dev/feedback";
const post = (url: string, body: unknown, ms: number) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });

// Throws on failure; the caller shows "Couldn't send. Try again."
export type Outgoing = { message: string; name: string; email: string; subject: string };
export const sendMessage = async (body: Outgoing) => {
  const res = await post(FEEDBACK_URL, body, 8000);
  if (!res.ok) throw new Error();
};

// Ported from QNTNs-ghost assets/js/qntns/{contact-key,goal-feedback}.js (formatContact).
// The contact is only read to derive the key; only the key is ever sent.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

const mask = (d: string) =>
  d.length <= 3
    ? `(${d}`
    : d.length <= 6
      ? `(${d.slice(0, 3)}) ${d.slice(3)}`
      : `(${d.slice(0, 3)}) ${d.slice(3, 6)} - ${d.slice(6)}`;

export const formatContact = (raw: string) => {
  const text = raw.replace(/\s+/g, "");
  if (!text) return { value: "", valid: false };
  if (/^[\d(]/.test(text) && !text.includes("@")) {
    const digits = text.replace(/\D/g, "").slice(0, 10);
    return { value: digits ? mask(digits) : "", valid: digits.length === 10 };
  }
  const value = text.toLowerCase();
  return { value, valid: EMAIL.test(value) };
};

const normaliseContact = (s: string) => {
  const t = s.trim();
  if (t.includes("@")) return t.toLowerCase();
  const d = t.replace(/\D/g, "");
  return d.length === 10 ? "1" + d : d;
};

export const contactKey = async (s: string) => {
  const n = normaliseContact(s);
  if (!n) return "";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(n));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

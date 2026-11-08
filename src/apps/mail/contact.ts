// The email goes with the message (§81b).
// Same strict check as worker/src/feedback.js, so a valid field is never a 400.
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export const formatEmail = (raw: string) => {
  const value = raw.replace(/\s+/g, "").toLowerCase().slice(0, 254);
  return { value, valid: EMAIL.test(value) };
};

// Consumer mail providers only (§81d). Keep in step with PERSONAL_DOMAINS in
// QNTNs-ghost worker/src/feedback.js. shortcut: a custom personal domain is refused, edit the list.
const PERSONAL = new Set(["gmail.com","googlemail.com","icloud.com","me.com","mac.com","outlook.com","hotmail.com","live.com","msn.com","yahoo.com","ymail.com","aol.com","proton.me","protonmail.com","pm.me","hey.com","fastmail.com","gmx.com","zoho.com"]);
export const isPersonal = (email: string) => PERSONAL.has(email.slice(email.lastIndexOf("@") + 1));

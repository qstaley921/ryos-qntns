import { BaseApp } from "../base/types";
import { MailAppComponent } from "./MailAppComponent";

export const appMetadata = {
  name: "Mail",
  version: "1.0",
  creator: { name: "QNTN", url: "https://qntns.com" },
  github: "",
  icon: "/icons/default/mail.png", // asset not shipped yet; registry owner to supply
};
export const helpItems = [
  { icon: "✉️", title: "Write to QNTN", description: "One compose window: your name and email, a subject if you like, a message, Send." },
];

export const MailApp: BaseApp = {
  id: "mail",
  name: "Mail",
  icon: { type: "image", src: appMetadata.icon },
  description: "Send a message to QNTN",
  component: MailAppComponent,
  helpItems,
  metadata: appMetadata,
};

import { MailAppComponent } from "@/apps/mail/MailAppComponent";

export default {
  title: "Apps/Mail",
  component: MailAppComponent,
  args: { isWindowOpen: true, isForeground: true, onClose: () => {}, instanceId: "story-mail" },
};
export const Default = {};

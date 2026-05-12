import { runCommand } from "./command";
import type { NotificationBackend } from "./types";

export const linuxNotificationBackend: NotificationBackend = {
  available: ({ platform }) => platform === "linux",
  send: (notification) =>
    runCommand("notify-send", [notification.title, notification.body]).then(() => undefined),
};

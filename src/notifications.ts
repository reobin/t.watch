import { commandExitsZero } from "./notification-backends/command";
import { hyprlandVisibilityBackend } from "./notification-backends/hyprland";
import { linuxNotificationBackend } from "./notification-backends/linux";
import { macosNotificationBackend, macosVisibilityBackend } from "./notification-backends/macos";
import type {
  AgentNotification,
  NotificationBackend,
  Visibility,
  VisibilityBackend,
  VisibilityContext,
} from "./notification-backends/types";

export type { AgentNotification, Visibility } from "./notification-backends/types";

export type NotifyOptions = {
  visibleCommand?: string;
  notifyOnUnknownVisibility?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pid?: number;
};

const defaultNotifyOnUnknownVisibility = true;

export async function notifyWhenThudHidden(
  notification: AgentNotification,
  options: NotifyOptions = {},
): Promise<void> {
  const visibility = await thudVisibility(options);
  const notifyOnUnknownVisibility =
    options.notifyOnUnknownVisibility ??
    shouldNotifyOnUnknownVisibility(options.env ?? process.env);

  if (visibility === "visible" || (visibility === "unknown" && !notifyOnUnknownVisibility)) {
    return;
  }

  await sendNotification(notification, options.platform ?? process.platform);
}

export async function thudVisibility(options: NotifyOptions = {}): Promise<Visibility> {
  const env = options.env ?? process.env;
  const context: VisibilityContext = {
    env,
    pid: options.pid ?? process.pid,
    platform: options.platform ?? process.platform,
    visibleCommand: options.visibleCommand ?? env.THUD_NOTIFY_VISIBLE_COMMAND,
  };

  for (const backend of visibilityBackends) {
    if (!backend.available(context)) {
      continue;
    }

    const visibility = await backend.visibility(context);

    if (visibility !== "unknown") {
      return visibility;
    }
  }

  return "unknown";
}

export function shouldNotifyOnUnknownVisibility(env: NodeJS.ProcessEnv): boolean {
  const value = env.THUD_NOTIFY_ON_UNKNOWN_VISIBILITY;

  if (value === undefined) {
    return defaultNotifyOnUnknownVisibility;
  }

  return value !== "0" && value.toLowerCase() !== "false";
}

async function sendNotification(
  notification: AgentNotification,
  platform: NodeJS.Platform,
): Promise<void> {
  const context = { platform };
  const backend = notificationBackends.find((backend) => backend.available(context));

  if (backend) {
    await backend.send(notification);
  }
}

const notificationBackends: NotificationBackend[] = [
  macosNotificationBackend,
  linuxNotificationBackend,
];

const visibilityBackends: VisibilityBackend[] = [
  {
    available: ({ visibleCommand }) => Boolean(visibleCommand),
    visibility: async ({ visibleCommand }) =>
      visibleCommand && (await commandExitsZero(visibleCommand)) ? "visible" : "hidden",
  },
  hyprlandVisibilityBackend,
  macosVisibilityBackend,
];

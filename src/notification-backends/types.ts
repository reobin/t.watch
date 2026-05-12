export type AgentNotification = {
  title: string;
  body: string;
};

export type Visibility = "visible" | "hidden" | "unknown";

export type CommandResult = {
  exitCode: number;
  stdout: string;
};

export type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

export type VisibilityContext = {
  env: NodeJS.ProcessEnv;
  pid: number;
  platform: NodeJS.Platform;
  visibleCommand?: string;
};

export type VisibilityBackend = {
  available: (context: VisibilityContext) => boolean;
  visibility: (context: VisibilityContext) => Promise<Visibility>;
};

export type NotificationContext = {
  platform: NodeJS.Platform;
};

export type NotificationBackend = {
  available: (context: NotificationContext) => boolean;
  send: (notification: AgentNotification) => Promise<void>;
};

type OpenCodeEvent = {
  type: string;
  properties?: {
    reply?: string;
    status?: {
      type?: string;
    };
  };
};

type OpenCodePluginContext = {
  $: typeof Bun.$;
};

const tool = "opencode";
const thudRefreshChannel = "thud-sh-sessions";

export const ThudShStatus = async ({ $ }: OpenCodePluginContext) => {
  const pane = process.env.TMUX_PANE;
  let currentStatus = "unknown";
  let currentLabel: string | undefined;
  let statusBeforeRequest: string | undefined;
  let statusUpdate = Promise.resolve();

  async function setStatus(status: string, label?: string): Promise<void> {
    if (status === currentStatus && label === currentLabel) {
      return;
    }

    currentStatus = status;
    currentLabel = label;

    if (!pane) {
      return;
    }

    const updatedAt = Math.floor(Date.now() / 1000).toString();

    if (label) {
      await $`tmux set-option -p -t ${pane} @thud_sh_tool ${tool} \; set-option -p -t ${pane} @thud_sh_status ${status} \; set-option -p -t ${pane} @thud_sh_status_updated_at ${updatedAt} \; set-option -p -t ${pane} @thud_sh_status_label ${label} \; wait-for -S ${thudRefreshChannel}`.quiet();
      return;
    }

    await $`tmux set-option -p -t ${pane} @thud_sh_tool ${tool} \; set-option -p -t ${pane} @thud_sh_status ${status} \; set-option -p -t ${pane} @thud_sh_status_updated_at ${updatedAt} \; set-option -pu -t ${pane} @thud_sh_status_label \; wait-for -S ${thudRefreshChannel}`.quiet();
  }

  function queueStatus(status: string, label?: string): Promise<void> {
    statusUpdate = statusUpdate.then(() => setStatus(status, label));

    return statusUpdate;
  }

  async function requestStatus(): Promise<void> {
    if (currentStatus !== "waiting") {
      statusBeforeRequest = currentStatus;
    }

    await queueStatus("waiting");
  }

  async function restoreStatusAfterRequest(): Promise<void> {
    if (currentStatus !== "waiting") {
      return;
    }

    const restoredStatus = statusBeforeRequest === "idle" ? "idle" : "running";
    statusBeforeRequest = undefined;

    await queueStatus(restoredStatus);
  }

  async function rejectRequestStatus(): Promise<void> {
    if (currentStatus !== "waiting") {
      return;
    }

    statusBeforeRequest = undefined;

    await queueStatus("idle");
  }

  await queueStatus("idle");

  return {
    event: async ({ event }: { event: OpenCodeEvent }) => {
      if (event.type === "session.status") {
        const status = event.properties?.status?.type;

        if (status === "busy") {
          await queueStatus("running");
          return;
        }

        if (status === "retry") {
          await queueStatus("running");
          return;
        }

        if (status === "idle") {
          await queueStatus("idle");
          return;
        }

        await queueStatus("unknown");
        return;
      }

      if (event.type === "session.idle") {
        await queueStatus("idle");
        return;
      }

      if (event.type === "session.error") {
        await queueStatus("error");
        return;
      }

      if (event.type === "permission.asked") {
        await requestStatus();
        return;
      }

      if (event.type === "permission.replied") {
        if (event.properties?.reply === "reject") {
          await rejectRequestStatus();
          return;
        }

        await restoreStatusAfterRequest();
        return;
      }

      if (event.type === "question.asked") {
        await requestStatus();
        return;
      }

      if (event.type === "question.replied") {
        await restoreStatusAfterRequest();
        return;
      }

      if (event.type === "question.rejected") {
        await rejectRequestStatus();
      }
    },
  };
};

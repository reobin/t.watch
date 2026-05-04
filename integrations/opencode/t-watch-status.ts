type OpenCodeEvent = {
  type: string
  properties?: {
    status?: {
      type?: string
    }
  }
}

type OpenCodePluginContext = {
  $: typeof Bun.$
}

const tool = "opencode"

export const TWatchStatus = async ({ $ }: OpenCodePluginContext) => {
  const pane = process.env.TMUX_PANE

  async function setStatus(status: string, label?: string): Promise<void> {
    if (!pane) {
      return
    }

    const updatedAt = Math.floor(Date.now() / 1000).toString()

    await $`tmux set-option -p -t ${pane} @t_watch_tool ${tool}`.quiet()
    await $`tmux set-option -p -t ${pane} @t_watch_status ${status}`.quiet()
    await $`tmux set-option -p -t ${pane} @t_watch_status_updated_at ${updatedAt}`.quiet()

    if (label) {
      await $`tmux set-option -p -t ${pane} @t_watch_status_label ${label}`.quiet()
    } else {
      await $`tmux set-option -pu -t ${pane} @t_watch_status_label`.quiet()
    }
  }

  await setStatus("idle")

  return {
    event: async ({ event }: { event: OpenCodeEvent }) => {
      if (event.type === "session.status") {
        const status = event.properties?.status?.type

        if (status === "busy") {
          await setStatus("working")
          return
        }

        if (status === "retry") {
          await setStatus("working")
          return
        }

        if (status === "idle") {
          await setStatus("idle")
          return
        }

        await setStatus("unknown")
        return
      }

      if (event.type === "session.idle") {
        await setStatus("idle")
        return
      }

      if (event.type === "session.error") {
        await setStatus("error")
        return
      }

      if (event.type === "permission.asked") {
        await setStatus("requesting")
        return
      }

      if (event.type === "permission.replied") {
        await setStatus("working")
      }
    },
  }
}

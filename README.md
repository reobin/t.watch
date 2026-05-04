# t.watch

A tiny tmux session watcher for the terminal.

It shows running tmux sessions, windows, panes, and optional pane status from integrations such as OpenCode.

## Usage

```sh
bun install
bun run start
```

Run tests:

```sh
bun test
```

## OpenCode Integration

Load `integrations/opencode/t-watch-status.ts` as an OpenCode plugin to publish pane status into tmux options for `t.watch`.

# t.watch

A tiny tmux session watcher for the terminal.

It shows running tmux sessions, windows, panes, and optional pane status from integrations such as OpenCode.

## Usage

Install globally from npm:

```sh
npm install -g @reobin/t.watch
t.watch
```

Or run from source:

```sh
bun install
bun run start
```

Run tests:

```sh
bun test
```

Build and inspect the npm package:

```sh
bun run build
npm pack --dry-run
```

Publish:

```sh
npm login
npm publish
```

## OpenCode Integration

Load `integrations/opencode/t-watch-status.ts` as an OpenCode plugin to publish pane status into tmux options for `t.watch`.

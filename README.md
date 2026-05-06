# thud.sh

A tiny terminal HUD for watching tmux sessions, panes, and agent status.

It shows running tmux sessions, windows, panes, and optional pane status from integrations such as OpenCode.

## Usage

Install globally from npm:

```sh
npm install -g thud.sh
thud version
thud
thud attention
```

Inside the HUD, press `j`/`k` or arrows to select sessions, `Enter` to focus the
selected session, `a` to focus the next attention pane, and `q` to quit.

`thud attention` focuses the next pane with an integration status in this order:
`requesting`, `idle`, then `working`. If nothing matches, it exits without
changing focus.

Example tmux binding:

```tmux
bind-key A run-shell 'thud attention'
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

Publish a release:

```sh
npm version patch
git push
git push --tags
```

The pushed version tag triggers GitHub Actions to test, build, pack, and publish the package to npm with provenance.

## OpenCode Integration

Add the plugin so OpenCode can publish its pane status into tmux for `thud.sh` to display:

```sh
opencode plugin thud.sh
```

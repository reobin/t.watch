# thud.sh

A tiny terminal HUD for watching tmux sessions, panes, and agent status.

It shows running tmux sessions, windows, panes, and optional pane status from integrations such as OpenCode.

## Usage

Install globally from npm:

```sh
npm install -g thud.sh
thud help
thud version
thud
thud --mode=popup
thud jump
```

Inside the HUD, the footer shows `Ctrl+P` for commands and `?` for help. Press
`?` to open the keyboard shortcut help panel.

Common shortcuts include `j`/`k` or arrows to select sessions, `Tab` to select
panes within the selected session, `Enter` to focus the selected session or
pane, `Esc` to leave pane navigation or close a panel, `J` to jump to the next
agent pane that needs attention, `Ctrl+P` to open the command panel, `m` to
cycle focus mode, and `q` to quit.

`thud jump` focuses the next pane with an integration status in this order:
`requesting`, `idle`, then `working`. If nothing matches, it exits without
changing focus.

Use `thud --mode=popup` for transient tmux popups. It closes after successfully
focusing a session or pane. Use `thud --close-on-focus` to enable the same
behavior in any mode.

Example tmux binding:

```tmux
bind-key J run-shell 'thud jump'
bind-key T display-popup -E -w 90% -h 90% 'thud --mode=popup'
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

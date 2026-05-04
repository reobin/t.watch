# thud.sh

A tiny terminal HUD for watching tmux sessions, panes, and agent status.

It shows running tmux sessions, windows, panes, and optional pane status from integrations such as OpenCode.

## Usage

Install globally from npm:

```sh
npm install -g thud.sh
thud.sh
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

Load `integrations/opencode/thud-sh-status.ts` as an OpenCode plugin to publish pane status into tmux options for `thud.sh`.

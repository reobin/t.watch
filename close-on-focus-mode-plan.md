# Thud Close-On-Focus And Popup Mode Plan

Status: implemented in this repo.

## Goal

Add a transient HUD mode for `thud` so it works well inside `tmux display-popup`, especially over SSH/Termius.

## CLI Options

Add:

- `--mode=default`
- `--mode=popup`
- `--close-on-focus`

Behavior:

- `thud` defaults to `--mode=default`
- `--mode=default` keeps thud open after focusing a tmux target
- `--mode=popup` enables close-on-focus automatically
- `--close-on-focus` enables close-on-focus in any mode
- `thud jump` remains unchanged because it already exits after focusing

## Implementation

- Add an app options type in `src/app.ts`
- Change `startApp()` to accept options
- Parse args in `src/cli.ts`
- Pass `{ closeOnFocus }` into `startApp`
- After `focusPaneForAllClients(...)` succeeds in the UI, call `renderer.destroy()` when `closeOnFocus` is true
- Keep failure behavior unchanged so focus errors remain visible
- Update help text to show `--mode=default|popup` and `--close-on-focus`

## Tests

- Add CLI tests for `thud --mode=default`
- Add CLI tests for `thud --mode=popup`
- Add CLI tests for `thud --close-on-focus`
- Add CLI tests rejecting invalid mode values
- Add app-level coverage if practical for close-on-focus behavior

## Phone/SSH Usage

Use tmux popup:

```tmux
bind T display-popup -E -w 90% -h 90% "thud --mode=popup"
```

This lets Termius users summon thud inside the current tmux client and have it close after selecting a target.

## Desktop Usage

Use regular thud for persistent desktop/scratchpad use:

```sh
thud
```

If desktop thud should close after selecting a target, run:

```sh
thud --close-on-focus
```

## PC Setup Plan

1. Add the thud CLI feature in `~/dev/thud.sh` first.
2. Update this dotfiles repo's tmux config to replace the moving left pane with a popup binding:

```tmux
bind T display-popup -E -w 90% -h 90% "thud --mode=popup"
```

3. Remove tmux auto-follow hooks that call `tmux-thud-follow.sh` on `client-attached` and `pane-focus-in`.
4. Add a Hyprland/Ghostty launcher for desktop thud:

```sh
ghostty --class=dev.reobin.thud --title=thud -e thud --close-on-focus
```

5. Add a Hyprland binding, likely `SUPER ALT T`, to launch or toggle the desktop thud window.
6. Add Hyprland window rules for `dev.reobin.thud` so it behaves like a floating/scratch HUD.
7. Validate with `hyprctl reload`, `hyprctl configerrors`, and tmux config reload.

One decision before implementation: should desktop thud be persistent until manually hidden, or should it close after selecting a tmux target like the phone popup?

# Next release — improvement list (dsh-oc-tui vs OpenCode)

Status: planning notes, nothing implemented. Compiled 2026-11-21 against
`dsh-oc-tui` `0.4.0-fork.1` (`main` @ `ea6f6b4`) and the OpenCode CLI docs as
published that day:
[TUI](https://opencode.ai/docs/cli/tui/),
[Keybinds](https://opencode.ai/docs/cli/keybinds/),
[Commands](https://opencode.ai/docs/cli/commands/),
[Theme](https://opencode.ai/docs/cli/theme/).
"Missing" below means a code search of `lib/` found no implementation; it is not
a claim about upstream plans.


## Status — 0.5.0-fork implementation

Done, verified by `npm run check` + `npm test` (2,640 checks) and a live boot:

| Item | Where | Notes |
| --- | --- | --- |
| P1.1 `@` file mentions | `lib/file-mentions.js` | Host `fileReferences` inside a session; DSH's own bounded workspace index on the title screen (no Agent exists yet). `@"quoted"`, `#10-20` ranges, no mentions inside `!`/`/` lines or mid-word. |
| P1.2 `!` shell mode | `lib/composer-shell.js` | Runs as the person (DSH user-terminal semantics), session cwd, cancels the whole process group, output bounded, carried into the next message as visible context. Not gated by the agent's permission preset. |
| P1.3 line editing | `lib/composer-edit.js` | `Ctrl+A/K/U/W`, `Alt+←/→` word moves, `Alt+Backspace`, grapheme-safe delete, `Alt+End`. `Ctrl+E`/`Ctrl+P` untouched. |
| P1.4 external editor | `lib/composer-editor.js` | `Ctrl+O` / `/editor`, `$VISUAL`/`$EDITOR`, no shell interpolation, suspend+restore. |
| P1.5 paste summary | `lib/ui.js` | >6 lines or >800 chars collapse to `[Paste: N lines]`; content unchanged, unfolded by editing. |
| P2.3 model picker | `lib/model-picker.js` | `/models`, filter, `*` favorites, `F2`/`Shift+F2` recent, per-provider timeouts. |
| Creator mode | `lib/cordis-inspect.js`, `terminal-host.patch.yml` | Mounts the Host inspect registry without the Web runner; Creator now loads in the TUI (Client-platform queries time out). |
| Bundle-order warning | `lib/bundle-order.js` | Warns when a reinstall put `dsh-oc-tui` after mirrored bundles. |
| `@` provider | `terminal-host.patch.yml` | Mounts `@deepseek-ai/dsh-file-reference-local` (also installs the model-side `@`-path guidance). |

Not done in this release (next tier): undo/redo (P1.6), keybinds + leader (P2.1), command palette
(P2.2), session search/rename/pin (P2.4), message navigation (P2.5), subagent browsing (P2.6),
queued-prompt editing (P2.7), diff viewer, light/system themes, `/btw`, terminal pane, tabs, stash,
`Ctrl+Z` suspend, OSC title, `/highlights`.

## Where dsh-oc-tui is already ahead — keep and polish

| Area | dsh-oc-tui | OpenCode |
| --- | --- | --- |
| Agent modes | DSH presets (Standard, PTC, Minimal, Creator), `/mode` picker, badge beside the effort | Agents via `Shift+Tab` / `/agents` (comparable) |
| Desktop parity | `dsh-tui` mirrors Desktop plugins and merges settings both ways | n/a |
| Images | kitty / iTerm2 / sixel with half-block fallback, pasted and stored images | text-only transcript |
| Diagrams | Mermaid rendered (mmdc → mermaid.ink) or native ASCII art | none |
| Approvals / questions | Inline approval box, option/multi-select/free-text questions, plan review | permission prompt (comparable) |
| Session statistics | Stats strip, stats window, context meter, status rail, goal and subagent sections | status view (`<leader>s`) |
| Folded process | Completed turns fold behind `Worked for …`, Web UI parity settings | `session.verbosity.cycle`, exploration grouping |
| Rewind | `Esc Esc` / `/rewind` forks before a prompt, optional git restore with backups | `/undo` / `/redo` (different model, see P1) |
| Languages | 17 UI languages | English |
| Extras | Git branch switcher, MCP tab, in-app updates, `Ctrl+S` framed screenshots | `opencode mcp`, `opencode upgrade` (CLI) |

## Gaps against OpenCode, prioritised

Each item: what OpenCode does → what to build → how (DSH surface to reuse).

### P1 — everyday editing and context (high value, mostly small)

1. **`@` file mentions.** OpenCode: `@` opens fuzzy file search; `@path#20-45`
   attaches a line range. Build: an autocomplete popup (reuse the slash
   palette) that inserts a file reference. How: the host's
   `fileReferences.list(agent, query, signal)` service already does cancellable
   discovery; send the reference the way the Web composer does.
   Accept: typing `@src/au` lists matches within 100 ms on a 10k-file repo;
   Enter inserts; the model receives the file.
2. **`!` shell mode.** OpenCode: `!git status` runs in the session cwd and the
   output stays in the session. Build: `!` on an empty prompt switches the
   composer to shell mode (distinct accent, Esc leaves). How: route through the
   session's bash tool / `terminals` service so the output is a durable event,
   not a local print.
3. **Composer line editing.** OpenCode: `Ctrl+A/E` line start/end,
   `Ctrl+K/U` delete to end/start, `Ctrl+W` / `Alt+Backspace` delete word,
   `Alt+←/→` word moves, `Shift+arrows` selection, `Ctrl+-` undo. Today only
   arrows, Home/End and Backspace exist. Build: a small readline-style editing
   table; add selection later. Keep `Ctrl+E` (effort slider) and `Ctrl+P`
   (settings) — remap the clashing ones behind a leader (see P2.1).
4. **External editor.** OpenCode: `<leader>e` / `/editor` opens `$VISUAL`/
   `$EDITOR` on the prompt. Build: suspend the TUI (`term.stop()`), spawn the
   editor on a temp file, restore, load text.
5. **Large paste summary.** OpenCode collapses big pastes to a chip
   (`[Pasted 120 lines]`) so the composer stays usable. Build: same, with the
   full text sent on submit.
6. **Undo / redo the last exchange.** OpenCode: `/undo` reverts the last user
   message and its work, puts the prompt back in the composer; `/redo`
   restores. Build on the existing rewind fork: `/undo` = rewind to the last
   prompt with conversation + files, prefill the composer; keep the parent
   session id so `/redo` switches back.

### P2 — navigation, sessions, discoverability

1. **Leader key + configurable keybinds.** OpenCode: `Ctrl+X` leader,
   `cli.json` keybind overrides, which-key panel. Build: a `keybinds` map in
   the `tui-app` Config (Settings → Keys), leader default `Ctrl+X`; move
   rarely used actions behind it (`<leader>n` new, `<leader>l` sessions,
   `<leader>m` models, `<leader>e` editor, `<leader>u/r` undo/redo).
2. **Command palette.** OpenCode `Ctrl+P` lists every action in the current
   view. Ours opens Settings. Build: a palette (actions + slash commands +
   settings pages), and move Settings to a palette entry / `<leader>,`.
3. **Model picker dialog + recent cycle.** OpenCode: `/models` dialog with
   favourites, `F2` cycles recent models. Ours: `/model <id>` text and the
   Settings Model tab. Build: picker overlay (reuse the mode picker) listing
   configured providers' models; `F2`/`Shift+F2` recent; star favourites.
4. **Session search, rename, pin.** OpenCode: session list with `Ctrl+R`
   rename, `Ctrl+F` pin, filter-as-you-type. How: `sessionQuery` (search),
   `workspaceRegistry.pinSession/unpinSession`; rename via the title event.
5. **Message navigation and copy.** OpenCode: jump to first/last/previous user
   message (`Home`/`End`, `Alt+End`), `<leader>y` copy message. Build: user-
   message jumps; copy the focused reply / code block via the existing OSC 52
   clipboard path.
6. **Subagent / child-session navigation.** OpenCode: `↓` opens the subagent
   picker, `←/→` siblings, `↑` parent. We show subagents in the rail only.
   How: `subagents.listDescendants`, open a child read-only in the transcript.
7. **Queued prompt management.** OpenCode `<leader>q` lists queued prompts,
   `Ctrl+U` undo, `Ctrl+D` delete. We show the pending inbox block. Build:
   make it interactive (edit/remove through the inbox splice API).

### P3 — larger features

1. **Diff viewer.** OpenCode: full-screen diff with file tree, hunks, split/
   unified, "mark reviewed", scopes (all / uncommitted / last turn). How: the
   host `workspaceChanges.summary/diff` service already serves per-turn
   summaries and file comparisons; render them in an overlay.
2. **Light themes, `system` theme, custom theme files.** Ours: five dark
   themes only. OpenCode: light/dark/system mode, terminal-palette `system`
   theme, JSON themes from `~/.config/opencode/themes` and `.opencode/themes`.
   Build: light variants, `mode: system` (query the terminal background with
   OSC 11), load `$DSH_HOME/tui-themes/*.json` and `.dsh/tui-themes`.
3. **Side questions (`/btw`).** Ask about the conversation without adding to
   it; answer in a dialog, `C` copies. How: a one-off `llm` request with the
   session's messages, not appended to the log.
4. **Embedded terminal pane.** OpenCode `<leader>t`. How: the `terminals` /
   `terminalController` services (PTY backends) the Web sidebar uses.
5. **Session tabs.** OpenCode keeps several sessions open as tabs
   (`Ctrl+Tab`). Bigger change: the TUI holds one live agent today.
6. **Prompt stash.** Stash / pop / list drafts.

### Small polish

- `Ctrl+Z` suspend (SIGTSTP) and resume cleanly.
- Terminal title via OSC 0/2 (session title), toggleable — complements the
  `deepseek` process name for terminals that show the title.
- `/highlights` "what's new" once after an update (we already know the
  installed version from the update manager).
- `session.toggle.thinking` equivalent: a one-key toggle for thinking boxes
  (today only the `showReasoning` config field).

## Known issues and debt found this cycle

- **Creator mode is unavailable in the TUI**: `tool-cordis` waits for the
  `cordisInspect` service, which only the Web host mounts. Options: mount the
  inspect providers in a TUI preset layer, or hide Creator from the roster.
- **Bundle order after `dsh plugin add`**: re-adding `dsh-oc-tui` appends it
  after mirrored bundles; `dsh-tui` reorders on the next launch, plain
  `dsh tui` does not. Consider a profile check in the plugin that warns.
- **Version gate upkeep**: every DSH release needs `npm run sync-presets`, a
  suite + live-boot run, and a `dshSupport.tested` entry. Script the
  checklist (`npm run verify-dsh`).
- **AGENTS.md installed-copy smoke test** assumes an npm-installed dsh; on the
  Desktop app plain Node cannot resolve the host packages inside `app.asar`.
  Document the Desktop path (run under `ELECTRON_RUN_AS_NODE` with the app's
  runtime) or a live pty check instead.
- **`dsh-tui` is POSIX-only** (shell wrapper for the `deepseek` process name);
  Windows uses `dsh-oc-tui`. A Windows equivalent would need a renamed
  `node.exe` hard link and a `.cmd` shim.
- **In-app update manager** compares against npm `dsh-oc-tui@latest`
  (upstream). A future upstream `0.4.0` would be offered over this fork;
  point the update source at the fork (GitHub releases) or label it.
- **Token cost is dominated by the skill catalog** (~28K tokens/request with
  ~330 installed skills), not by the TUI. A TUI-side hint in the stats window
  ("skills: 28K") would make that visible.
- **`dev` branch** is still upstream's `dev` (`6a3da58`), 6 commits behind
  `main`; decide reset-to-`main` vs merge before the next release.

## Suggested next-release scope

`0.5.0-fork`: P1.1 `@` mentions, P1.2 `!` shell, P1.3 line editing, P1.4
external editor, P1.5 paste summary, P2.3 model picker, plus the Creator-mode
fix and the bundle-order warning. P1.6 undo/redo and P2.1/P2.2
keybinds + palette are the next tier (they reshuffle shortcuts, so ship them
together with a migration note).

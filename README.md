# pi-fzf

A [Pi](https://github.com/badlogic/pi) extension for fuzzy finding. Define commands that list candidates from any shell command, then perform actions on the selected item—fill the editor, send to the agent, or run shell commands.

![demo](demo.gif)

## Installation

### From npm

```bash
pi install npm:pi-fzf
```

### From git

```bash
pi install github.com/kaofelix/pi-fzf
```

## Dependencies

The examples in this README use [`fd`](https://github.com/sharkdp/fd) for fast file finding. It's not installed by default on most systems:

| OS | Install command | Notes |
|----|-----------------|-------|
| macOS | `brew install fd` | |
| Ubuntu/Debian | `apt install fd-find` | Binary is `fdfind`, not `fd` (see below) |
| Fedora | `dnf install fd-find` | |
| Arch | `pacman -S fd` | |

### Ubuntu/Debian note

On Ubuntu and Debian, the binary is installed as `fdfind` to avoid conflicts. Either:
- Use `fdfind` in your commands instead of `fd`
- Create a symlink: `ln -s $(which fdfind) ~/.local/bin/fd`

You can also use standard `find` instead of `fd` if you prefer not to install additional tools.

## Configuration

Create a config file to define your commands:

- `~/.pi/agent/fzf.json` — global commands
- `<project>/.pi/fzf.json` — project-specific (overrides global)

Each command has a `list` (shell command that outputs candidates) and an `action` (what to do with the selection):

```json
{
  "commands": {
    "file": {
      "list": "fd --type f --max-depth 4",
      "action": "Read and explain {{selected}}"
    }
  }
}
```

This registers `/fzf:file` in Pi. The `{{selected}}` placeholder is replaced with the chosen candidate.

### Keyboard Shortcuts

Add a `shortcut` field to trigger a command via a keyboard shortcut instead of typing `/fzf:<name>`:

```json
{
  "commands": {
    "file": {
      "list": "fd --type f --max-depth 4",
      "action": "Read and explain {{selected}}",
      "shortcut": "ctrl+shift+f"
    }
  }
}
```

The shortcut format follows Pi's [keybinding syntax](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md#key-format): `modifier+key` where modifiers are `ctrl`, `shift`, `alt` (combinable).

### Selector Placement

You can control selector widget placement in two ways:

- Per-command via `placement`
- Globally via top-level `defaultPlacement`

Allowed values:

- `"overlay"` (default; classic floating panel)
- `"aboveEditor"`
- `"belowEditor"`

```json
{
  "defaultPlacement": "belowEditor",
  "commands": {
    "file": {
      "list": "fd --type f --max-depth 4",
      "action": "Read and explain {{selected}}"
    },
    "branch": {
      "list": "git branch --format='%(refname:short)'",
      "action": { "type": "bash", "template": "git checkout {{selected}}" },
      "placement": "aboveEditor"
    }
  }
}
```

Precedence: `command.placement` → `defaultPlacement` → `"overlay"`.

### Hide Header

Set `hideHeader: true` on a command to hide the selector title line (`fzf:<name>`).

```json
{
  "commands": {
    "file": {
      "list": "fd --type f --max-depth 4",
      "action": "Read and explain {{selected}}",
      "hideHeader": true
    }
  }
}
```

## Preview Pane

Commands can optionally display a preview pane showing content for the selected candidate. Add a `preview` field with a command template:

```json
{
  "commands": {
    "file": {
      "list": "fd --type f --max-depth 4",
      "action": "Read and explain {{selected}}",
      "preview": "bat --style=numbers --color=always {{selected}} 2>/dev/null || cat {{selected}}"
    }
  }
}
```

When `preview` is configured, the selector splits into two panes:
- **Left pane**: Candidate list (35% width)
- **Right pane**: Preview output (65% width)

The preview command receives the same `{{selected}}` placeholder as actions. Its output is displayed in the preview pane as you navigate through candidates.

**Keyboard shortcuts for preview:**
- `Shift+↑` / `Shift+↓` — Scroll preview content (default, configurable)
- Standard navigation keys work in the list pane

### Preview Settings

You can customize preview scrolling behavior in the `settings` section:

```json
{
  "settings": {
    "previewScrollUp": "shift+up",
    "previewScrollDown": "shift+down",
    "previewScrollLines": 5
  },
  "commands": { ... }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `previewScrollUp` | `shift+up` | Keybinding to scroll preview up |
| `previewScrollDown` | `shift+down` | Keybinding to scroll preview down |
| `previewScrollLines` | `5` | Number of lines to scroll at a time |

Keybindings use Pi's [keybinding syntax](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md#key-format): `modifier+key` (e.g., `alt+k`, `ctrl+u`).

## Actions



### Editor (default)

Pastes text into the Pi editor at the current cursor position (without replacing existing text). You can review and edit before sending.

```json
"action": "Explain {{selected}}"
```

Or explicitly:

```json
"action": { "type": "editor", "template": "Explain {{selected}}" }
```

### Send

Sends directly to the agent, triggering a turn immediately.

```json
"action": { "type": "send", "template": "Explain {{selected}}" }
```

### Bash

Runs a shell command. By default shows the result as a notification.

```json
"action": { "type": "bash", "template": "git checkout {{selected}}" }
```

Add `output` to route the command's stdout elsewhere:

| Output | Behavior |
|--------|----------|
| `"notify"` | Show as notification (default) |
| `"editor"` | Paste stdout into the editor at cursor |
| `"send"` | Send stdout to the agent |

```json
"action": {
  "type": "bash",
  "template": "cat {{selected}}",
  "output": "editor"
}
```

## Examples

### Override the `@` trigger for file selection

By default, typing `@` in Pi opens the autocomplete menu. You can override this to use pi-fzf for file selection instead:

```json
"file": {
  "list": "fd --type f",
  "action": "@{{selected}}",
  "shortcut": "@"
}
```

Now pressing `@` opens the fuzzy finder. Selecting a file inserts `@<filename>` into the editor, preserving Pi's file reference syntax.

This works for any key: use `!`, `$`, or any character as a custom trigger for your commands.

### Find files and ask the agent to explain them

```json
"file": {
  "list": "fd --type f --max-depth 4",
  "action": "Read and explain {{selected}}",
  "preview": "bat --style=numbers --color=always {{selected}} 2>/dev/null || cat {{selected}}"
}
```

### Load a skill by name

```json
"skill": {
  "list": "fd -L 'SKILL.md' ~/.pi/agent/skills ~/.pi/agent/git 2>/dev/null | sed -E 's|.*/skills/([^/]+)/SKILL\\.md|\\1|' | grep -v '/' | sort -u",
  "action": { "type": "editor", "template": "/skill:{{selected}}" }
}
```

### Switch git branches

```json
"branch": {
  "list": "git branch --format='%(refname:short)'",
  "action": { "type": "bash", "template": "git checkout {{selected}}" },
  "preview": "git log --oneline -10 {{selected}}"
}
```

### View git diff in editor

```json
"git-diff": {
  "list": "git diff --name-only",
  "action": {
    "type": "bash",
    "template": "git diff {{selected}}",
    "output": "editor"
  }
}
```

### Find files with TODOs

```json
"todo": {
  "list": "rg -l 'TODO|FIXME' || true",
  "action": { "type": "editor", "template": "Find and fix all TODOs in {{selected}}" }
}
```

A complete example config is available in [`examples/fzf.json`](examples/fzf.json).

## Usage

1. Type `/fzf:<name>` (e.g., `/fzf:file`) or press the configured shortcut
2. Type to filter candidates
3. Use ↑/↓ to navigate, Enter to select, Escape to cancel

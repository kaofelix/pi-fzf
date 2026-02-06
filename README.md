# pi-fzf

A [Pi](https://github.com/badlogic/pi) extension for fuzzy finding. Define commands that list candidates from any shell command, then perform actions on the selected item—fill the editor, send to the agent, or run shell commands.

## Installation

### From npm

```bash
pi install npm:pi-fzf
```

### From git

```bash
pi install github.com/kaofelix/pi-fzf
```

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

## Actions

### Editor (default)

Fills the Pi editor with text. You can review and edit before sending.

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
| `"editor"` | Put stdout in the editor |
| `"send"` | Send stdout to the agent |

```json
"action": {
  "type": "bash",
  "template": "cat {{selected}}",
  "output": "editor"
}
```

## Examples

### Find files and ask the agent to explain them

```json
"file": {
  "list": "fd --type f --max-depth 4",
  "action": "Read and explain {{selected}}"
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
  "action": { "type": "bash", "template": "git checkout {{selected}}" }
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

1. Type `/fzf:<name>` (e.g., `/fzf:file`)
2. Type to filter candidates
3. Use ↑/↓ to navigate, Enter to select, Escape to cancel

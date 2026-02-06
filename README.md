# pi-fzf

A [pi coding agent](https://github.com/badlogic/pi) extension that brings fzf-style fuzzy finding into the agent. Define commands in a config file, each with a shell command to generate candidates and an action to perform on the selected item.

## Installation

1. Clone this repo somewhere (e.g., `~/Code/pi-fzf`)
2. Install dependencies: `npm install`
3. Add to your pi settings (`~/.pi/agent/settings.json`):

```json
{
  "extensions": [
    "/path/to/pi-fzf"
  ]
}
```

Or symlink into the extensions directory:

```bash
ln -s ~/Code/pi-fzf ~/.pi/agent/extensions/pi-fzf
```

## Configuration

Create config files to define your fuzzy finder commands:

- `~/.pi/agent/fzf.json` — global config
- `<project>/.pi/fzf.json` — project-local (overrides global)

### Config format

```json
{
  "commands": {
    "<name>": {
      "list": "<bash command that outputs candidates, one per line>",
      "action": "<action>"
    }
  }
}
```

Each entry registers a `/fzf:<name>` slash command in pi.

### Actions

The `action` field defines what happens when you select a candidate. Use `{{selected}}` as a placeholder for the selected line.

**Short form** (defaults to `editor` type):

```json
{
  "action": "Explain the file {{selected}}"
}
```

**Long form**:

```json
{
  "action": {
    "type": "editor | send | bash",
    "template": "... {{selected}} ..."
  }
}
```

| Type | What it does |
|------|--------------|
| `editor` | Fills the pi editor. You can review and edit before sending. |
| `send` | Sends directly to the agent. Triggers a turn immediately. |
| `bash` | Runs a shell command. Shows result as notification. |

### Example config

```json
{
  "commands": {
    "file": {
      "list": "fd --type f --max-depth 4",
      "action": "Read and explain {{selected}}"
    },
    "skill": {
      "list": "find ~/.pi/agent/skills -name 'SKILL.md' | sed 's|.*/skills/||;s|/SKILL.md||'",
      "action": { "type": "editor", "template": "/skill:{{selected}}" }
    },
    "branch": {
      "list": "git branch --format='%(refname:short)'",
      "action": { "type": "bash", "template": "git checkout {{selected}}" }
    }
  }
}
```

## Usage

1. Type `/fzf:<name>` in pi (e.g., `/fzf:file`)
2. Type to fuzzy filter the candidates
3. Use ↑/↓ to navigate, Enter to select, Escape to cancel
4. The action runs with your selection

## Why inside pi?

Running bash commands from a fuzzy finder isn't special — any terminal can do that. The value is actions that **interact with the agent**: filling the editor with a prompt, sending a message, loading a skill, invoking a template.

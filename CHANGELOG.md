# Changelog

## [0.4.0] - 2026-02-07

### Added

- Support `selectPageUp` / `selectPageDown` keybindings for faster list navigation

### Fixed

- Truncate long candidates to prevent overflow past the box border
- Reuse `Fzf` instance instead of recreating it on every keystroke
- Use `ExtensionCommandContext` directly, removing unnecessary type cast

## [0.3.0] - 2026-02-07

### Changed

- Use pi editor keybindings (`selectUp`, `selectDown`, `selectConfirm`, `selectCancel`) for selector navigation instead of hardcoded keys

## [0.2.0] - 2026-02-06

### Added

- Keyboard shortcut support for fzf commands
- Space-separated search terms (extended match)
- `output` option for bash actions (`editor`, `send`, or `notify`)
- Demo video/GIF in README
- CI publish workflow with npm provenance
- Vitest tests for config module
- Lefthook pre-commit hooks (format + test)
- Git-diff example configuration

### Fixed

- Add repository URL for npm provenance verification

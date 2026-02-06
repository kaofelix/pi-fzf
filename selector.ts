import type { Focusable } from "@mariozechner/pi-tui";
import {
  Container,
  Input,
  Key,
  matchesKey,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { extendedMatch, Fzf, type FzfResultItem } from "fzf";

export interface SelectorTheme {
  accent: (text: string) => string;
  muted: (text: string) => string;
  dim: (text: string) => string;
  match: (text: string) => string;
  border: (text: string) => string;
  bold: (text: string) => string;
}

interface FzfEntry {
  item: string;
  positions: Set<number>;
}

/**
 * Fuzzy selector component: Input + fzf-filtered scrollable list.
 *
 * Renders as a box with side borders (│), top/bottom borders (─),
 * and rounded corners (╭╮╰╯).
 *
 * Implements Focusable so the Input child gets proper IME cursor positioning.
 */
export class FuzzySelector extends Container implements Focusable {
  private input: Input;
  private candidates: string[];
  private filtered: FzfEntry[];
  private selectedIndex = 0;
  private maxVisible: number;
  private selectorTheme: SelectorTheme;
  private title: string;

  public onSelect?: (item: string) => void;
  public onCancel?: () => void;

  // --- Focusable ---
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    candidates: string[],
    title: string,
    maxVisible: number,
    theme: SelectorTheme,
  ) {
    super();
    this.candidates = candidates;
    this.title = title;
    this.maxVisible = maxVisible;
    this.selectorTheme = theme;

    // Initial unfiltered list
    this.filtered = candidates.map((item) => ({
      item,
      positions: new Set<number>(),
    }));

    // Input field for fuzzy query
    this.input = new Input();
  }

  handleInput(data: string): void {
    // Navigation: up/down
    if (matchesKey(data, Key.up)) {
      if (this.filtered.length > 0) {
        this.selectedIndex =
          this.selectedIndex === 0
            ? this.filtered.length - 1
            : this.selectedIndex - 1;
      }
      return;
    }

    if (matchesKey(data, Key.down)) {
      if (this.filtered.length > 0) {
        this.selectedIndex =
          this.selectedIndex === this.filtered.length - 1
            ? 0
            : this.selectedIndex + 1;
      }
      return;
    }

    // Select
    if (matchesKey(data, Key.enter)) {
      const entry = this.filtered[this.selectedIndex];
      if (entry) {
        this.onSelect?.(entry.item);
      }
      return;
    }

    // Cancel
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel?.();
      return;
    }

    // Everything else goes to the input field
    const prevValue = this.input.getValue();
    this.input.handleInput(data);
    const newValue = this.input.getValue();

    // Re-filter if query changed
    if (newValue !== prevValue) {
      this.applyFilter(newValue);
    }
  }

  private applyFilter(query: string): void {
    if (!query) {
      // No query — show all candidates in original order, no highlights
      this.filtered = this.candidates.map((item) => ({
        item,
        positions: new Set<number>(),
      }));
    } else {
      const fzf = new Fzf(this.candidates, {
        forward: false,
        match: extendedMatch,
      });
      const results: FzfResultItem<string>[] = fzf.find(query);
      this.filtered = results.map((r) => ({
        item: r.item,
        positions: r.positions,
      }));
    }

    // Reset selection to top
    this.selectedIndex = 0;
  }

  override render(width: number): string[] {
    const t = this.selectorTheme;
    const lines: string[] = [];

    // Inner content width (minus 2 for side borders)
    const innerWidth = Math.max(1, width - 2);
    const side = t.border("│");

    // Top border with rounded corners
    lines.push(
      t.border("╭") + t.border("─".repeat(innerWidth)) + t.border("╮"),
    );

    // Title
    lines.push(boxLine(` ${t.accent(t.bold(this.title))}`, innerWidth, side));

    // Input field — render then wrap each line in side borders
    const inputLines = this.input.render(innerWidth);
    for (const il of inputLines) {
      lines.push(boxLine(il, innerWidth, side));
    }

    // Separator
    lines.push(
      t.border("├") + t.border("─".repeat(innerWidth)) + t.border("┤"),
    );

    // Filtered list
    if (this.filtered.length === 0) {
      lines.push(boxLine(t.muted("  No matches"), innerWidth, side));
    } else {
      // Calculate visible window (scroll around selection)
      const total = this.filtered.length;
      const visible = Math.min(this.maxVisible, total);
      const startIndex = Math.max(
        0,
        Math.min(this.selectedIndex - Math.floor(visible / 2), total - visible),
      );
      const endIndex = Math.min(startIndex + visible, total);

      for (let i = startIndex; i < endIndex; i++) {
        const entry = this.filtered[i];
        if (!entry) continue;
        const isSelected = i === this.selectedIndex;
        const prefix = isSelected ? "→ " : "  ";

        // Build highlighted text
        const highlighted = highlightMatches(
          entry.item,
          entry.positions,
          t.match,
        );

        const content = isSelected
          ? t.accent(prefix) + t.accent(highlighted)
          : prefix + highlighted;

        lines.push(boxLine(content, innerWidth, side));
      }

      // Scroll indicator
      if (total > visible) {
        const info = `  (${this.selectedIndex + 1}/${total})`;
        lines.push(boxLine(t.dim(info), innerWidth, side));
      }
    }

    // Help line
    lines.push(
      boxLine(
        t.dim(" ↑↓ navigate • enter select • esc cancel"),
        innerWidth,
        side,
      ),
    );

    // Bottom border with rounded corners
    lines.push(
      t.border("╰") + t.border("─".repeat(innerWidth)) + t.border("╯"),
    );

    return lines;
  }

  override invalidate(): void {
    super.invalidate();
    this.input.invalidate();
  }
}

/**
 * Wrap a content line with side borders, padding to fill the box width.
 */
function boxLine(content: string, innerWidth: number, side: string): string {
  const contentWidth = visibleWidth(content);
  const padding = Math.max(0, innerWidth - contentWidth);
  return side + content + " ".repeat(padding) + side;
}

/**
 * Highlight matched character positions in a string.
 * Characters at positions in `positions` are wrapped with `highlightFn`.
 */
function highlightMatches(
  text: string,
  positions: Set<number>,
  highlightFn: (ch: string) => string,
): string {
  if (positions.size === 0) return text;

  let result = "";
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    result += positions.has(i) ? highlightFn(char) : char;
  }
  return result;
}

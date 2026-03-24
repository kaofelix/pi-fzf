import { editorKey } from "@mariozechner/pi-coding-agent";
import type { Focusable, KeyId } from "@mariozechner/pi-tui";
import {
  Container,
  getEditorKeybindings,
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { extendedMatch, Fzf, type FzfResultItem } from "fzf";
import type { FzfSettings } from "./config.js";

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

export interface SelectorRenderOptions {
  sideBorders?: boolean;
  showTopBorder?: boolean;
  showBottomBorder?: boolean;
  showTitle?: boolean;
}

/**
 * Fuzzy selector component: Input + fzf-filtered scrollable list.
 *
 * Renders as a box with side borders (│), top/bottom borders (─),
 * and rounded corners (╭╮╰╯).
 *
 * Implements Focusable so the Input child gets proper IME cursor positioning.
 */
const DEFAULT_SETTINGS: FzfSettings = {
  previewScrollUp: "shift+up",
  previewScrollDown: "shift+down",
  previewScrollLines: 5,
};

export class FuzzySelector extends Container implements Focusable {
  private input: Input;
  private candidates: string[];
  private filtered: FzfEntry[];
  private selectedIndex = 0;
  private maxVisible: number;
  private selectorTheme: SelectorTheme;
  private title: string;
  private fzf: Fzf<string[]>;
  private previewTemplate?: string;
  private settings: FzfSettings;
  private sideBorders: boolean;
  private showTopBorder: boolean;
  private showBottomBorder: boolean;
  private showTitle: boolean;

  public onSelect?: (item: string) => void;
  public onCancel?: () => void;

  // --- Preview state ---
  private previewContent: string[] = [];
  private previewScrollOffset = 0;
  private previewError: string | null = null;
  private lastPreviewedCandidate: string | null = null;

  // --- Preview callbacks ---
  public onPreviewRequest?: (candidate: string) => Promise<string[]>;
  public onPreviewUpdate?: () => void;

  // --- Focusable ---
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  // --- Preview methods ---
  private notifyPreviewUpdate(): void {
    this.invalidate();
    this.onPreviewUpdate?.();
  }

  setPreviewContent(lines: string[]): void {
    this.previewContent = lines;
    this.previewError = null;
    // NOTE: Do not reset lastPreviewedCandidate here - it's used to
    // deduplicate requests when typing filters the same candidate
    this.notifyPreviewUpdate();
  }

  setPreviewError(error: string): void {
    this.previewError = error;
    this.notifyPreviewUpdate();
  }

  /**
   * Trigger the initial preview load. Call this after setting onPreviewRequest.
   */
  async triggerInitialPreview(): Promise<void> {
    await this.loadPreviewForCurrentSelection();
  }

  private async loadPreviewForCurrentSelection(): Promise<void> {
    const entry = this.filtered[this.selectedIndex];
    if (!entry || !this.previewTemplate) return;

    const candidate = entry.item;
    // Skip if we already loaded this candidate's preview
    if (this.lastPreviewedCandidate === candidate) return;
    this.lastPreviewedCandidate = candidate;

    // Call the preview callback if available
    if (this.onPreviewRequest) {
      try {
        const lines = await this.onPreviewRequest(candidate);
        this.setPreviewContent(lines);
      } catch (error) {
        this.setPreviewError(error instanceof Error ? String(error) : error);
      }
    }
  }

  constructor(
    candidates: string[],
    title: string,
    maxVisible: number,
    theme: SelectorTheme,
    previewTemplate?: string,
    settings?: FzfSettings,
    options?: SelectorRenderOptions,
  ) {
    super();
    this.candidates = candidates;
    this.title = title;
    this.maxVisible = maxVisible;
    this.selectorTheme = theme;
    this.previewTemplate = previewTemplate;
    this.settings = settings ?? DEFAULT_SETTINGS;
    this.sideBorders = options?.sideBorders ?? true;
    this.showTopBorder = options?.showTopBorder ?? true;
    this.showBottomBorder = options?.showBottomBorder ?? true;
    this.showTitle = options?.showTitle ?? true;

    // Initial unfiltered list
    this.filtered = candidates.map((item) => ({
      item,
      positions: new Set<number>(),
    }));

    // Fzf instance — created once since candidates don't change
    this.fzf = new Fzf(candidates, {
      forward: false,
      match: extendedMatch,
    });

    // Input field for fuzzy query
    this.input = new Input();
  }

  handleInput(data: string): void {
    const kb = getEditorKeybindings();

    // Navigation: up/down (uses selectUp/selectDown keybindings)
    if (kb.matches(data, "selectUp")) {
      if (this.filtered.length > 0) {
        this.selectedIndex =
          this.selectedIndex === 0
            ? this.filtered.length - 1
            : this.selectedIndex - 1;
      }
      // Trigger preview load on selection change
      this.loadPreviewForCurrentSelection();
      return;
    }

    if (kb.matches(data, "selectDown")) {
      if (this.filtered.length > 0) {
        this.selectedIndex =
          this.selectedIndex === this.filtered.length - 1
            ? 0
            : this.selectedIndex + 1;
      }
      // Trigger preview load on selection change
      this.loadPreviewForCurrentSelection();
      return;
    }

    if (kb.matches(data, "selectPageUp")) {
      if (this.filtered.length > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
      }
      // Trigger preview load on selection change
      this.loadPreviewForCurrentSelection();
      return;
    }

    if (kb.matches(data, "selectPageDown")) {
      if (this.filtered.length > 0) {
        this.selectedIndex = Math.min(
          this.filtered.length - 1,
          this.selectedIndex + this.maxVisible,
        );
      }
      // Trigger preview load on selection change
      this.loadPreviewForCurrentSelection();
      return;
    }

    // Preview scrolling: configurable keybindings
    if (this.previewTemplate) {
      if (matchesKey(data, this.settings.previewScrollUp as KeyId)) {
        this.previewScrollOffset = Math.max(
          0,
          this.previewScrollOffset - this.settings.previewScrollLines,
        );
        return;
      }
      if (matchesKey(data, this.settings.previewScrollDown as KeyId)) {
        const maxScroll = Math.max(
          0,
          this.previewContent.length - this.maxVisible,
        );
        this.previewScrollOffset = Math.min(
          maxScroll,
          this.previewScrollOffset + this.settings.previewScrollLines,
        );
        return;
      }
    }

    // Select (uses selectConfirm keybinding)
    if (kb.matches(data, "selectConfirm")) {
      const entry = this.filtered[this.selectedIndex];
      if (entry) {
        this.onSelect?.(entry.item);
      }
      return;
    }

    // Cancel (uses selectCancel keybinding)
    if (kb.matches(data, "selectCancel")) {
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
      // Reset preview when filter changes
      this.previewScrollOffset = 0;
      this.loadPreviewForCurrentSelection();
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
      const results: FzfResultItem<string>[] = this.fzf.find(query);
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

    // Inner content width (minus 2 only when side borders are enabled)
    const innerWidth = Math.max(1, width - (this.sideBorders ? 2 : 0));
    const side = this.sideBorders ? t.border("│") : "";

    // Top border
    if (this.showTopBorder) {
      lines.push(
        this.sideBorders
          ? t.border("╭") + t.border("─".repeat(innerWidth)) + t.border("╮")
          : t.border("─".repeat(innerWidth)),
      );
    }

    // Title
    if (this.showTitle) {
      lines.push(boxLine(` ${t.accent(t.bold(this.title))}`, innerWidth, side));
    }

    // Input field — render then wrap each line in side borders
    const inputLines = this.input.render(innerWidth);
    for (const il of inputLines) {
      lines.push(boxLine(il, innerWidth, side));
    }

    // Separator
    lines.push(
      this.sideBorders
        ? t.border("├") + t.border("─".repeat(innerWidth)) + t.border("┤")
        : t.border("─".repeat(innerWidth)),
    );

    // Two-pane layout when preview is configured
    if (this.previewTemplate) {
      const listWidth = Math.floor(innerWidth * 0.35);
      const previewWidth = innerWidth - listWidth - 1;
      // Render list on left, preview on right
      const listLines: string[] = [];
      const previewLines: string[] = [];

      // Calculate visible window (scroll around selection)
      const total = this.filtered.length;
      const visible = Math.min(this.maxVisible, total);
      const startIndex = Math.max(
        0,
        Math.min(this.selectedIndex - Math.floor(visible / 2), total - visible),
      );
      const endIndex = Math.min(startIndex + visible, total);

      // List content
      if (this.filtered.length === 0) {
        listLines.push(t.muted("  No matches"));
      } else {
        for (let i = startIndex; i < endIndex; i++) {
          const entry = this.filtered[i];
          if (!entry) continue;
          const isSelected = i === this.selectedIndex;
          const prefix = isSelected ? "→ " : "  ";

          const highlighted = highlightMatches(
            entry.item,
            entry.positions,
            t.match,
          );

          const content = isSelected
            ? t.accent(prefix) + t.accent(highlighted)
            : prefix + highlighted;

          listLines.push(
            truncateToWidth(content, listWidth - 3, ""), // -3 for prefix and padding
          );
        }
      }

      // Preview content - always use maxVisible rows for consistent height
      if (this.previewError) {
        previewLines.push(t.muted("  Error:"));
        previewLines.push(t.muted(`  ${this.previewError}`));
      } else if (this.previewContent.length > 0) {
        const maxPreviewLines = this.maxVisible;
        for (
          let i = 0;
          i < this.previewContent.length - this.previewScrollOffset &&
          i < maxPreviewLines;
          i++
        ) {
          const line = this.previewContent[this.previewScrollOffset + i];
          if (line) {
            previewLines.push(truncateToWidth(line, previewWidth - 2, ""));
          }
        }
      }
      // Show blank when no content (no "Loading..." or "(empty)" message)

      // Combine side by side - pad each column to fixed width
      // Always render at least maxVisible rows to maintain consistent height
      const rowCount = Math.max(
        listLines.length,
        previewLines.length,
        this.maxVisible,
      );
      for (let i = 0; i < rowCount; i++) {
        const listCol = padToWidth(listLines[i] || "", listWidth);
        const previewCol = padToWidth(previewLines[i] || "", previewWidth);
        const middleBorder = t.border("│");
        lines.push(side + listCol + middleBorder + previewCol + side);
      }

      // Scroll indicator
      if (total > visible) {
        const info = `  (${this.selectedIndex + 1}/${total})`;
        lines.push(boxLine(t.dim(info), innerWidth, side));
      }

      // Help line
      const upKey = prettyKey(editorKey("selectUp"));
      const downKey = prettyKey(editorKey("selectDown"));
      const confirmKey = prettyKey(editorKey("selectConfirm"));
      const cancelKey = prettyKey(editorKey("selectCancel"));
      const helpText = this.previewTemplate
        ? ` ${upKey} ${downKey} nav • ${confirmKey} select • ${cancelKey} cancel • shift+↑↓ scroll preview`
        : ` ${upKey} ${downKey} navigate • ${confirmKey} select • ${cancelKey} cancel`;
      lines.push(boxLine(t.dim(helpText), innerWidth, side));
    } else {
      // Single pane layout (no preview)
      // Filtered list
      if (this.filtered.length === 0) {
        lines.push(boxLine(t.muted("  No matches"), innerWidth, side));
      } else {
        const total = this.filtered.length;
        const visible = Math.min(this.maxVisible, total);
        const startIndex = Math.max(
          0,
          Math.min(
            this.selectedIndex - Math.floor(visible / 2),
            total - visible,
          ),
        );
        const endIndex = Math.min(startIndex + visible, total);

        for (let i = startIndex; i < endIndex; i++) {
          const entry = this.filtered[i];
          if (!entry) continue;
          const isSelected = i === this.selectedIndex;
          const prefix = isSelected ? "→ " : "  ";

          const highlighted = highlightMatches(
            entry.item,
            entry.positions,
            t.match,
          );

          const content = isSelected
            ? t.accent(prefix) + t.accent(highlighted)
            : prefix + highlighted;

          lines.push(
            boxLine(truncateToWidth(content, innerWidth), innerWidth, side),
          );
        }

        // Scroll indicator
        if (total > visible) {
          const info = `  (${this.selectedIndex + 1}/${total})`;
          lines.push(boxLine(t.dim(info), innerWidth, side));
        }
      }

      // Help line
      const upKey = prettyKey(editorKey("selectUp"));
      const downKey = prettyKey(editorKey("selectDown"));
      const confirmKey = prettyKey(editorKey("selectConfirm"));
      const cancelKey = prettyKey(editorKey("selectCancel"));
      lines.push(
        boxLine(
          t.dim(
            ` ${upKey} ${downKey} navigate • ${confirmKey} select • ${cancelKey} cancel`,
          ),
          innerWidth,
          side,
        ),
      );
    }

    // Bottom border
    if (this.showBottomBorder) {
      lines.push(
        this.sideBorders
          ? t.border("╰") + t.border("─".repeat(innerWidth)) + t.border("╯")
          : t.border("─".repeat(innerWidth)),
      );
    }

    return lines;
  }

  override invalidate(): void {
    super.invalidate();
    this.input.invalidate();
  }
}

const PRETTY_KEYS: Record<string, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  escape: "esc",
  enter: "⏎",
};

/**
 * Replace well-known key names with nicer symbols (e.g. "up" → "↑").
 * Handles composite strings like "up/ctrl+p" by replacing each segment.
 */
function prettyKey(key: string): string {
  return key
    .split("/")
    .map((k) => PRETTY_KEYS[k] ?? k)
    .join("/");
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

/**
 * Pad (or truncate) a string to exactly the given visible width.
 * Handles ANSI escape codes correctly.
 */
function padToWidth(content: string, targetWidth: number): string {
  const truncated = truncateToWidth(content, targetWidth, "");
  const currentWidth = visibleWidth(truncated);
  const padding = Math.max(0, targetWidth - currentWidth);
  return truncated + " ".repeat(padding);
}

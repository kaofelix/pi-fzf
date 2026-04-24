import type { Focusable, KeyId } from "@mariozechner/pi-tui";
import * as PiTui from "@mariozechner/pi-tui";
import {
  Container,
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { extendedMatch, Fzf, type FzfResultItem } from "fzf";
import type { FzfSettings, SelectionValue } from "./config.js";

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
  multiSelect?: boolean;
}

type KeybindingsLike = {
  matches: (data: string, keybinding: string) => boolean;
  getKeys?: (keybinding: string) => string[];
};

const SELECT_KEYBINDINGS = {
  selectUp: ["tui.select.up", "selectUp"],
  selectDown: ["tui.select.down", "selectDown"],
  selectPageUp: ["tui.select.pageUp", "selectPageUp"],
  selectPageDown: ["tui.select.pageDown", "selectPageDown"],
  selectConfirm: ["tui.select.confirm", "selectConfirm"],
  selectCancel: ["tui.select.cancel", "selectCancel"],
} as const;

type SelectKeybinding = keyof typeof SELECT_KEYBINDINGS;

const DEFAULT_SELECT_KEYS: Record<SelectKeybinding, string[]> = {
  selectUp: ["up"],
  selectDown: ["down"],
  selectPageUp: ["pageUp"],
  selectPageDown: ["pageDown"],
  selectConfirm: ["enter"],
  selectCancel: ["escape", "ctrl+c"],
};

function resolveKeybindings(
  keybindings?: KeybindingsLike,
): KeybindingsLike | undefined {
  if (keybindings) return keybindings;
  if (typeof PiTui.getKeybindings === "function") {
    return PiTui.getKeybindings() as KeybindingsLike;
  }
  if (typeof PiTui.getEditorKeybindings === "function") {
    return PiTui.getEditorKeybindings() as KeybindingsLike;
  }
  return undefined;
}

function matchesSelectKey(
  keybindings: KeybindingsLike | undefined,
  data: string,
  keybinding: SelectKeybinding,
): boolean {
  if (!keybindings) return false;
  return SELECT_KEYBINDINGS[keybinding].some((id) =>
    keybindings.matches(data, id),
  );
}

function getSelectKeyText(
  keybindings: KeybindingsLike | undefined,
  keybinding: SelectKeybinding,
): string {
  if (keybindings?.getKeys) {
    for (const id of SELECT_KEYBINDINGS[keybinding]) {
      const keys = keybindings.getKeys(id);
      if (keys.length > 0) {
        return keys.join("/");
      }
    }
  }
  return DEFAULT_SELECT_KEYS[keybinding].join("/");
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
  private multiSelect: boolean;
  private markedItems = new Set<string>();
  private keybindings: KeybindingsLike | undefined;

  public onSelect?: (item: SelectionValue) => void;
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
    keybindings?: KeybindingsLike,
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
    this.multiSelect = options?.multiSelect ?? false;
    this.keybindings = resolveKeybindings(keybindings);

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

  private moveSelection(delta: number, wrap = true): void {
    if (this.filtered.length === 0) return;

    if (wrap) {
      const total = this.filtered.length;
      this.selectedIndex = (this.selectedIndex + delta + total) % total;
    } else {
      this.selectedIndex = Math.max(
        0,
        Math.min(this.filtered.length - 1, this.selectedIndex + delta),
      );
    }

    this.previewScrollOffset = 0;
    this.loadPreviewForCurrentSelection();
  }

  private toggleMarkedState(): void {
    const entry = this.filtered[this.selectedIndex];
    if (!entry) return;

    if (this.markedItems.has(entry.item)) {
      this.markedItems.delete(entry.item);
    } else {
      this.markedItems.add(entry.item);
    }
  }

  private getAcceptedSelection(): SelectionValue | null {
    const entry = this.filtered[this.selectedIndex];
    if (!entry) return null;

    if (!this.multiSelect || this.markedItems.size === 0) {
      return entry.item;
    }

    return this.candidates.filter((item) => this.markedItems.has(item));
  }

  private renderListEntry(entry: FzfEntry, isSelected: boolean): string {
    const t = this.selectorTheme;
    const isMarked = this.multiSelect && this.markedItems.has(entry.item);
    const prefix = this.multiSelect
      ? `${isSelected ? "→" : " "} ${isMarked ? "✓" : " "} `
      : isSelected
        ? "→ "
        : "  ";
    const highlighted = highlightMatches(entry.item, entry.positions, t.match);

    if (isSelected) {
      return t.accent(prefix) + t.accent(highlighted);
    }

    return (isMarked ? t.accent(prefix) : prefix) + highlighted;
  }

  handleInput(data: string): void {
    const kb = this.keybindings;

    // Navigation: up/down (uses selectUp/selectDown keybindings)
    if (matchesSelectKey(kb, data, "selectUp")) {
      this.moveSelection(-1);
      return;
    }

    if (matchesSelectKey(kb, data, "selectDown")) {
      this.moveSelection(1);
      return;
    }

    if (matchesSelectKey(kb, data, "selectPageUp")) {
      this.moveSelection(-this.maxVisible, false);
      return;
    }

    if (matchesSelectKey(kb, data, "selectPageDown")) {
      this.moveSelection(this.maxVisible, false);
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

    if (this.multiSelect && matchesKey(data, "tab" as KeyId)) {
      this.toggleMarkedState();
      this.moveSelection(1);
      return;
    }

    if (this.multiSelect && matchesKey(data, "shift+tab" as KeyId)) {
      this.toggleMarkedState();
      this.moveSelection(-1);
      return;
    }

    // Select (uses selectConfirm keybinding)
    if (matchesSelectKey(kb, data, "selectConfirm")) {
      const selection = this.getAcceptedSelection();
      if (selection) {
        this.onSelect?.(selection);
      }
      return;
    }

    // Cancel (uses selectCancel keybinding)
    if (matchesSelectKey(kb, data, "selectCancel")) {
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
          const content = this.renderListEntry(entry, isSelected);

          listLines.push(truncateToWidth(content, listWidth, ""));
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

      if (this.multiSelect && this.markedItems.size > 0) {
        const selectedInfo = `  ${this.markedItems.size} selected`;
        lines.push(boxLine(t.dim(selectedInfo), innerWidth, side));
      }

      // Help line
      const upKey = prettyKey(getSelectKeyText(this.keybindings, "selectUp"));
      const downKey = prettyKey(
        getSelectKeyText(this.keybindings, "selectDown"),
      );
      const confirmKey = prettyKey(
        getSelectKeyText(this.keybindings, "selectConfirm"),
      );
      const cancelKey = prettyKey(
        getSelectKeyText(this.keybindings, "selectCancel"),
      );
      const multiSelectHint = this.multiSelect ? " • tab/s-tab toggle" : "";
      const helpText = ` ${upKey} ${downKey} nav${multiSelectHint} • ${confirmKey} select • ${cancelKey} cancel • shift+↑↓ scroll preview`;
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
          const content = this.renderListEntry(entry, isSelected);

          lines.push(
            boxLine(truncateToWidth(content, innerWidth, ""), innerWidth, side),
          );
        }

        // Scroll indicator
        if (total > visible) {
          const info = `  (${this.selectedIndex + 1}/${total})`;
          lines.push(boxLine(t.dim(info), innerWidth, side));
        }
      }

      if (this.multiSelect && this.markedItems.size > 0) {
        const selectedInfo = `  ${this.markedItems.size} selected`;
        lines.push(boxLine(t.dim(selectedInfo), innerWidth, side));
      }

      // Help line
      const upKey = prettyKey(getSelectKeyText(this.keybindings, "selectUp"));
      const downKey = prettyKey(
        getSelectKeyText(this.keybindings, "selectDown"),
      );
      const confirmKey = prettyKey(
        getSelectKeyText(this.keybindings, "selectConfirm"),
      );
      const cancelKey = prettyKey(
        getSelectKeyText(this.keybindings, "selectCancel"),
      );
      const multiSelectHint = this.multiSelect ? " • tab/s-tab toggle" : "";
      lines.push(
        boxLine(
          t.dim(
            ` ${upKey} ${downKey} navigate${multiSelectHint} • ${confirmKey} select • ${cancelKey} cancel`,
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

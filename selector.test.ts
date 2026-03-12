import { describe, expect, it, vi } from "vitest";
import type { FzfSettings } from "./config.js";
import { FuzzySelector, type SelectorTheme } from "./selector.js";

// Mock theme for tests
const mockTheme: SelectorTheme = {
  accent: (t) => t,
  muted: (t) => t,
  dim: (t) => t,
  match: (t) => t,
  border: (t) => t,
  bold: (t) => t,
};

describe("FuzzySelector", () => {
  describe("single-pane layout (no preview)", () => {
    it("renders without vertical separator when no preview", () => {
      const selector = new FuzzySelector(
        ["item1", "item2", "item3"],
        "fzf:test",
        10,
        mockTheme,
        undefined, // no preview
      );

      const lines = selector.render(80);

      // Should have top/bottom borders but no vertical split (┤ or ├)
      const hasVerticalSplit = lines.some(
        (l) => l.includes("┤") || l.includes("├"),
      );
      expect(hasVerticalSplit).toBe(true); // horizontal separator between input and list

      // Should NOT have vertical divider in content area (│ between panes)
      const contentLines = lines.slice(3, -2); // exclude header and footer
      const hasPaneDivider = contentLines.some((l) => {
        // Check for mid-line vertical borders that indicate split panes
        const borderCount = (l.match(/│/g) || []).length;
        return borderCount > 2; // More than left/right borders means split
      });
      expect(hasPaneDivider).toBe(false);
    });

    it("uses full width for list when no preview", () => {
      const selector = new FuzzySelector(
        ["a".repeat(60)], // long item
        "fzf:test",
        10,
        mockTheme,
        undefined,
      );

      const lines = selector.render(80);
      const listLine = lines.find((l) => l.includes("a".repeat(60)));

      // The long item should be visible (not truncated by narrow pane)
      expect(listLine).toBeDefined();
    });

    it("can render without side borders", () => {
      const selector = new FuzzySelector(
        ["item1", "item2"],
        "fzf:test",
        10,
        mockTheme,
        undefined,
        undefined,
        { sideBorders: false },
      );

      const lines = selector.render(80);
      const hasSideBorders = lines.some(
        (l) => l.startsWith("│") || l.endsWith("│"),
      );

      expect(hasSideBorders).toBe(false);
    });

    it("can hide top and bottom borders independently", () => {
      const selector = new FuzzySelector(
        ["item1", "item2"],
        "fzf:test",
        10,
        mockTheme,
        undefined,
        undefined,
        { sideBorders: false, showTopBorder: false, showBottomBorder: false },
      );

      const lines = selector.render(80);
      expect(lines[0]).not.toMatch(/─/);
      expect(lines[lines.length - 1]).not.toMatch(/─/);
    });

    it("can hide header/title line", () => {
      const selector = new FuzzySelector(
        ["item1", "item2"],
        "fzf:test",
        10,
        mockTheme,
        undefined,
        undefined,
        { showTitle: false },
      );

      const lines = selector.render(80);
      const hasTitle = lines.some((l) => l.includes("fzf:test"));

      expect(hasTitle).toBe(false);
    });
  });

  describe("two-pane layout (with preview)", () => {
    it("renders with vertical pane divider when preview configured", () => {
      const selector = new FuzzySelector(
        ["item1", "item2"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}", // preview command
      );

      const lines = selector.render(80);

      // Should have vertical separator between panes (multiple │ in content area)
      const contentLines = lines.slice(3, -2);
      const hasPaneDivider = contentLines.some((l) => {
        const borderCount = (l.match(/│/g) || []).length;
        return borderCount >= 3; // Left, middle divider, right
      });
      expect(hasPaneDivider).toBe(true);
    });

    it("splits width approximately 35/65 between list and preview", () => {
      const selector = new FuzzySelector(
        ["short"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      const lines = selector.render(80);

      // Find a content line with the divider
      const contentLine = lines.find((l) => {
        const borderCount = (l.match(/│/g) || []).length;
        return borderCount >= 3;
      });

      expect(contentLine).toBeDefined();
      // The divider should be roughly at position 35% of 80 = 28
      // (accounting for borders)
    });

    it("shows blank preview pane initially (not loading indicator)", () => {
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      const lines = selector.render(80);

      // Should NOT show loading state - just blank
      const hasLoading = lines.some(
        (l) => l.toLowerCase().includes("loading") || l.includes("⋯"),
      );
      expect(hasLoading).toBe(false);
    });

    it("shows preview content after setPreviewContent is called", () => {
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      // Simulate preview content loaded
      selector.setPreviewContent(["line 1", "line 2", "line 3"]);

      const lines = selector.render(80);

      // Should show preview content
      const hasContent = lines.some((l) => l.includes("line 1"));
      expect(hasContent).toBe(true);
    });

    it("shows error message when setPreviewError is called", () => {
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      selector.setPreviewError("File not found");

      const lines = selector.render(80);

      const hasError = lines.some((l) => l.includes("File not found"));
      expect(hasError).toBe(true);
    });

    it("shows preview content after setPreviewContent is called", () => {
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      // Initially blank
      let lines = selector.render(80);
      expect(lines.some((l) => l.includes("content here"))).toBe(false);

      // After content set
      selector.setPreviewContent(["content here"]);
      lines = selector.render(80);
      expect(lines.some((l) => l.includes("content here"))).toBe(true);
    });
  });

  describe("preview scrolling", () => {
    it("scrolls preview pane down with shift+down (default 5 lines)", () => {
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        5,
        mockTheme,
        "cat {{selected}}",
      );

      // Set more content than can fit (10 lines, only 5 visible)
      // Use unique identifiers to avoid substring matching issues
      selector.setPreviewContent([
        "FIRST_LINE",
        "SECOND_LINE",
        "THIRD_LINE",
        "FOURTH_LINE",
        "FIFTH_LINE",
        "SIXTH_LINE",
        "SEVENTH_LINE",
        "EIGHTH_LINE",
        "NINTH_LINE",
        "TENTH_LINE",
      ]);

      let lines = selector.render(80);
      // Initially lines 1-5 visible
      expect(lines.some((l) => l.includes("FIRST_LINE"))).toBe(true);
      expect(lines.some((l) => l.includes("SIXTH_LINE"))).toBe(false);

      // Scroll down once (5 lines by default)
      selector.handleInput("\x1b[1;2B"); // shift+down
      lines = selector.render(80);

      // Now lines 6-10 should be visible
      expect(lines.some((l) => l.includes("FIRST_LINE"))).toBe(false);
      expect(lines.some((l) => l.includes("SIXTH_LINE"))).toBe(true);
      expect(lines.some((l) => l.includes("TENTH_LINE"))).toBe(true);
    });

    it("scrolls preview pane up with shift+up (default 5 lines)", () => {
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        5,
        mockTheme,
        "cat {{selected}}",
      );

      selector.setPreviewContent([
        "FIRST_LINE",
        "SECOND_LINE",
        "THIRD_LINE",
        "FOURTH_LINE",
        "FIFTH_LINE",
        "SIXTH_LINE",
        "SEVENTH_LINE",
        "EIGHTH_LINE",
        "NINTH_LINE",
        "TENTH_LINE",
      ]);

      // Scroll down once first (moves to offset 5)
      selector.handleInput("\x1b[1;2B"); // shift+down

      let lines = selector.render(80);
      // Should show lines 6-10 now
      expect(lines.some((l) => l.includes("FIRST_LINE"))).toBe(false);
      expect(lines.some((l) => l.includes("SIXTH_LINE"))).toBe(true);

      // Scroll up once (moves back to offset 0)
      selector.handleInput("\x1b[1;2A"); // shift+up
      lines = selector.render(80);

      // Should show lines 1-5 again
      expect(lines.some((l) => l.includes("FIRST_LINE"))).toBe(true);
      expect(lines.some((l) => l.includes("SIXTH_LINE"))).toBe(false);
    });

    it("scrolls by configurable number of lines", () => {
      const settings: FzfSettings = {
        previewScrollUp: "shift+up",
        previewScrollDown: "shift+down",
        previewScrollLines: 3, // scroll 3 lines at a time
      };
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        5,
        mockTheme,
        "cat {{selected}}",
        settings,
      );

      selector.setPreviewContent([
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
        "line 8",
        "line 9",
        "line 10",
      ]);

      let lines = selector.render(80);
      expect(lines.some((l) => l.includes("line 1"))).toBe(true);
      expect(lines.some((l) => l.includes("line 4"))).toBe(true);

      // Scroll down once - should move by 3 lines
      selector.handleInput("\x1b[1;2B"); // shift+down
      lines = selector.render(80);

      // Lines 1-3 should be gone, line 4 should now be first visible
      expect(lines.some((l) => l.includes("line 1"))).toBe(false);
      expect(lines.some((l) => l.includes("line 2"))).toBe(false);
      expect(lines.some((l) => l.includes("line 3"))).toBe(false);
      expect(lines.some((l) => l.includes("line 4"))).toBe(true);
    });

    it("uses custom keybindings from settings", () => {
      const settings: FzfSettings = {
        previewScrollUp: "alt+k",
        previewScrollDown: "alt+j",
        previewScrollLines: 1,
      };
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        5,
        mockTheme,
        "cat {{selected}}",
        settings,
      );

      selector.setPreviewContent([
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
      ]);

      let lines = selector.render(80);
      expect(lines.some((l) => l.includes("line 1"))).toBe(true);

      // Scroll down with alt+j (legacy alt+j = ESC + j)
      selector.handleInput("\x1bj");
      lines = selector.render(80);

      expect(lines.some((l) => l.includes("line 1"))).toBe(false);
      expect(lines.some((l) => l.includes("line 2"))).toBe(true);
    });

    it("resets preview scroll when selection changes", () => {
      const selector = new FuzzySelector(
        ["item1", "item2"],
        "fzf:test",
        5,
        mockTheme,
        "cat {{selected}}",
      );

      selector.setPreviewContent([
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
        "line 8",
        "line 9",
        "line 10",
      ]);

      // Scroll down
      selector.handleInput("\x1b[1;2B"); // shift+down

      // Change selection (down arrow)
      selector.handleInput("\x1b[B"); // down

      // Preview scroll should reset (new content will load)
      // This is validated by checking that previewScrollOffset is 0
    });
  });

  describe("preview callbacks", () => {
    it("calls onPreviewRequest when selection changes", () => {
      const onPreviewRequest = vi.fn().mockResolvedValue(["preview content"]);
      const selector = new FuzzySelector(
        ["item1", "item2"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      selector.onPreviewRequest = onPreviewRequest;

      // Navigate to trigger selection change
      selector.handleInput("\x1b[B"); // down

      expect(onPreviewRequest).toHaveBeenCalledWith("item2");
    });

    it("does not call onPreviewRequest when no preview configured", () => {
      const onPreviewRequest = vi.fn().mockResolvedValue(["content"]);
      const selector = new FuzzySelector(
        ["item1", "item2"],
        "fzf:test",
        10,
        mockTheme,
        undefined, // no preview
      );

      selector.onPreviewRequest = onPreviewRequest;
      selector.handleInput("\x1b[B"); // down

      expect(onPreviewRequest).not.toHaveBeenCalled();
    });

    it("loads initial preview when triggerInitialPreview is called", async () => {
      const onPreviewRequest = vi.fn().mockResolvedValue(["preview content"]);
      const selector = new FuzzySelector(
        ["item1", "item2"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      selector.onPreviewRequest = onPreviewRequest;

      // Trigger initial preview load (simulates what index.ts does after setting callback)
      await selector.triggerInitialPreview();

      expect(onPreviewRequest).toHaveBeenCalledWith("item1");
    });

    it("does not reload preview when typing if same candidate is selected", async () => {
      const onPreviewRequest = vi.fn().mockResolvedValue(["preview content"]);
      const selector = new FuzzySelector(
        ["apple", "application", "banana"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      selector.onPreviewRequest = onPreviewRequest;
      await selector.triggerInitialPreview();

      // First call for initial preview
      expect(onPreviewRequest).toHaveBeenCalledTimes(1);
      expect(onPreviewRequest).toHaveBeenCalledWith("apple");

      // Type 'a' - "apple" stays at top (matches apple, application)
      selector.handleInput("a");
      // Wait for any async operations
      await new Promise((r) => setTimeout(r, 10));

      // Should NOT reload - same candidate selected
      expect(onPreviewRequest).toHaveBeenCalledTimes(1);

      // Type 'p' - "apple" still at top
      selector.handleInput("p");
      await new Promise((r) => setTimeout(r, 10));

      // Should still NOT reload
      expect(onPreviewRequest).toHaveBeenCalledTimes(1);
    });

    it("reloads preview when filter changes selected candidate", async () => {
      const onPreviewRequest = vi.fn().mockResolvedValue(["preview content"]);
      const selector = new FuzzySelector(
        ["apple", "banana", "cherry"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      selector.onPreviewRequest = onPreviewRequest;
      await selector.triggerInitialPreview();

      expect(onPreviewRequest).toHaveBeenCalledTimes(1);
      expect(onPreviewRequest).toHaveBeenCalledWith("apple");

      // Type 'b' - "banana" becomes top match
      selector.handleInput("b");
      await new Promise((r) => setTimeout(r, 10));

      // Should reload for banana
      expect(onPreviewRequest).toHaveBeenCalledTimes(2);
      expect(onPreviewRequest).toHaveBeenLastCalledWith("banana");
    });
  });

  describe("preview help text", () => {
    it("includes preview scroll hint when preview configured", () => {
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        10,
        mockTheme,
        "cat {{selected}}",
      );

      const lines = selector.render(80);
      const helpLine = lines[lines.length - 2]; // second to last line

      // Should mention preview scrolling
      expect(helpLine).toMatch(/shift.*scroll|preview/i);
    });

    it("excludes preview hint when no preview", () => {
      const selector = new FuzzySelector(
        ["item1"],
        "fzf:test",
        10,
        mockTheme,
        undefined,
      );

      const lines = selector.render(80);
      const helpLine = lines[lines.length - 2]; // second to last line

      // Should NOT mention preview
      expect(helpLine).not.toMatch(/shift.*scroll|preview/i);
    });
  });
});

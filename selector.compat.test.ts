import { afterEach, describe, expect, it, vi } from "vitest";

describe("FuzzySelector keybinding compatibility", () => {
  afterEach(() => {
    vi.doUnmock("@mariozechner/pi-coding-agent");
    vi.doUnmock("@mariozechner/pi-tui");
    vi.resetModules();
  });

  it("uses namespaced keybindings when legacy helpers are unavailable", async () => {
    const keyMap: Record<string, string[]> = {
      "tui.select.up": ["k"],
      "tui.select.down": ["j"],
      "tui.select.pageUp": ["u"],
      "tui.select.pageDown": ["d"],
      "tui.select.confirm": ["space"],
      "tui.select.cancel": ["esc"],
    };

    const keybindings = {
      matches(data: string, keybinding: string) {
        return (keyMap[keybinding] ?? []).includes(data);
      },
      getKeys(keybinding: string) {
        return keyMap[keybinding] ?? [];
      },
    };

    vi.doMock("@mariozechner/pi-coding-agent", async () => {
      const actual = await vi.importActual<object>(
        "@mariozechner/pi-coding-agent",
      );
      return {
        ...actual,
        editorKey: undefined,
      };
    });

    vi.doMock("@mariozechner/pi-tui", async () => {
      const actual = await vi.importActual<object>("@mariozechner/pi-tui");
      return {
        ...actual,
        getEditorKeybindings: undefined,
        getKeybindings: () => keybindings,
      };
    });

    const { FuzzySelector } = await import("./selector.js");

    const selector = new FuzzySelector(
      ["first", "second"],
      "fzf:test",
      10,
      {
        accent: (t: string) => t,
        muted: (t: string) => t,
        dim: (t: string) => t,
        match: (t: string) => t,
        border: (t: string) => t,
        bold: (t: string) => t,
      },
      undefined,
    );

    const lines = selector.render(80);
    expect(
      lines.some((line) =>
        line.includes("k j navigate • space select • esc cancel"),
      ),
    ).toBe(true);

    let selected: string | undefined;
    selector.onSelect = (item: string) => {
      selected = item;
    };

    selector.handleInput("j");
    selector.handleInput("space");

    expect(selected).toBe("second");
  });
});

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadFzfConfig,
  loadFzfSettings,
  renderTemplate,
  resolveAction,
} from "./config.js";

describe("renderTemplate", () => {
  it("replaces {{selected}} placeholder", () => {
    expect(renderTemplate("Read {{selected}}", "foo.ts")).toBe("Read foo.ts");
  });

  it("replaces multiple occurrences", () => {
    expect(renderTemplate("{{selected}} and {{selected}}", "x")).toBe(
      "x and x",
    );
  });

  it("trims the selected value", () => {
    expect(renderTemplate("file: {{selected}}", "  foo.ts  ")).toBe(
      "file: foo.ts",
    );
  });

  it("returns template unchanged if no placeholder", () => {
    expect(renderTemplate("no placeholder", "ignored")).toBe("no placeholder");
  });

  it("joins multiple selections with newlines", () => {
    expect(renderTemplate("files:\n{{selected}}", ["foo.ts", "bar.ts"])).toBe(
      "files:\nfoo.ts\nbar.ts",
    );
  });

  it("trims each value in a multi-selection", () => {
    expect(renderTemplate("{{selected}}", ["  foo.ts  ", " bar.ts "])).toBe(
      "foo.ts\nbar.ts",
    );
  });
});

describe("resolveAction", () => {
  it("converts short form string to editor action", () => {
    const result = resolveAction("Read {{selected}}");
    expect(result).toEqual({
      type: "editor",
      template: "Read {{selected}}",
      output: "notify",
    });
  });

  it("preserves long form editor action", () => {
    const result = resolveAction({
      type: "editor",
      template: "{{selected}}",
    });
    expect(result).toEqual({
      type: "editor",
      template: "{{selected}}",
      output: "notify",
    });
  });

  it("preserves long form send action", () => {
    const result = resolveAction({
      type: "send",
      template: "{{selected}}",
    });
    expect(result).toEqual({
      type: "send",
      template: "{{selected}}",
      output: "notify",
    });
  });

  it("preserves long form bash action with default output", () => {
    const result = resolveAction({
      type: "bash",
      template: "cat {{selected}}",
    });
    expect(result).toEqual({
      type: "bash",
      template: "cat {{selected}}",
      output: "notify",
    });
  });

  it("preserves explicit output option", () => {
    const result = resolveAction({
      type: "bash",
      template: "cat {{selected}}",
      output: "editor",
    });
    expect(result).toEqual({
      type: "bash",
      template: "cat {{selected}}",
      output: "editor",
    });
  });

  it("supports send output option", () => {
    const result = resolveAction({
      type: "bash",
      template: "echo hello",
      output: "send",
    });
    expect(result).toEqual({
      type: "bash",
      template: "echo hello",
      output: "send",
    });
  });
});

describe("loadFzfConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pi-fzf-test-${Date.now()}`);
    mkdirSync(join(testDir, ".pi"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function writeProjectConfig(config: object) {
    writeFileSync(join(testDir, ".pi", "fzf.json"), JSON.stringify(config));
  }

  it("loads commands from project config", () => {
    writeProjectConfig({
      commands: {
        test: { list: "ls", action: "Read {{selected}}" },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd).toMatchObject({
      name: "test",
      list: "ls",
      action: {
        type: "editor",
        template: "Read {{selected}}",
        output: "notify",
      },
    });
  });

  it("loads multiple commands", () => {
    writeProjectConfig({
      commands: {
        foo: { list: "ls -a", action: "{{selected}}" },
        bar: {
          list: "git branch",
          action: { type: "bash", template: "git checkout {{selected}}" },
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const names = result.map((c) => c.name);

    expect(names).toContain("foo");
    expect(names).toContain("bar");
  });

  it("handles invalid JSON gracefully", () => {
    writeFileSync(join(testDir, ".pi", "fzf.json"), "not valid json");

    // Should not throw, just skip invalid config
    const result = loadFzfConfig(testDir);
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles missing commands key", () => {
    writeProjectConfig({ notCommands: {} });

    const result = loadFzfConfig(testDir);
    // Should not throw, may return global config only
    expect(Array.isArray(result)).toBe(true);
  });

  it("loads shortcut when specified", () => {
    writeProjectConfig({
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
          shortcut: "ctrl+shift+f",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.shortcut).toBe("ctrl+shift+f");
  });

  it("shortcut is undefined when not specified", () => {
    writeProjectConfig({
      commands: {
        test: { list: "ls", action: "Read {{selected}}" },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.shortcut).toBeUndefined();
  });

  it("loads preview command when specified", () => {
    writeProjectConfig({
      commands: {
        file: {
          list: "fd --type f",
          action: "Read {{selected}}",
          preview: "bat {{selected}}",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const fileCmd = result.find((c) => c.name === "file");

    expect(fileCmd).toBeDefined();
    expect(fileCmd?.preview).toBe("bat {{selected}}");
  });

  it("preview is undefined when not specified", () => {
    writeProjectConfig({
      commands: {
        test: { list: "ls", action: "Read {{selected}}" },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.preview).toBeUndefined();
  });

  it("loads selector placement when specified", () => {
    writeProjectConfig({
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
          placement: "belowEditor",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.placement).toBe("belowEditor");
  });

  it("defaults selector placement to overlay", () => {
    writeProjectConfig({
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.placement).toBe("overlay");
  });

  it("supports explicit overlay placement", () => {
    writeProjectConfig({
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
          placement: "overlay",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.placement).toBe("overlay");
  });

  it("uses top-level defaultPlacement when command placement is omitted", () => {
    writeProjectConfig({
      defaultPlacement: "belowEditor",
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.placement).toBe("belowEditor");
  });

  it("command placement overrides top-level defaultPlacement", () => {
    writeProjectConfig({
      defaultPlacement: "belowEditor",
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
          placement: "aboveEditor",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.placement).toBe("aboveEditor");
  });

  it("loads hideHeader when specified", () => {
    writeProjectConfig({
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
          hideHeader: true,
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.hideHeader).toBe(true);
  });

  it("defaults hideHeader to false", () => {
    writeProjectConfig({
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.hideHeader).toBe(false);
  });

  it("loads multiSelect when specified", () => {
    writeProjectConfig({
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
          multiSelect: true,
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.multiSelect).toBe(true);
  });

  it("defaults multiSelect to false", () => {
    writeProjectConfig({
      commands: {
        test: {
          list: "ls",
          action: "Read {{selected}}",
        },
      },
    });

    const result = loadFzfConfig(testDir);
    const testCmd = result.find((c) => c.name === "test");

    expect(testCmd).toBeDefined();
    expect(testCmd?.multiSelect).toBe(false);
  });
});

describe("loadFzfSettings", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pi-fzf-settings-test-${Date.now()}`);
    mkdirSync(join(testDir, ".pi"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function writeProjectConfig(config: object) {
    writeFileSync(join(testDir, ".pi", "fzf.json"), JSON.stringify(config));
  }

  it("returns default settings when no config exists", () => {
    const settings = loadFzfSettings(testDir);

    expect(settings.previewScrollUp).toBe("shift+up");
    expect(settings.previewScrollDown).toBe("shift+down");
    expect(settings.previewScrollLines).toBe(5);
  });

  it("loads custom keybindings from settings", () => {
    writeProjectConfig({
      commands: {},
      settings: {
        previewScrollUp: "alt+k",
        previewScrollDown: "alt+j",
      },
    });

    const settings = loadFzfSettings(testDir);

    expect(settings.previewScrollUp).toBe("alt+k");
    expect(settings.previewScrollDown).toBe("alt+j");
  });

  it("loads custom scroll lines from settings", () => {
    writeProjectConfig({
      commands: {},
      settings: {
        previewScrollLines: 10,
      },
    });

    const settings = loadFzfSettings(testDir);

    expect(settings.previewScrollLines).toBe(10);
  });

  it("uses defaults for missing settings values", () => {
    writeProjectConfig({
      commands: {},
      settings: {
        previewScrollUp: "alt+p",
        // previewScrollDown and previewScrollLines not specified
      },
    });

    const settings = loadFzfSettings(testDir);

    expect(settings.previewScrollUp).toBe("alt+p");
    expect(settings.previewScrollDown).toBe("shift+down"); // default
    expect(settings.previewScrollLines).toBe(5); // default
  });

  it("handles empty settings object", () => {
    writeProjectConfig({
      commands: {},
      settings: {},
    });

    const settings = loadFzfSettings(testDir);

    expect(settings.previewScrollUp).toBe("shift+up");
    expect(settings.previewScrollDown).toBe("shift+down");
    expect(settings.previewScrollLines).toBe(5);
  });
});

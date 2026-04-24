import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { executeAction } from "./actions.js";
import type { FzfSettings, ResolvedCommand, SelectionValue } from "./config.js";
import { loadFzfConfig, loadFzfSettings } from "./config.js";
import { type ExecFunction, runPreviewCommand } from "./preview.js";
import type { SelectorTheme } from "./selector.js";
import { FuzzySelector } from "./selector.js";

export default function (pi: ExtensionAPI) {
  let commands: ResolvedCommand[] = [];
  let settings: FzfSettings;

  pi.on("session_start", async (_event, ctx) => {
    // Load config from global + project locations
    commands = loadFzfConfig(ctx.cwd);
    settings = loadFzfSettings(ctx.cwd);

    if (commands.length === 0) return;

    // Register a /fzf:<name> command and optional shortcut for each entry
    for (const cmd of commands) {
      registerFzfCommand(pi, cmd, settings);

      if (cmd.shortcut) {
        registerFzfShortcut(pi, cmd, settings);
      }
    }

    ctx.ui.notify(`fzf: ${commands.length} command(s) loaded`, "info");
  });
}

/**
 * Run the fzf flow: list candidates, open fuzzy selector, execute action.
 */
async function runFzfSelector(
  pi: ExtensionAPI,
  cmd: ResolvedCommand,
  ctx: ExtensionCommandContext,
  settings: FzfSettings,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("fzf commands require interactive mode", "error");
    return;
  }

  // 1. Run the list command to get candidates
  const result = await pi.exec("bash", ["-c", cmd.list], {
    timeout: 10000,
  });

  if (result.code !== 0) {
    ctx.ui.notify(
      `fzf:${cmd.name}: list command failed (exit ${result.code})${result.stderr ? `\n${result.stderr}` : ""}`,
      "error",
    );
    return;
  }

  const candidates = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    ctx.ui.notify(`fzf:${cmd.name}: no candidates`, "warning");
    return;
  }

  // 2. Render selector as a widget in configured placement,
  // and use custom() only for focused input routing.
  let tuiRef: TUI | undefined;

  const customOptions =
    cmd.placement === "overlay"
      ? {
          overlay: true,
          // Pin overlay top position so filtering doesn't make the input jump.
          overlayOptions: cmd.preview
            ? {
                anchor: "top-center",
                offsetY: 5,
                width: "80%",
                minWidth: 120,
                maxHeight: "80%",
              }
            : {
                anchor: "top-center",
                offsetY: 5,
              },
        }
      : {
          // Keep editor visible while custom mode captures focused input.
          overlay: true,
        };

  const selected = await ctx.ui.custom<SelectionValue | null>(
    (tui, theme, keybindings, done) => {
      tuiRef = tui;

      const selectorTheme: SelectorTheme = {
        accent: (t) => theme.fg("accent", t),
        muted: (t) => theme.fg("muted", t),
        dim: (t) => theme.fg("dim", t),
        match: (t) => theme.fg("warning", theme.bold(t)),
        border: (t) => theme.fg("border", t),
        bold: (t) => theme.bold(t),
      };

      // Keep preview mode taller to leave room for right-pane content.
      const maxVisible = cmd.preview ? 35 : Math.min(candidates.length, 15);
      const isWidgetPlacement = cmd.placement !== "overlay";

      const selector = new FuzzySelector(
        candidates,
        `fzf:${cmd.name}`,
        maxVisible,
        selectorTheme,
        cmd.preview,
        settings,
        isWidgetPlacement
          ? {
              // Widget placements (above/below editor) look cleaner without side borders.
              sideBorders: false,
              // Blend widget into editor seam.
              showTopBorder: cmd.placement !== "belowEditor",
              showBottomBorder: cmd.placement !== "aboveEditor",
              showTitle: !cmd.hideHeader,
              multiSelect: cmd.multiSelect,
            }
          : {
              // Overlay keeps the classic floating panel framing.
              sideBorders: true,
              showTopBorder: true,
              showBottomBorder: true,
              showTitle: !cmd.hideHeader,
              multiSelect: cmd.multiSelect,
            },
        keybindings,
      );

      // Set up preview callback if preview is configured
      if (cmd.preview) {
        selector.onPreviewUpdate = () => tui.requestRender();
        selector.onPreviewRequest = async (candidate) => {
          const previewTemplate = cmd.preview;
          const result = await runPreviewCommand(
            pi.exec.bind(pi) as ExecFunction,
            previewTemplate,
            candidate,
          );
          return result.lines;
        };
        selector.triggerInitialPreview();
      }

      selector.onSelect = (item) => done(item);
      selector.onCancel = () => done(null);

      if (cmd.placement === "overlay") {
        return {
          render(width: number) {
            return selector.render(width);
          },
          invalidate() {
            selector.invalidate();
          },
          handleInput(data: string) {
            selector.handleInput(data);
            tui.requestRender();
          },
          // Focusable — propagate to selector for IME cursor support
          get focused() {
            return selector.focused;
          },
          set focused(value: boolean) {
            selector.focused = value;
          },
        };
      }

      const widgetKey = `pi-fzf:${cmd.name}:selector`;

      ctx.ui.setWidget(
        widgetKey,
        () => ({
          render(width: number) {
            return selector.render(width);
          },
          invalidate() {
            selector.invalidate();
          },
        }),
        { placement: cmd.placement },
      );

      return {
        render() {
          return [];
        },
        invalidate() {},
        handleInput(data: string) {
          selector.handleInput(data);
          tui.requestRender();
        },
        // Focusable — propagate to selector for IME cursor support
        get focused() {
          return selector.focused;
        },
        set focused(value: boolean) {
          selector.focused = value;
        },
        dispose() {
          ctx.ui.setWidget(widgetKey, undefined);
        },
      };
    },
    customOptions,
  );

  // 3. If user selected something, execute the action
  if (selected !== null) {
    await executeAction(cmd.action, selected, pi, ctx);
    // Explicitly request render to ensure the editor shows
    // the new text after the overlay closed
    tuiRef?.requestRender();
  }
}

function registerFzfCommand(
  pi: ExtensionAPI,
  cmd: ResolvedCommand,
  settings: FzfSettings,
): void {
  pi.registerCommand(`fzf:${cmd.name}`, {
    description: `Fuzzy find: ${cmd.list}`,
    handler: async (_args, ctx) => {
      await runFzfSelector(pi, cmd, ctx, settings);
    },
  });
}

function registerFzfShortcut(
  pi: ExtensionAPI,
  cmd: ResolvedCommand,
  settings: FzfSettings,
): void {
  if (!cmd.shortcut) return;

  pi.registerShortcut(cmd.shortcut, {
    description: `fzf:${cmd.name}`,
    handler: async (ctx) => {
      await runFzfSelector(pi, cmd, ctx, settings);
    },
  });
}

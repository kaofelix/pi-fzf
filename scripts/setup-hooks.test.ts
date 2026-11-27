import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "setup-hooks.sh");

let root: string;
let repo: string;
let log: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-fzf-setup-hooks-"));
  repo = join(root, "repo");
  log = join(root, "calls.log");
  const globalConfig = join(root, "gitconfig");
  writeFileSync(globalConfig, "");
  env = isolatedEnv(globalConfig);
  mkdirSync(repo);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!gitSupportsConfigHooks())("with config-based hooks", () => {
  it("makes git run lefthook for pre-commit", () => {
    initRepo();
    installLefthookStub();

    expect(runSetup().status).toBe(0);
    git("hook", "run", "--ignore-missing", "pre-commit");

    expect(calls()).toEqual(["lefthook run pre-commit"]);
  });

  it("runs the global pre-commit hook after lefthook and leaves its folder as it was", () => {
    const globalHooks = useGlobalHooksFolder();
    initRepo();
    installLefthookStub();

    expect(runSetup().status).toBe(0);
    git("hook", "run", "--ignore-missing", "pre-commit");

    expect(calls()).toEqual(["lefthook run pre-commit", "global pre-commit"]);
    expect(readdirSync(globalHooks)).toEqual(["pre-commit"]);
    expect(readFileSync(join(globalHooks, "pre-commit"), "utf8")).toBe(
      logLine("global pre-commit"),
    );
  });

  it("removes a pre-commit hook that lefthook wrote into the repository", () => {
    initRepo();
    installLefthookStub();
    const hook = writeRepoPreCommit(
      "#!/bin/sh\ncall_lefthook run pre-commit\n",
    );

    expect(runSetup().status).toBe(0);

    expect(existsSync(hook)).toBe(false);
  });

  it("keeps a repository pre-commit hook that lefthook did not write", () => {
    initRepo();
    installLefthookStub();
    const hook = writeRepoPreCommit("#!/bin/sh\necho mine\n");

    expect(runSetup().status).toBe(0);

    expect(existsSync(hook)).toBe(true);
    expect(readFileSync(hook, "utf8")).toBe("#!/bin/sh\necho mine\n");
  });

  it("runs lefthook once after a second setup", () => {
    initRepo();
    installLefthookStub();

    expect(runSetup().status).toBe(0);
    expect(runSetup().status).toBe(0);
    git("hook", "run", "--ignore-missing", "pre-commit");

    expect(calls()).toEqual(["lefthook run pre-commit"]);
  });

  it("replaces an earlier lefthook hook set for several events", () => {
    initRepo();
    installLefthookStub();
    git("config", "--local", "--add", "hook.lefthook.event", "pre-commit");
    git("config", "--local", "--add", "hook.lefthook.event", "pre-push");

    expect(runSetup().status).toBe(0);

    expect(git("config", "--local", "--get-all", "hook.lefthook.event")).toBe(
      "pre-commit\n",
    );
  });

  it("replaces an earlier lefthook hook with several commands", () => {
    initRepo();
    installLefthookStub();
    git("config", "--local", "--add", "hook.lefthook.command", "old-one");
    git("config", "--local", "--add", "hook.lefthook.command", "old-two");

    expect(runSetup().status).toBe(0);

    expect(git("config", "--local", "--get-all", "hook.lefthook.command")).toBe(
      "node_modules/.bin/lefthook run pre-commit\n",
    );
  });
});

it("does nothing in a package folder that is not a git checkout", () => {
  gitAt(root, "init", "-q");
  installLefthookStub();

  expect(runSetup().status).toBe(0);

  expect(hookConfig(root)).toBe("");
  expect(calls()).toEqual([]);
});

it("falls back to lefthook install on git before 2.54", () => {
  initRepo();
  installLefthookStub();

  const result = runSetup(oldGitPath());

  expect(result.status).toBe(0);
  expect(calls()).toEqual(["lefthook install"]);
  expect(hookConfig(repo)).toBe("");
  expect(result.stdout + result.stderr).toContain("2.54");
});

it("exits 0 on git before 2.54 when lefthook install refuses", () => {
  initRepo();
  installLefthookStub(1);

  expect(runSetup(oldGitPath()).status).toBe(0);
});

it("does nothing when lefthook is not installed", () => {
  initRepo();

  const result = runSetup();

  expect(result.status).toBe(0);
  expect(hookConfig(repo)).toBe("");
  expect(result.stdout + result.stderr).toBe("");
});

function isolatedEnv(globalConfig: string): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return {
    ...clean,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function gitSupportsConfigHooks(): boolean {
  const help = spawnSync("git", ["hook", "-h"], { encoding: "utf8" });
  return `${help.stdout}${help.stderr}`.includes("git hook list");
}

function useGlobalHooksFolder(): string {
  const folder = join(root, "global-hooks");
  writeExecutable(join(folder, "pre-commit"), logLine("global pre-commit"));
  writeFileSync(
    env.GIT_CONFIG_GLOBAL as string,
    `[core]\n\thooksPath = ${folder}\n`,
  );
  return folder;
}

function initRepo() {
  git("init", "-q");
}

function installLefthookStub(exitCode = 0) {
  writeExecutable(
    join(repo, "node_modules", ".bin", "lefthook"),
    `${logLine("lefthook $*")}exit ${exitCode}\n`,
  );
}

function writeRepoPreCommit(content: string): string {
  const hook = join(repo, ".git", "hooks", "pre-commit");
  writeExecutable(hook, content);
  return hook;
}

function logLine(text: string): string {
  return `#!/bin/sh\necho "${text}" >> "${log}"\n`;
}

function oldGitPath(): string {
  const realGit = spawnSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).stdout.trim();
  const bin = join(root, "old-git-bin");
  writeExecutable(
    join(bin, "git"),
    `#!/bin/sh
if [ "$1" = hook ]; then
  echo "usage: git hook run [--ignore-missing] [--to-stdin=<path>] <hook-name> [-- <hook-args>]" >&2
  exit 129
fi
exec "${realGit}" "$@"
`,
  );
  return `${bin}:${process.env.PATH}`;
}

function runSetup(path = process.env.PATH) {
  return spawnSync("sh", [SCRIPT], {
    cwd: repo,
    env: { ...env, PATH: path },
    encoding: "utf8",
  });
}

function hookConfig(dir: string): string {
  return spawnSync("git", ["config", "--local", "--get-regexp", "^hook\\."], {
    cwd: dir,
    env,
    encoding: "utf8",
  }).stdout;
}

function git(...args: string[]) {
  return gitAt(repo, ...args);
}

function gitAt(dir: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function calls(): string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").trim().split("\n");
}

function writeExecutable(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

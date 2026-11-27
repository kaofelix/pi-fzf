#!/bin/sh
# lefthook install writes its hook into core.hooksPath, which can be a folder
# that all repositories share. A config hook (git 2.54 or later) keeps the
# setup in this repository, and the hooks in core.hooksPath still run.
[ -e .git ] && [ -x node_modules/.bin/lefthook ] || exit 0
if ! git hook -h 2>&1 | grep -q 'git hook list'; then
  echo 'setup-hooks: a config hook needs git 2.54 or later, so lefthook install runs.'
  node_modules/.bin/lefthook install
  exit 0
fi
git config --local --replace-all hook.lefthook.event pre-commit
git config --local --replace-all hook.lefthook.command 'node_modules/.bin/lefthook run pre-commit'
hook="$(git rev-parse --git-common-dir)/hooks/pre-commit"
if grep -qs call_lefthook "$hook"; then rm "$hook"; fi

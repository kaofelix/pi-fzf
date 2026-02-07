---
description: Bump version, commit, tag, and push to trigger a release
---
Perform a release for this project:

1. Determine the appropriate version bump based on recent changes since the last tag. Follow semver: patch for fixes, minor for features, major for breaking changes. If I provided a version as argument, use that instead: $1
2. Update `CHANGELOG.md`: add a new section for the version with today's date, summarizing changes under Added/Changed/Fixed/Removed subsections as appropriate
3. Update the version in `package.json`
4. Commit all staged and unstaged changes with a descriptive commit message
5. Create a git tag matching the version (e.g. `v0.2.1`)
6. Push the commit and tag to origin

Before pushing, show me the version bump, changelog entry, commit message, and tag — and ask for confirmation.

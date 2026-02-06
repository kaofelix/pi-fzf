---
description: Bump version, commit, tag, and push to trigger a release
---
Perform a release for this project:

1. Determine the appropriate version bump based on recent changes since the last tag. Follow semver: patch for fixes, minor for features, major for breaking changes. If I provided a version as argument, use that instead: $1
2. Update the version in `package.json`
3. Commit all staged and unstaged changes with a descriptive commit message
4. Create a git tag matching the version (e.g. `v0.2.1`)
5. Push the commit and tag to origin

Before pushing, show me the version bump, commit message, and tag — and ask for confirmation.

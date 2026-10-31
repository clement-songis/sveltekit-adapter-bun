#!/usr/bin/env bash
# Points the `upstream-adapter-bun` branch at the latest release of packages/adapter-bun in
# sveltejs/kit, extracted with `git subtree split`. The split is deterministic, so the branch
# always extends the upstream commits this fork is built on, and merging it brings in the
# new release.
set -euo pipefail

repo="${UPSTREAM_REPO:-https://github.com/sveltejs/kit.git}"
branch="${UPSTREAM_BRANCH:-upstream-adapter-bun}"
tags='refs/tags/@sveltejs/adapter-bun@*'

# the newest stable release, unless UPSTREAM_REF names another ref
ref="${UPSTREAM_REF:-$(git ls-remote --tags --refs "$repo" "$tags" |
	awk '{ print $2 }' | grep -v -- '-' | sort -V | tail -n 1)}"

git fetch --no-tags "$repo" "+$ref:refs/remotes/kit/release"
split="$(git subtree split --prefix=packages/adapter-bun refs/remotes/kit/release 2>/dev/null)"
git branch --force "$branch" "$split"

echo "$branch is now ${ref#refs/tags/} ($(git log -1 --format=%h "$branch"))"

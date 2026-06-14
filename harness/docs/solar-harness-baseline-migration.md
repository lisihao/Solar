# Solar-harness baseline migration

Last updated: 2026-06-13

## Target

- Repository: `https://github.com/lisihao/Solar-harness`
- Branch: `main`
- Staging checkout: `/tmp/solar-harness-clean.ovGyFc`
- Source workspace kept intact: `/Users/lisihao/Solar`

## Current baseline

The clean Solar-harness baseline is built from the local `/Users/lisihao/Solar`
workspace, with runtime caches, local databases, local browser binaries, and
private configuration excluded.

Tracked files in the staging checkout should be content-compared against the
source workspace before switching the active development baseline. The latest
verified remote commit must be checked with `git ls-remote origin
refs/heads/main`.

## Explicitly excluded local artifacts

These entries are local machine state and should not be migrated as source:

- `.DS_Store`
- `library/.DS_Store`
- `library/Article/.DS_Store`
- `core/db/solar.db`
- `agents/secretary.md.bak`
- `harness/python-packages/browser/playwright/driver/node`
- `harness/browser-agent-chatgpt-local.json`
- literal runtime directories named `${HARNESS_DIR}` or `${SOLAR_KNOWLEDGE_DIR}`

## External submodule

`secretary/openclaw` is not migrated as a normal source directory. It is kept as
a Git submodule pointing at:

- remote: `https://github.com/openclaw/openclaw.git`
- recorded object: `1a7e180e6803993b51e3384fa23468815a9da4c1`

The source working directory contains heavy local runtime/build outputs such as
`node_modules/` and `dist/`. These are intentionally not copied into
Solar-harness.

## Switch readiness checks

Before changing the active development baseline, run:

```bash
cd /tmp/solar-harness-clean.ovGyFc
git status --short --branch
git ls-remote origin refs/heads/main
git submodule status -- secretary/openclaw
```

Then compare source and target content:

```bash
cd /tmp/solar-harness-clean.ovGyFc
git ls-files -z | while IFS= read -r -d '' f; do
  if [ -f "/Users/lisihao/Solar/$f" ] && ! cmp -s "$f" "/Users/lisihao/Solar/$f"; then
    printf 'M %s\n' "$f"
  elif [ ! -e "/Users/lisihao/Solar/$f" ]; then
    printf 'D %s\n' "$f"
  fi
done
```

Only switch the active working directory after the diff is empty or every
remaining entry is explicitly classified.

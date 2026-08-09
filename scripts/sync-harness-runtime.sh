#!/bin/bash
# Publish the repository-owned Solar Harness into the local runtime directory.
#
# Git is the code source of truth. Runtime queues, state, logs, caches, sprint
# artifacts, and local untracked extensions are never copied or deleted here.

set -euo pipefail

DRY_RUN=0
ROLLBACK_DIR=""

usage() {
    cat <<'USAGE'
Usage: scripts/sync-harness-runtime.sh [--dry-run] [--rollback BACKUP_DIR]

Publishes tracked harness code from a clean Solar Git worktree into
~/.solar/harness. Every real deployment creates a verified rollback bundle.

Options:
  --dry-run              Show files that would change without writing anything.
  --rollback BACKUP_DIR  Restore a rollback bundle created by this script.
  -h, --help             Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=1
            ;;
        --rollback)
            [[ $# -ge 2 ]] || { echo "--rollback requires a backup directory" >&2; exit 2; }
            ROLLBACK_DIR="$2"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

if [[ "$DRY_RUN" -eq 1 && -n "$ROLLBACK_DIR" ]]; then
    echo "--dry-run and --rollback cannot be combined" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOLAR_DIR="${SOLAR_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SOLAR_HOME="${SOLAR_HOME:-$HOME/.solar}"
SRC_HARNESS="${SRC_HARNESS:-$SOLAR_DIR/harness}"
DEST_HARNESS="${DEST_HARNESS:-$SOLAR_HOME/harness}"
BACKUP_ROOT="${HARNESS_BACKUP_ROOT:-$SOLAR_HOME/backups/harness-runtime}"

for command_name in git rsync shasum; do
    command -v "$command_name" >/dev/null 2>&1 || {
        echo "missing required command: $command_name" >&2
        exit 2
    }
done

LOCK_DIR="$DEST_HARNESS/run/runtime-sync.lockdir"
TMP_ROOT=""
LOCK_HELD=0

cleanup() {
    if [[ "$LOCK_HELD" -eq 1 ]]; then
        rmdir "$LOCK_DIR" 2>/dev/null || true
    fi
    if [[ -n "$TMP_ROOT" && -d "$TMP_ROOT" ]]; then
        rm -rf "$TMP_ROOT"
    fi
}
trap cleanup EXIT INT TERM

acquire_lock() {
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "runtime sync already active: $LOCK_DIR" >&2
        exit 3
    fi
    LOCK_HELD=1
}

checksum_manifest() {
    local root="$1"
    local manifest="$2"
    local output="$3"
    local rel hash link_target
    : > "$output"
    while IFS= read -r rel; do
        [[ -n "$rel" ]] || continue
        if [[ ! -e "$root/$rel" && ! -L "$root/$rel" ]]; then
            echo "missing manifest file: $root/$rel" >&2
            return 1
        fi
        if [[ -L "$root/$rel" ]]; then
            link_target="$(readlink "$root/$rel")"
            hash="$(printf 'symlink:%s' "$link_target" | shasum -a 256 | awk '{print $1}')"
        else
            hash="$(shasum -a 256 "$root/$rel" | awk '{print $1}')"
        fi
        printf '%s  %s\n' "$hash" "$rel" >> "$output"
    done < "$manifest"
}

rollback_runtime() {
    local backup_dir="$1"
    local rel
    [[ -d "$backup_dir" ]] || { echo "missing rollback bundle: $backup_dir" >&2; exit 2; }
    for required in deployed-manifest.txt existing-manifest.txt files; do
        [[ -e "$backup_dir/$required" ]] || {
            echo "invalid rollback bundle, missing: $required" >&2
            exit 2
        }
    done

    mkdir -p "$DEST_HARNESS/run" "$SOLAR_HOME/bin"
    acquire_lock

    if [[ -f "$backup_dir/created-manifest.txt" ]]; then
        while IFS= read -r rel; do
            [[ -n "$rel" ]] || continue
            if [[ -f "$DEST_HARNESS/$rel" || -L "$DEST_HARNESS/$rel" ]]; then
                rm -f "$DEST_HARNESS/$rel"
            fi
        done < "$backup_dir/created-manifest.txt"
    fi

    rsync -ac "$backup_dir/files/" "$DEST_HARNESS/"

    if [[ -f "$backup_dir/runtime-source.before" ]]; then
        cp "$backup_dir/runtime-source.before" "$DEST_HARNESS/.runtime-source"
    else
        rm -f "$DEST_HARNESS/.runtime-source"
    fi
    if [[ -f "$backup_dir/runtime-manifest.before" ]]; then
        cp "$backup_dir/runtime-manifest.before" "$DEST_HARNESS/.runtime-manifest"
    else
        rm -f "$DEST_HARNESS/.runtime-manifest"
    fi

    if [[ -s "$backup_dir/pre-deploy.sha256" ]]; then
        checksum_manifest "$DEST_HARNESS" "$backup_dir/existing-manifest.txt" "$backup_dir/rollback-actual.sha256"
        cmp -s "$backup_dir/pre-deploy.sha256" "$backup_dir/rollback-actual.sha256" || {
            echo "rollback checksum verification failed" >&2
            exit 4
        }
    fi

    echo "rollback=ok"
    echo "backup=$backup_dir"
    echo "destination=$DEST_HARNESS"
}

if [[ -n "$ROLLBACK_DIR" ]]; then
    ROLLBACK_DIR="$(cd "$ROLLBACK_DIR" && pwd)"
    rollback_runtime "$ROLLBACK_DIR"
    exit 0
fi

[[ -d "$SRC_HARNESS" ]] || { echo "missing harness source: $SRC_HARNESS" >&2; exit 2; }
SOLAR_DIR="$(cd "$SOLAR_DIR" && pwd)"
SRC_HARNESS="$(cd "$SRC_HARNESS" && pwd)"
if [[ -d "$DEST_HARNESS" ]]; then
    DEST_HARNESS="$(cd "$DEST_HARNESS" && pwd)"
fi

GIT_ROOT="$(git -C "$SOLAR_DIR" rev-parse --show-toplevel 2>/dev/null)" || {
    echo "Solar source is not a Git worktree: $SOLAR_DIR" >&2
    exit 2
}
GIT_ROOT="$(cd "$GIT_ROOT" && pwd)"
if [[ "$GIT_ROOT" != "$SOLAR_DIR" || "$SRC_HARNESS" != "$SOLAR_DIR/harness" ]]; then
    echo "source must be the harness directory of the selected Solar Git worktree" >&2
    exit 2
fi
if ! git -C "$SOLAR_DIR" diff --quiet -- harness || ! git -C "$SOLAR_DIR" diff --cached --quiet -- harness; then
    echo "refusing to deploy dirty tracked harness files from $SOLAR_DIR" >&2
    exit 3
fi

SOURCE_COMMIT="$(git -C "$SOLAR_DIR" rev-parse HEAD)"
SOURCE_SHORT="$(git -C "$SOLAR_DIR" rev-parse --short=12 HEAD)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/solar-harness-sync.XXXXXX")"
MANIFEST="$TMP_ROOT/deployed-manifest.txt"
EXISTING_MANIFEST="$TMP_ROOT/existing-manifest.txt"
CREATED_MANIFEST="$TMP_ROOT/created-manifest.txt"

git -C "$SOLAR_DIR" ls-files -- harness/ | while IFS= read -r tracked_path; do
    rel="${tracked_path#harness/}"
    case "$rel" in
        ""|.*|*/.*|*/__pycache__/*|cache/*|logs/*|run/*|state/*|sprints/*|venvs/*|vendor/*|quarantine/*|pm-predrafts/*)
            continue
            ;;
        *.log|*.pid|*.port|*.tmp|*.bak*|*.backup|*~)
            continue
            ;;
    esac
    case "$rel" in
        lib/*|tools/*|config/*|schemas/*|scripts/*|integrations/*|status-server/*|verifier/*|templates/*|personas/*|skills/*|evals/*|migrate/*|installer/*|solar_runtime/*|hooks/*|extensions/*|ui/*|release/*|experience/*|autopilot/*|launchd/*|bin/*|brain/*|queue/*)
            ;;
        *)
            if [[ "$rel" == */* ]]; then
                continue
            fi
            case "$rel" in
                VERSION|*.sh|*.py|*.ts|auto-boost-config.json|farm-layout.json|multi-task-profiles.json|gitleaks.toml)
                    ;;
                *)
                    continue
                    ;;
            esac
            ;;
    esac
    if [[ -e "$SRC_HARNESS/$rel" || -L "$SRC_HARNESS/$rel" ]]; then
        printf '%s\n' "$rel"
    fi
done > "$MANIFEST"

[[ -s "$MANIFEST" ]] || { echo "tracked harness manifest is empty" >&2; exit 3; }

if [[ "$DRY_RUN" -eq 1 ]]; then
    if [[ ! -d "$DEST_HARNESS" ]]; then
        echo "destination_missing=$DEST_HARNESS"
        echo "dry_run=ok"
        echo "source_commit=$SOURCE_COMMIT"
        echo "manifest_files=$(wc -l < "$MANIFEST" | tr -d ' ')"
        exit 0
    fi
    rsync -anic --files-from="$MANIFEST" "$SRC_HARNESS/" "$DEST_HARNESS/"
    echo "dry_run=ok"
    echo "source_commit=$SOURCE_COMMIT"
    echo "manifest_files=$(wc -l < "$MANIFEST" | tr -d ' ')"
    exit 0
fi

mkdir -p "$DEST_HARNESS/run" "$SOLAR_HOME/bin"
acquire_lock
mkdir -p "$BACKUP_ROOT"
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$SOURCE_SHORT-$$"
mkdir -p "$BACKUP_DIR/files"

while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    if [[ -e "$DEST_HARNESS/$rel" || -L "$DEST_HARNESS/$rel" ]]; then
        printf '%s\n' "$rel"
    fi
done < "$MANIFEST" > "$EXISTING_MANIFEST"
comm -23 "$MANIFEST" "$EXISTING_MANIFEST" > "$CREATED_MANIFEST"

cp "$MANIFEST" "$BACKUP_DIR/deployed-manifest.txt"
cp "$EXISTING_MANIFEST" "$BACKUP_DIR/existing-manifest.txt"
cp "$CREATED_MANIFEST" "$BACKUP_DIR/created-manifest.txt"
if [[ -f "$DEST_HARNESS/.runtime-source" ]]; then
    cp "$DEST_HARNESS/.runtime-source" "$BACKUP_DIR/runtime-source.before"
fi
if [[ -f "$DEST_HARNESS/.runtime-manifest" ]]; then
    cp "$DEST_HARNESS/.runtime-manifest" "$BACKUP_DIR/runtime-manifest.before"
fi

if [[ -s "$EXISTING_MANIFEST" ]]; then
    rsync -a --files-from="$EXISTING_MANIFEST" "$DEST_HARNESS/" "$BACKUP_DIR/files/"
    checksum_manifest "$DEST_HARNESS" "$EXISTING_MANIFEST" "$BACKUP_DIR/pre-deploy.sha256"
else
    : > "$BACKUP_DIR/pre-deploy.sha256"
fi

checksum_manifest "$SRC_HARNESS" "$MANIFEST" "$BACKUP_DIR/source.sha256"
rsync -ac --files-from="$MANIFEST" "$SRC_HARNESS/" "$DEST_HARNESS/"
checksum_manifest "$DEST_HARNESS" "$MANIFEST" "$BACKUP_DIR/deployed.sha256"
cmp -s "$BACKUP_DIR/source.sha256" "$BACKUP_DIR/deployed.sha256" || {
    echo "deployment checksum verification failed; rollback bundle: $BACKUP_DIR" >&2
    exit 4
}

cp "$MANIFEST" "$DEST_HARNESS/.runtime-manifest"

if [[ -f "$DEST_HARNESS/solar-harness.sh" ]]; then
    ln -sf "$DEST_HARNESS/solar-harness.sh" "$SOLAR_HOME/bin/solar-harness"
fi

MANIFEST_SHA="$(shasum -a 256 "$MANIFEST" | awk '{print $1}')"
cat > "$DEST_HARNESS/.runtime-source" <<EOF
source=$SRC_HARNESS
destination=$DEST_HARNESS
synced_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
repo=$SOLAR_DIR
source_commit=$SOURCE_COMMIT
manifest_sha256=$MANIFEST_SHA
backup=$BACKUP_DIR
EOF

echo "deployment=ok"
echo "source_commit=$SOURCE_COMMIT"
echo "manifest_files=$(wc -l < "$MANIFEST" | tr -d ' ')"
echo "backup=$BACKUP_DIR"
echo "destination=$DEST_HARNESS"

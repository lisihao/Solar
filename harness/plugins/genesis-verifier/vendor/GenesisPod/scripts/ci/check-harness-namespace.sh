#!/usr/bin/env bash
# scripts/ci/check-harness-namespace.sh
#
# Rev 5 / S0-6 mechanical guard suite (boundary audit 2026-05-09).
#
# 覆盖 7 项 grep-based 规则,补充 ESLint no-restricted-imports 不便表达的 content-level
# smell。任一项命中即 exit 1。
#
# ─── Stage 状态 ──────────────────────────────────────────────────────────────
# Stage 0 PR 落地时 [S1-2] 规则**预期会失败**(dispatcher cross-stage cache 字段尚未
# 迁移),作为 Stage 1 工作的入门哨。Stage 1 完成 S1-2 后此规则自然转 green,届时
# 本脚本即可作为 PR CI 强制 gate 接入。
#
# 当前期望状态(2026-05-09 Stage 0 落地时):
#   ✓  [R6]        ai-harness must not import from ai-app
#   ✓  [NS]        ai-harness must not contain 'agent-playground.' namespace literal
#   ✓  [STEPID]    ai-harness must not contain step-id literals
#   ✓  [STAGE-NUM] ai-harness must not compare stage numbers as integer literals
#   ✓  [DI-TOKEN]  ai-harness must not reference AGENT_PLAYGROUND_/PLAYGROUND_ DI tokens
#   ✗  [S1-2]      PlaygroundPipelineDispatcher class body cross-stage cache fields
#                  —— 预期失败,Stage 1 完成 S1-2 后转 green
#   ✓  [ENGINE]    ai-engine must not import mission-aware types
#
# 使用:
#   ./scripts/ci/check-harness-namespace.sh                # strict 模式,任一项 fail 即 exit 1
#   ./scripts/ci/check-harness-namespace.sh --quiet        # 仅在命中时输出
#   ./scripts/ci/check-harness-namespace.sh --stage-0-mode # Stage 0 advisory:[S1-2] 命中 warn 不 fail
#                                                        # (Stage 1 完成 S1-2 后移除此 flag,转 strict)
#
# 详见:
#   - docs/architecture/ai-app/agent-playground/agent-team-boundary-audit-2026-05-08.md §6.4 / §6.5 / §7 S0-6
#   - docs/architecture/ai-harness/facade/sediment-topology.md §4

set -uo pipefail

QUIET=0
STAGE_0_MODE=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --stage-0-mode)
      # Stage 0 advisory mode: [S1-2] rule(dispatcher cross-stage cache fields)
      # 命中只 warn 不阻塞,允许 Stage 0 PR 在 S1-2 未完成时通过 PR CI。
      # 其他规则违规仍 exit 1(防止 Stage 0 引入新 smell)。
      STAGE_0_MODE=1
      ;;
  esac
done

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

EXIT=0
FAILED=()

# Detect ripgrep; fall back to grep -rE if absent.
if command -v rg >/dev/null 2>&1; then
  RG=(rg --no-heading -n)
else
  # GNU grep flags: -r recursive, -n line numbers, -E extended regex
  RG=(grep -rEn)
fi

# ----------------------------------------------------------------------------
# Helper: check_grep "<rule label>" "<pattern>" "<path>" [<extra exclude-glob>...]
# ----------------------------------------------------------------------------
check_grep() {
  local label="$1"
  local pattern="$2"
  local path="$3"
  shift 3
  local extra_excludes=("$@")

  if [[ ! -d "$path" ]]; then
    [[ $QUIET -eq 1 ]] || echo "  ⊘  $label  (path not found, skipped: $path)"
    return 0
  fi

  local args=("${RG[@]}")
  if command -v rg >/dev/null 2>&1; then
    args+=(--glob '!**/__tests__/**' --glob '!**/*.spec.ts' --glob '!**/*.test.ts' --glob '!**/*.md')
    for ex in "${extra_excludes[@]}"; do
      args+=(--glob "!$ex")
    done
  else
    # GNU grep --include / --exclude
    args+=(--include='*.ts' --include='*.js' --exclude-dir='__tests__')
    for ex in "${extra_excludes[@]}"; do
      args+=(--exclude="$ex")
    done
  fi

  args+=("$pattern" "$path")

  local hits
  hits=$("${args[@]}" 2>/dev/null || true)

  if [[ -n "$hits" ]]; then
    echo "  ✗  $label  — VIOLATIONS:"
    echo "$hits" | sed 's/^/      /'
    FAILED+=("$label")
    EXIT=1
  else
    [[ $QUIET -eq 1 ]] || echo "  ✓  $label"
  fi
}

[[ $QUIET -eq 1 ]] || echo "▶ Rev 5 S0-6 mechanical guard suite — checking $ROOT"
[[ $QUIET -eq 1 ]] || echo

# ─── Rule 1 (R6): ai-harness/** 不得 import ai-app/** ────────────────────────
# 已由 backend/.eslintrc.js Section "ai-harness internal facade-barrel guard" + dependency
# direction(单向 ai-app → ai-harness → ai-engine)在 ESLint 层覆盖。本脚本做兜底 grep。
check_grep "[R6] ai-harness must not import from ai-app" \
  "from ['\"]@?[/]?modules/ai-app/" \
  "backend/src/modules/ai-harness"

# ─── Rule 2 (§6.4): ai-harness 内不出现 agent-playground 命名空间字面量 ───────
check_grep "[NS] ai-harness must not contain 'agent-playground.' namespace literal" \
  "['\"]agent-playground\\." \
  "backend/src/modules/ai-harness"

# ─── Rule 3 (§6.4): ai-harness 内不出现 step-id 字面量(s1-, s2-, s8b- 等)──
# step-id pattern: 字符串里出现 `s<num><letter?>-` 形式,且后跟 step name。
# 注意:Z5 stage primitive 的 enum value 例如 PLAN_PRIMITIVE 不属于 step-id,
# 仅命中字符串字面量。
check_grep "[STEPID] ai-harness must not contain step-id literals (s1-/s2-/s8b- etc.)" \
  "['\"]s[0-9]+[a-z]?-[a-z]" \
  "backend/src/modules/ai-harness"

# ─── Rule 4 (§6.4): ai-harness 内不出现 stage-number 字面比较 ────────────────
# 形如 `stage === 8` / `stageNum === 11` / `switch(stageNumber)` 后跟 case 数字。
check_grep "[STAGE-NUM] ai-harness must not compare stage numbers as integer literals" \
  "(stage|stageNum|stageNumber)\\s*===\\s*[0-9]+" \
  "backend/src/modules/ai-harness"

# ─── Rule 5 (§6.4): ai-harness 内不出现 AGENT_PLAYGROUND_ / PLAYGROUND_ DI tokens ─
# 防止反向 reference via @Inject(string),绕过静态 import lint。
check_grep "[DI-TOKEN] ai-harness must not reference AGENT_PLAYGROUND_/PLAYGROUND_ DI tokens" \
  "['\"](AGENT_PLAYGROUND_|PLAYGROUND_)" \
  "backend/src/modules/ai-harness"

# ─── Rule 6 (§6.4 / S1-2 closes): dispatcher 类体内不得出现 cross-stage 缓存字段声明 ─
# 字段类型:`private (readonly )?lastPlan...` / `private lastResearcherResults...` /
# `private s4PatchFailures...` 在 PlaygroundPipelineDispatcher class body。
DISPATCHER="backend/src/modules/ai-app/agent-playground/services/mission/workflow/playground-pipeline-dispatcher.service.ts"
if [[ -f "$DISPATCHER" ]]; then
  CACHE_HITS=$(grep -nE "^\\s+(private|protected|public)?\\s+(readonly\\s+)?(lastPlan|lastResearcherResults|s4PatchFailures)\\b" "$DISPATCHER" 2>/dev/null || true)
  if [[ -n "$CACHE_HITS" ]]; then
    if [[ $STAGE_0_MODE -eq 1 ]]; then
      echo "  ⚠  [S1-2] dispatcher cross-stage cache fields  — Stage 0 mode: advisory only"
      echo "$CACHE_HITS" | sed "s|^|      $DISPATCHER:|"
      echo "      (此规则将在 Stage 1 完成 S1-2 后转 strict;Stage 0 不阻塞 merge)"
    else
      echo "  ✗  [S1-2] PlaygroundPipelineDispatcher class body cross-stage cache fields  — VIOLATIONS:"
      echo "$CACHE_HITS" | sed "s|^|      $DISPATCHER:|"
      FAILED+=("[S1-2] dispatcher cross-stage cache fields")
      EXIT=1
    fi
  else
    [[ $QUIET -eq 1 ]] || echo "  ✓  [S1-2] PlaygroundPipelineDispatcher class body cross-stage cache fields"
  fi
else
  [[ $QUIET -eq 1 ]] || echo "  ⊘  [S1-2] dispatcher file not found, skipped: $DISPATCHER"
fi

# ─── Rule 7 (§6.4 last row / §6.5): ai-engine/** 不得 import mission-aware 类型 ─
# 检测 import 语句中 import 名 (`Mission*` / `Stage*` / `Pipeline*` / `MissionRun*`)。
# 注意:engine 自身可能有 LLM-related "Stream*" 等,不在禁止之列。
check_grep "[ENGINE] ai-engine must not import mission-aware types (Mission*/Stage*/Pipeline*)" \
  "import\\s.*\\b(Mission[A-Z][A-Za-z]*|Stage[A-Z][A-Za-z]*|Pipeline[A-Z][A-Za-z]*|MissionRun[A-Z]?[A-Za-z]*)" \
  "backend/src/modules/ai-engine"

[[ $QUIET -eq 1 ]] || echo

if [[ $EXIT -ne 0 ]]; then
  echo "✗ Rev 5 S0-6 mechanical guard suite — FAILED (${#FAILED[@]} rule(s) violated)"
  for f in "${FAILED[@]}"; do echo "    - $f"; done
  exit 1
fi

echo "✓ Rev 5 S0-6 mechanical guard suite — all checks passed"
exit 0

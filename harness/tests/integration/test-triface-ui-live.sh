#!/usr/bin/env bash
# tests/integration/test-triface-ui-live.sh
# V4_ui_live_verdict acceptance: verify the real 8765 status-server
# /orchestration dashboard JSON + rendered DOM for P0/P2/P3 source tiers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BASE_URL="${SOLAR_STATUS_BASE_URL:-http://127.0.0.1:8765}"
REPORT_DIR="$HARNESS_ROOT/reports/s05/ui-live"
NODE_BIN="${NODE_BIN:-/Users/lisihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
PLAYWRIGHT_REQUIRE="${PLAYWRIGHT_REQUIRE:-/Users/lisihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright}"
PASS=0
FAIL=0

SID_P0="sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s04-orchestration-ui"
SID_P2="epic-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything"
SID_P3="b4-rereview-closure-gate-codex"

CLOSURE_REQUIRED_FIELDS=(
  "all_nodes_passed"
  "all_required_gates_passed"
  "acceptance_traceability_coverage"
  "tests"
  "evals"
  "changed_files"
  "residual_risks"
)

mkdir -p "$REPORT_DIR"

pass() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }
info() { echo "  INFO: $*"; }

urlencode() {
  python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

json_get() {
  python3 -c "import json,sys; d=json.load(open(sys.argv[1], encoding='utf-8')); print(eval(sys.argv[2]))" "$1" "$2"
}

assert_http_200() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /tmp/solar-v4-http.out -w '%{http_code}' --max-time 5 "$url" || true)
  if [[ "$code" == "200" ]]; then
    pass "$label HTTP 200"
  else
    fail "$label HTTP $code expected 200"
  fi
}

check_dashboard_json() {
  local tier="$1" sid="$2" expected_tier="$3" expect_missing_nonempty="$4"
  local enc out verdict
  enc=$(urlencode "$sid")
  out="$REPORT_DIR/dashboard-${tier,,}.json"
  verdict="$REPORT_DIR/verdict-${tier,,}.json"

  info "Checking $tier dashboard: $sid"
  if curl -fsS --max-time 10 "$BASE_URL/orchestration/dashboard?sprint_id=$enc" -o "$out"; then
    pass "$tier dashboard JSON fetched"
  else
    fail "$tier dashboard JSON fetch failed"
    return
  fi

  python3 - "$out" "$verdict" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
cc = data.get("data", {}).get("closure_card", {})
json.dump(cc, open(sys.argv[2], "w", encoding="utf-8"), indent=2, ensure_ascii=False)
PY

  local ok_val actual_tier
  ok_val=$(json_get "$out" "str(d.get('ok')).lower()")
  actual_tier=$(json_get "$out" "d['data']['triface']['source_tier']")
  [[ "$ok_val" == "true" ]] && pass "$tier ok=true" || fail "$tier ok=$ok_val expected true"
  [[ "$actual_tier" == "$expected_tier" ]] && pass "$tier source_tier=$actual_tier" || fail "$tier source_tier=$actual_tier expected $expected_tier"

  for field in "${CLOSURE_REQUIRED_FIELDS[@]}"; do
    local has_field
    has_field=$(json_get "$out" "'yes' if '$field' in d['data']['closure_card'] else 'no'")
    [[ "$has_field" == "yes" ]] && pass "$tier closure_card.$field present" || fail "$tier closure_card.$field missing"
  done

  local missing_len
  missing_len=$(json_get "$out" "len(d['data']['closure_card'].get('missing_fields', []))")
  if [[ "$expect_missing_nonempty" == "yes" ]]; then
    [[ "$missing_len" -gt 0 ]] && pass "$tier missing_fields non-empty len=$missing_len" || fail "$tier missing_fields expected non-empty"
  else
    [[ "$missing_len" -eq 0 ]] && pass "$tier missing_fields empty" || fail "$tier missing_fields expected empty got len=$missing_len"
  fi
}

echo "=== V4 real status-server orchestration UI test ==="
echo "BASE_URL=$BASE_URL"

assert_http_200 "healthz" "$BASE_URL/healthz"
assert_http_200 "orchestration dashboard" "$BASE_URL/orchestration/dashboard?sprint_id=x"
assert_http_200 "static orchestration_panel.js" "$BASE_URL/static/orchestration_panel.js"
assert_http_200 "static orchestration_panel.css" "$BASE_URL/static/orchestration_panel.css"

check_dashboard_json "P0" "$SID_P0" "P0" "no"
check_dashboard_json "P2" "$SID_P2" "P2" "yes"
check_dashboard_json "P3" "$SID_P3" "P3" "yes"

echo "=== DOM closure-verdict assertion ==="
if [[ ! -x "$NODE_BIN" ]]; then
  fail "Node runtime not executable: $NODE_BIN"
elif [[ ! -d "$PLAYWRIGHT_REQUIRE" ]]; then
  fail "Playwright package missing: $PLAYWRIGHT_REQUIRE"
else
  BASE_URL="$BASE_URL" REPORT_DIR="$REPORT_DIR" PLAYWRIGHT_REQUIRE="$PLAYWRIGHT_REQUIRE" "$NODE_BIN" <<'JS'
const { chromium } = require(process.env.PLAYWRIGHT_REQUIRE);
const fs = require('fs');
const path = require('path');

const sprints = {
  p0: "sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s04-orchestration-ui",
  p2: "epic-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything",
  p3: "b4-rereview-closure-gate-codex",
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let failed = 0;
  for (const [tier, sid] of Object.entries(sprints)) {
    const url = `${process.env.BASE_URL}/orchestration?sprint_id=${encodeURIComponent(sid)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector('[data-role="closure-verdict"]', { timeout: 10000 }).catch(() => null);
    const locator = page.locator('[data-role="closure-verdict"]');
    const count = await locator.count();
    const screenshot = path.join(process.env.REPORT_DIR, `dashboard-${tier}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    if (count > 0) {
      const text = (await locator.first().innerText()).trim();
      console.log(`PASS: ${tier} closure-verdict found: ${text}`);
    } else {
      console.log(`FAIL: ${tier} closure-verdict missing`);
      failed += 1;
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(process.env.REPORT_DIR, "dom-verdict.json"), JSON.stringify({ ok: failed === 0, failed }, null, 2) + "\n");
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
JS
  dom_exit=$?
  if [[ "$dom_exit" -eq 0 ]]; then
    pass "DOM [data-role=closure-verdict] found for P0/P2/P3"
  else
    fail "DOM [data-role=closure-verdict] assertion failed"
  fi
fi

echo "=== Results ==="
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
echo "ALL TESTS PASSED"

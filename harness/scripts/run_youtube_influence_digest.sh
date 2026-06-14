#!/usr/bin/env bash
set -euo pipefail

SOLAR_REPO="${SOLAR_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
CONFIG="${YOUTUBE_INFLUENCE_DIGEST_CONFIG:-$HARNESS_DIR/config/youtube-influence-digest.yaml}"
PYTHON="${PYTHON:-python3}"
MAIL_CONFIG="${AI_INFLUENCE_MAIL_CONFIG:-/Users/lisihao/.solar/harness/state/ai-influence-mail-config.json}"

source "$HARNESS_DIR/scripts/lib/browser_agent_queue.sh"
solar_browser_agent_enqueue_or_continue "youtube-influence-digest" "$HARNESS_DIR" "$0" "$@"

if [[ -z "${GMAIL_USER:-}" && -f "$MAIL_CONFIG" ]]; then
  GMAIL_USER="$("$PYTHON" - "$MAIL_CONFIG" <<'PY'
import json
import sys
from pathlib import Path

try:
    print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("from") or "")
except Exception:
    print("")
PY
)"
fi

if [[ -z "${AI_INFLUENCE_MAIL_TO:-}" && -f "$MAIL_CONFIG" ]]; then
  AI_INFLUENCE_MAIL_TO="$("$PYTHON" - "$MAIL_CONFIG" <<'PY'
import json
import sys
from pathlib import Path

try:
    print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("to") or "")
except Exception:
    print("")
PY
)"
fi

export AI_INFLUENCE_MAIL_CONFIG="$MAIL_CONFIG"
export GMAIL_USER="${GMAIL_USER:-lisihao@gmail.com}"
export GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE="${GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE:-solar-ai-influence-gmail}"
export AI_INFLUENCE_MAIL_TO="${AI_INFLUENCE_MAIL_TO:-}"
export YOUTUBE_INFLUENCE_DIGEST_SEND_MAIL="${YOUTUBE_INFLUENCE_DIGEST_SEND_MAIL:-true}"

OUT_FILE="$(mktemp -t youtube-influence-digest.XXXXXX.json)"
trap 'rm -f "$OUT_FILE"' EXIT

set +e
"$PYTHON" "$HARNESS_DIR/scripts/youtube_influence_digest.py" --config "$CONFIG" "$@" | tee "$OUT_FILE"
RC=${PIPESTATUS[0]}
set -e

if [[ "$RC" -ne 0 ]]; then
  exit "$RC"
fi

if [[ "$YOUTUBE_INFLUENCE_DIGEST_SEND_MAIL" == "true" ]]; then
  "$PYTHON" - "$HARNESS_DIR" "$OUT_FILE" <<'PY'
import importlib.util
import json
import re
import sys
from pathlib import Path

harness_dir = Path(sys.argv[1])
stdout_file = Path(sys.argv[2])
stdout_text = stdout_file.read_text(encoding="utf-8", errors="replace")

payload = None
for match in re.finditer(r"\{", stdout_text):
    candidate = stdout_text[match.start():].strip()
    try:
        parsed = json.loads(candidate)
    except Exception:
        continue
    if isinstance(parsed, dict) and parsed.get("digest_path"):
        payload = parsed

if not payload:
    print(json.dumps({"mail": {"ok": False, "error": "digest_result_not_found"}}, ensure_ascii=False))
    sys.exit(0)

digest_path = Path(str(payload["digest_path"])).expanduser()
if not digest_path.exists():
    print(json.dumps({"mail": {"ok": False, "error": "digest_path_missing", "digest_path": str(digest_path)}}, ensure_ascii=False))
    sys.exit(0)

module_path = harness_dir / "scripts" / "tech_hotspot_radar.py"
spec = importlib.util.spec_from_file_location("tech_hotspot_radar_mail", module_path)
if spec is None or spec.loader is None:
    print(json.dumps({"mail": {"ok": False, "error": "tech_hotspot_radar_import_failed"}}, ensure_ascii=False))
    sys.exit(0)

module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

markdown = digest_path.read_text(encoding="utf-8", errors="replace")
body = module.markdown_to_email_html(markdown) if hasattr(module, "markdown_to_email_html") else markdown
subject = f"YouTube 洞察摘要 — {digest_path.parent.name}"
html = f"""
<html>
  <body>
    <p>报告已生成，见附件与下方正文。</p>
    {body}
  </body>
</html>
"""
result = module.send_html_email(html, subject, [digest_path])
result_payload = {
    "mail": result,
    "digest_path": str(digest_path),
    "subject": subject,
}
(digest_path.parent / "mail-result.json").write_text(
    json.dumps(result_payload, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
print(json.dumps(result_payload, ensure_ascii=False))
PY
else
  printf '%s\n' '{"mail":{"ok":true,"skipped":true,"reason":"YOUTUBE_INFLUENCE_DIGEST_SEND_MAIL=false"}}'
fi

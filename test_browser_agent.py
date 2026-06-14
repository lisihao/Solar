import json
import sys
import pathlib

sys.path.insert(0, "/Users/lisihao/Solar/harness/scripts")
import tech_hotspot_radar

config = {}
print("Testing with headless=False...")
try:
    res = tech_hotspot_radar.call_browser_agent_chatgpt_markdown(
        "Say hello",
        config,
        purpose="test-cloudflare-headed",
        open_project_first=False,
        require_project=False,
        headless=False,
    )
    print("Success:", json.dumps(res, indent=2))
except Exception as e:
    print("Error:", type(e).__name__, str(e))

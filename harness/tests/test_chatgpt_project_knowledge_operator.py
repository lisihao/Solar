from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "harness" / "tools" / "chatgpt_project_knowledge_operator.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("chatgpt_project_knowledge_operator_test", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_html_to_markdown_preserves_table_and_code_block():
    mod = _load_module()
    markdown = mod.html_to_markdown(
        """
        <p>结论</p>
        <table>
          <tr><th>项目</th><th>判断</th></tr>
          <tr><td>Agent</td><td>上升</td></tr>
        </table>
        <pre><code>print("ok")</code></pre>
        """
    )
    assert "| 项目 | 判断 |" in markdown
    assert "| Agent | 上升 |" in markdown
    assert "```" in markdown
    assert 'print("ok")' in markdown


def test_build_qa_pairs_keeps_question_answer_markdown():
    mod = _load_module()
    conversation = mod.normalize_conversation(
        {
            "conversation_id": "abc",
            "url": "https://chatgpt.com/c/abc",
            "title": "测试会话",
            "messages": [
                {"role": "user", "text": "问题一", "markdown": "## 问题一"},
                {
                    "role": "assistant",
                    "text": "答案一",
                    "html": "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
                },
                {"role": "user", "text": "问题二", "markdown": "问题二"},
                {"role": "assistant", "text": "答案二", "markdown": "- 答案二"},
            ],
        }
    )
    pairs = mod.build_qa_pairs(conversation)
    assert len(pairs) == 2
    assert pairs[0]["question_markdown"] == "## 问题一"
    assert "| A | B |" in pairs[0]["answer_markdown"]
    assert pairs[1]["answer_markdown"] == "- 答案二"


def test_build_qa_pairs_merges_consecutive_user_messages_before_answer():
    mod = _load_module()
    conversation = mod.normalize_conversation(
        {
            "conversation_id": "abc",
            "url": "https://chatgpt.com/c/abc",
            "messages": [
                {"role": "user", "text": "补充一", "markdown": "补充一"},
                {"role": "user", "text": "补充二", "markdown": "补充二"},
                {"role": "assistant", "text": "统一回答", "markdown": "统一回答"},
            ],
        }
    )
    pairs = mod.build_qa_pairs(conversation)
    assert len(pairs) == 1
    assert pairs[0]["question_indices"] == [0, 1]
    assert "补充一" in pairs[0]["question_markdown"]
    assert "补充二" in pairs[0]["question_markdown"]
    assert pairs[0]["answer_markdown"] == "统一回答"


def test_normalize_conversation_url_preserves_project_context():
    mod = _load_module()
    url = mod.normalize_conversation_url(
        "https://chatgpt.com/g/g-p-abc-project/c/6a2c58e1-5798-83e8-a67c-3fdce1fb0396"
    )
    assert url == "https://chatgpt.com/g/g-p-abc-project/c/6a2c58e1-5798-83e8-a67c-3fdce1fb0396"


def test_project_discovery_expands_folded_conversation_lists():
    mod = _load_module()
    js = mod.CHATGPT_EXPAND_PROJECT_CONVERSATIONS_JS
    assert "aria-expanded" in js
    assert "show\\s+more" in js
    assert "加载更多" in js
    assert "scrollTop" in js
    assert "ariaExpanded === 'false' ||" not in js


def test_project_discovery_scopes_to_project_main_content_not_global_sidebar():
    mod = _load_module()
    discover_js = mod.CHATGPT_DISCOVER_PROJECT_CONVERSATIONS_JS
    expand_js = mod.CHATGPT_EXPAND_PROJECT_CONVERSATIONS_JS
    assert "main, [role=\"main\"]" in expand_js
    assert "projectSlug" in discover_js
    assert "'/g/' + projectSlug + '/c/'" in discover_js
    assert "project_scoped_only" in discover_js
    assert "isGlobalNav" in discover_js
    assert "isGlobalNav" in expand_js
    assert "aside, nav" in discover_js
    assert "aside, nav" in expand_js


def test_write_artifacts_outputs_manifest_jsonl_markdown_and_html(tmp_path):
    mod = _load_module()
    conversation = mod.normalize_conversation(
        {
            "conversation_id": "abc",
            "url": "https://chatgpt.com/c/abc",
            "title": "测试会话",
            "messages": [
                {"role": "user", "text": "问题", "markdown": "问题"},
                {"role": "assistant", "text": "答案", "markdown": "| A | B |\n| --- | --- |\n| 1 | 2 |"},
            ],
        }
    )
    manifest = mod.write_artifacts([conversation], tmp_path, source={"mode": "fixture"})
    assert manifest["schema_version"] == "solar.chatgpt_project_knowledge.v1"
    assert manifest["conversation_count"] == 1
    assert manifest["qa_pair_count"] == 1
    assert manifest["quality"]["status"] == "ok"
    assert (tmp_path / "manifest.json").exists()
    assert (tmp_path / "qa-pairs.jsonl").exists()
    assert "| A | B |" in (tmp_path / "abc" / "conversation.md").read_text(encoding="utf-8")
    assert "<!doctype html>" in (tmp_path / "abc" / "conversation.html").read_text(encoding="utf-8")
    row = json.loads((tmp_path / "qa-pairs.jsonl").read_text(encoding="utf-8").strip())
    assert row["conversation_id"] == "abc"


def test_write_artifacts_marks_unanswered_pairs_as_warn(tmp_path):
    mod = _load_module()
    conversation = mod.normalize_conversation(
        {
            "conversation_id": "abc",
            "url": "https://chatgpt.com/c/abc",
            "messages": [
                {"role": "user", "text": "问题", "markdown": "问题"},
            ],
        }
    )
    manifest = mod.write_artifacts([conversation], tmp_path, source={"mode": "fixture"})
    assert manifest["quality"]["status"] == "warn"
    assert manifest["quality"]["unanswered_pair_count"] == 1


def test_logical_operator_registration_points_to_existing_actor_and_command():
    logical = json.loads((ROOT / "harness" / "config" / "logical-operators.json").read_text(encoding="utf-8"))
    actors = json.loads((ROOT / "harness" / "config" / "agent-actors.json").read_text(encoding="utf-8"))
    physical = json.loads((ROOT / "harness" / "config" / "physical-operators.json").read_text(encoding="utf-8"))

    op = logical["logical_operators"]["ChatGPTProjectKnowledgeExtractor"]
    assert op["primary_role"] == "knowledge-extractor"
    candidate = logical["bindings"]["ChatGPTProjectKnowledgeExtractor"]["candidates"][0]["actor_id"]
    assert candidate == "mini-chatgpt-project-knowledge-extractor"
    assert candidate in actors["actors"]
    assert candidate in physical["operators"]
    assert "chatgpt_project_knowledge_operator.py" in physical["operators"][candidate]["command"]

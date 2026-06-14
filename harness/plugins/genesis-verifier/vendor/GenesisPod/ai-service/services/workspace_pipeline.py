"""
Workspace AI pipeline that synthesizes structured workspace reports.
This MVP version generates deterministic output without calling external models
while preserving the future integration surface.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List

from pydantic import BaseModel

from services.template_loader import template_repository

if TYPE_CHECKING:
    from services.workspace_task_manager import WorkspaceTaskPayload


class WorkspacePipelineResult(BaseModel):
    result: Dict[str, Any]
    metadata: Dict[str, Any]


class WorkspacePipeline:
    """
    Generates structured report data from a workspace task payload.
    Later revisions can delegate to real AI orchestrators; currently it aggregates resources.
    """

    async def run(self, payload: "WorkspaceTaskPayload") -> WorkspacePipelineResult:
        template = template_repository.get(payload.template_id)

        if not template:
            raise ValueError(f"模板 {payload.template_id} 不存在")

        resources = payload.resources or []
        summary_lines: List[str] = []
        detail_lines: List[str] = []

        for index, item in enumerate(resources, start=1):
            res = item.get("resource", {})
            title = res.get("title") or "未命名资源"
            resource_type = res.get("type") or "unknown"
            primary_category = res.get("primaryCategory")
            summary = res.get("aiSummary") or res.get("abstract") or "暂无摘要"

            summary_lines.append(f"{index}. {title}（{resource_type}）")
            detail_lines.append(
                f"### {title}\n"
                f"- 类型：{resource_type}"
                + (f"\n- 分类：{primary_category}" if primary_category else "")
                + f"\n- 摘要：{summary}\n"
            )

        question_prompt = payload.question or "未提供额外问题"
        overview = "\n".join(summary_lines) if summary_lines else "暂无资源"
        detail_block = "\n".join(detail_lines) if detail_lines else "暂无详细内容"

        summary_text = (
            f"共分析 {len(resources)} 个资源；"
            f"以下记录了每个资源的核心信息，并参考用户问题：{question_prompt}"
        )

        sections = [
            {
                "title": "资源概览",
                "content": overview,
            },
            {
                "title": "用户问题",
                "content": question_prompt,
            },
            {
                "title": "详细内容",
                "content": detail_block,
            },
        ]

        result = {
            "summary": summary_text,
            "sections": sections,
        }

        metadata = {
            "templateId": payload.template_id,
            "model": payload.model,
            "generatedAt": datetime.utcnow().isoformat(),
            "resourceCount": len(resources),
        }

        return WorkspacePipelineResult(result=result, metadata=metadata)

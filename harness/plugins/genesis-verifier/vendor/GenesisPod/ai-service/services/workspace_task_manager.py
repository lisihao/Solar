"""
Workspace task manager (MVP in-memory implementation).
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel

from services.template_loader import template_repository
from services.workspace_pipeline import WorkspacePipeline, WorkspacePipelineResult


class WorkspaceTaskPayload(BaseModel):
    workspace_id: str
    template_id: str
    model: str
    resources: list[dict[str, Any]]
    question: Optional[str] = None
    overrides: Optional[dict[str, Any]] = None
    resource_ids: Optional[list[str]] = None


class WorkspaceTaskStatus(BaseModel):
    id: str
    status: str
    created_at: datetime
    updated_at: datetime
    queue_position: Optional[int] = None
    estimated_time: Optional[int] = None
    result: Optional[dict[str, Any]] = None
    error: Optional[dict[str, Any]] = None
    metadata: dict[str, Any] = {}


@dataclass
class InMemoryTask:
    payload: WorkspaceTaskPayload
    status: str = "pending"
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    queue_position: Optional[int] = None
    estimated_time: Optional[int] = None
    result: Optional[dict[str, Any]] = None
    error: Optional[dict[str, Any]] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_status(self, task_id: str) -> WorkspaceTaskStatus:
        return WorkspaceTaskStatus(
            id=task_id,
            status=self.status,
            created_at=self.created_at,
            updated_at=self.updated_at,
            queue_position=self.queue_position,
            estimated_time=self.estimated_time,
            result=self.result,
            error=self.error,
            metadata=self.metadata,
        )


class WorkspaceTaskManager:
    """
    MVP task manager backed by in-memory storage.

    Later revisions can replace this with Redis/Celery queues while exposing
    the same interface.
    """

    def __init__(self):
        self._tasks: Dict[str, InMemoryTask] = {}
        self._lock = asyncio.Lock()
        self._pipeline: Optional[WorkspacePipeline] = None

    def set_pipeline(self, pipeline: WorkspacePipeline):
        self._pipeline = pipeline

    async def create_task(self, payload: WorkspaceTaskPayload) -> WorkspaceTaskStatus:
        task_id = str(uuid.uuid4())
        task = InMemoryTask(payload=payload)

        async with self._lock:
            self._tasks[task_id] = task

        asyncio.create_task(self._run_task(task_id))

        return task.to_status(task_id)

    async def get_task(self, task_id: str) -> WorkspaceTaskStatus:
        async with self._lock:
            task = self._tasks.get(task_id)

        if not task:
            raise KeyError(f"task {task_id} not found")

        return task.to_status(task_id)

    async def update_task(
        self,
        task_id: str,
        *,
        status: Optional[str] = None,
        result: Optional[dict[str, Any]] = None,
        error: Optional[dict[str, Any]] = None,
        queue_position: Optional[int] = None,
        estimated_time: Optional[int] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> WorkspaceTaskStatus:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(f"task {task_id} not found")

            if status is not None:
                task.status = status
            if result is not None:
                task.result = result
            if error is not None:
                task.error = error
            if queue_position is not None:
                task.queue_position = queue_position
            if estimated_time is not None:
                task.estimated_time = estimated_time
            if metadata is not None:
                task.metadata = metadata
            task.updated_at = datetime.utcnow()

        return task.to_status(task_id)

    async def _run_task(self, task_id: str):
        await asyncio.sleep(0)
        try:
            await self.update_task(task_id, status="running")
        except KeyError:
            return

        async with self._lock:
            task = self._tasks.get(task_id)

        if not task:
            return

        try:
            if self._pipeline:
                result: WorkspacePipelineResult = await self._pipeline.run(task.payload)
                await self.update_task(
                    task_id,
                    status="success",
                    result=result.result,
                    metadata=result.metadata,
                )
            else:
                await self._fallback_task(task_id, task)
        except Exception as exc:
            await self.update_task(
                task_id,
                status="failed",
                error={"message": str(exc)},
            )

    async def _fallback_task(self, task_id: str, task: InMemoryTask):
        await asyncio.sleep(0.5)
        template = template_repository.get(task.payload.template_id)
        summary = f"{template.name if template else 'AI'} 自动生成的报告摘要"
        sections = [
            {
                "title": "概览",
                "content": f"共有 {len(task.payload.resources)} 个资源参与分析。",
            },
            {
                "title": "提示内容",
                "content": task.payload.question or "未提供额外问题，使用默认模板分析。",
            },
        ]
        await self.update_task(
            task_id,
            status="success",
            result={
                "summary": summary,
                "sections": sections,
            },
            metadata={
                "templateId": task.payload.template_id,
                "model": task.payload.model,
                "resourceIds": task.payload.resource_ids or [],
            },
        )


# Singleton manager (MVP)
workspace_task_manager = WorkspaceTaskManager()

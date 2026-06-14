from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional

from services.workspace_task_manager import (
    WorkspaceTaskPayload,
    workspace_task_manager,
    WorkspaceTaskStatus,
)
from utils.feature_flags import is_workspace_ai_v2_enabled


class CreateWorkspaceTaskRequest(BaseModel):
    workspaceId: str = Field(..., description="Workspace ID")
    templateId: str = Field(..., description="Report template ID")
    model: str = Field(..., description="Model identifier, e.g. grok/gpt-4")
    resources: List[Dict[str, Any]] = Field(..., description="Selected resources payload")
    question: Optional[str] = None
    overrides: Optional[Dict[str, Any]] = None
    resourceIds: Optional[List[str]] = Field(default=None, description="Filtered resource ids used for the task")


class WorkspaceTaskStatusResponse(WorkspaceTaskStatus):
    pass


router = APIRouter(prefix="/workspace-tasks", tags=["Workspace Tasks"])


def _ensure_enabled():
    if not is_workspace_ai_v2_enabled():
        raise HTTPException(status_code=404, detail="Workspace AI v2 未启用")


@router.post("", response_model=WorkspaceTaskStatusResponse)
async def create_workspace_task(request: CreateWorkspaceTaskRequest):
    _ensure_enabled()

    payload = WorkspaceTaskPayload(
        workspace_id=request.workspaceId,
        template_id=request.templateId,
        model=request.model,
        resources=request.resources,
        question=request.question,
        overrides=request.overrides,
        resource_ids=request.resourceIds,
    )
    status = await workspace_task_manager.create_task(payload)
    return status


@router.get("/{task_id}", response_model=WorkspaceTaskStatusResponse)
async def get_workspace_task_status(task_id: str):
    _ensure_enabled()
    try:
        return await workspace_task_manager.get_task(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"任务 {task_id} 不存在")

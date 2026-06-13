"""
数据模型定义
"""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SummaryRequest(BaseModel):
    """摘要生成请求"""

    content: str = Field(..., description="原始内容")
    max_length: Optional[int] = Field(200, description="最大摘要长度（字数）")
    language: Optional[Literal["zh", "en"]] = Field("zh", description="输出语言")


class SummaryResponse(BaseModel):
    """摘要生成响应"""

    model_config = ConfigDict(protected_namespaces=())

    summary: str = Field(..., description="生成的摘要")
    model_used: str = Field(..., description="使用的模型（grok/openai）")
    timestamp: datetime = Field(default_factory=datetime.now)


class InsightRequest(BaseModel):
    """洞察提取请求"""

    content: str = Field(..., description="原始内容")
    language: Optional[Literal["zh", "en"]] = Field("zh", description="输出语言")


class Insight(BaseModel):
    """单个洞察"""

    title: str = Field(..., description="洞察标题")
    description: str = Field(..., description="洞察描述")
    importance: Literal["high", "medium", "low"] = Field("medium", description="重要性")


class InsightResponse(BaseModel):
    """洞察提取响应"""

    model_config = ConfigDict(protected_namespaces=())

    insights: List[Insight] = Field(..., description="提取的洞察列表")
    model_used: str = Field(..., description="使用的模型")
    timestamp: datetime = Field(default_factory=datetime.now)


class ClassificationRequest(BaseModel):
    """分类请求"""

    content: str = Field(..., description="原始内容")


class ClassificationResponse(BaseModel):
    """分类响应"""

    model_config = ConfigDict(protected_namespaces=())

    category: str = Field(..., description="主类别")
    subcategories: List[str] = Field(default_factory=list, description="子类别")
    tags: List[str] = Field(default_factory=list, description="标签")
    difficulty_level: Literal["beginner", "intermediate", "advanced", "expert"] = Field(
        "intermediate",
        description="难度等级",
    )
    model_used: str = Field(..., description="使用的模型")
    timestamp: datetime = Field(default_factory=datetime.now)


class HealthResponse(BaseModel):
    """健康检查响应"""

    status: Literal["ok", "degraded", "error"]
    grok_available: bool
    openai_available: bool
    active_model: str
    timestamp: datetime = Field(default_factory=datetime.now)


class GenerateStructuredSummaryRequest(BaseModel):
    """结构化摘要生成请求"""

    content: str = Field(..., description="原始内容")
    resourceType: Literal[
        "PAPER",
        "NEWS",
        "YOUTUBE_VIDEO",
        "PROJECT",
        "OTHER",
        "BLOG",
        "REPORT",
        "EVENT",
        "RSS",
    ] = Field(..., description="资源类型")
    language: str = Field("zh", description="输出语言")
    title: Optional[str] = Field(None, description="资源标题")
    abstract: Optional[str] = Field(None, description="资源摘要")


class GenerateStructuredSummaryResponse(BaseModel):
    """结构化摘要生成响应"""

    summary: dict = Field(..., description="生成的结构化摘要")
    model: str = Field(..., description="使用的模型")
    generationTime: Optional[float] = Field(None, description="生成时间(ms)")

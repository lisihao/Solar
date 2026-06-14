"""
趋势分析 API 路由
"""
from fastapi import APIRouter, HTTPException, Depends
from loguru import logger
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Literal

from services.trend_analysis import TrendAnalysisService, TechComparisonService
from services.ai_orchestrator import AIOrchestrator


router = APIRouter(prefix="/trend", tags=["Trend Analysis"])


class TrendReportRequest(BaseModel):
    """趋势报告请求"""
    query: str
    resources: List[Dict[str, Any]]
    timeWindowDays: int = 30


class TechCompareRequest(BaseModel):
    """技术对比请求"""
    techA: str
    techB: str
    resources: List[Dict[str, Any]]


def get_orchestrator() -> AIOrchestrator:
    """获取 AI 编排器实例"""
    from main import orchestrator
    return orchestrator


# OPTIONS for CORS
@router.options("/report")
@router.options("/compare")
@router.options("/extract-techs")
async def options_handler():
    return {}


@router.post("/report")
async def generate_trend_report(
    request: TrendReportRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    生成趋势报告

    Args:
        request: 趋势报告请求，包含查询词和资源列表

    Returns:
        趋势报告 JSON
    """
    logger.info(f"Generating trend report for: {request.query}, resources: {len(request.resources)}")

    if not request.resources:
        raise HTTPException(
            status_code=400,
            detail="No resources provided for trend analysis"
        )

    try:
        service = TrendAnalysisService(ai_client=orch)
        report = await service.generate_trend_report(
            query=request.query,
            resources=request.resources,
            time_window_days=request.timeWindowDays
        )

        return service.format_report_for_api(report)

    except Exception as e:
        logger.error(f"Failed to generate trend report: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate trend report: {str(e)}"
        )


@router.post("/compare")
async def compare_technologies(
    request: TechCompareRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    对比两个技术

    Args:
        request: 技术对比请求

    Returns:
        对比结果 JSON
    """
    logger.info(f"Comparing technologies: {request.techA} vs {request.techB}")

    if not request.techA or not request.techB:
        raise HTTPException(
            status_code=400,
            detail="Both techA and techB are required"
        )

    try:
        service = TechComparisonService(ai_client=orch)
        comparison = await service.compare_technologies(
            tech_a=request.techA,
            tech_b=request.techB,
            resources=request.resources
        )

        return service.format_comparison_for_api(comparison)

    except Exception as e:
        logger.error(f"Failed to compare technologies: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compare technologies: {str(e)}"
        )


class ExtractTechsRequest(BaseModel):
    """提取技术关键词请求"""
    text: str


@router.post("/extract-techs")
async def extract_technologies(request: ExtractTechsRequest):
    """
    从文本中提取技术关键词

    Args:
        request: 包含待分析文本

    Returns:
        技术关键词列表
    """
    if not request.text:
        return {"technologies": []}

    service = TrendAnalysisService()
    techs = service.extract_technologies(request.text)

    return {
        "technologies": techs,
        "count": len(techs)
    }


class HypeCycleRequest(BaseModel):
    """Hype Cycle 数据请求"""
    resources: List[Dict[str, Any]]
    query: Optional[str] = None


@router.post("/hype-cycle")
async def get_hype_cycle_data(
    request: HypeCycleRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    获取 Hype Cycle 图表数据

    Args:
        request: Hype Cycle 请求

    Returns:
        Hype Cycle 数据点列表
    """
    logger.info(f"Generating Hype Cycle data, resources: {len(request.resources)}")

    if not request.resources:
        return {
            "positions": [],
            "dataSourcesCount": 0
        }

    try:
        service = TrendAnalysisService(ai_client=orch)
        report = await service.generate_trend_report(
            query=request.query or "technology trends",
            resources=request.resources,
            time_window_days=90
        )

        # 只返回 Hype Cycle 部分
        return {
            "positions": [
                {
                    "techName": h.tech_name,
                    "xPosition": round(h.x_position, 1),
                    "yPosition": round(h.y_position, 1),
                    "stage": h.stage.value,
                    "yearsToMainstream": h.years_to_mainstream
                }
                for h in report.hype_cycle
            ],
            "dataSourcesCount": report.data_sources_count,
            "confidenceScore": round(report.confidence_score, 2)
        }

    except Exception as e:
        logger.error(f"Failed to generate Hype Cycle data: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate Hype Cycle data: {str(e)}"
        )

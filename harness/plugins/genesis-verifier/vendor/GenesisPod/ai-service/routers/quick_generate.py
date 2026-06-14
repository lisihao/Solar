"""
快速生成路由 - 对标Genspark的自然语言生成
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import logging
import json

router = APIRouter()
logger = logging.getLogger(__name__)

# AI客户端将从main.py导入
grok_client = None
openai_client = None


def init_clients(grok, openai):
    """初始化AI客户端"""
    global grok_client, openai_client
    grok_client = grok
    openai_client = openai
    logger.info("Quick generate router: AI clients initialized")


class QuickGenerateRequest(BaseModel):
    """快速生成请求"""
    prompt: str = Field(..., min_length=10)
    template: str = Field(default="tech-blog")
    autoResearch: bool = Field(default=False)
    autoMedia: bool = Field(default=False)
    model: str = Field(default="grok", pattern="^(grok|gpt-4)$")


class ReportSection(BaseModel):
    """报告章节"""
    title: str
    content: str


class QuickGenerateResponse(BaseModel):
    """快速生成响应"""
    title: str
    summary: str
    sections: List[ReportSection]
    metadata: Optional[Dict[str, Any]] = None


# 简化的模板Prompts
QUICK_PROMPTS = {
    "business-plan": """Generate a professional business plan with these sections:
1. Executive Summary
2. Problem & Solution
3. Market Analysis
4. Business Model
5. Financial Projections

Output ONLY valid JSON:
{{
  "title": "Business Plan: [Name]",
  "summary": "Executive summary...",
  "sections": [
    {{"title": "Problem & Solution", "content": "markdown"}},
    {{"title": "Market Analysis", "content": "markdown"}},
    {{"title": "Business Model", "content": "markdown"}},
    {{"title": "Financial Projections", "content": "markdown"}}
  ]
}}""",

    "academic-presentation": """Generate presentation slides (15-20 slides):
1. Title Slide
2. Introduction (2-3 slides)
3. Main Content (8-12 slides)
4. Conclusion (2-3 slides)

Output ONLY valid JSON:
{{
  "title": "Presentation: [Topic]",
  "summary": "Overview...",
  "sections": [
    {{"title": "Slides 1-3: Introduction", "content": "markdown bullets"}},
    {{"title": "Slides 4-12: Main Content", "content": "markdown"}},
    {{"title": "Slides 13-15: Conclusion", "content": "markdown"}}
  ]
}}""",

    "academic-research-page": """Generate a complete research paper:
1. Abstract
2. Introduction
3. Literature Review
4. Methodology
5. Results
6. Discussion
7. Conclusion

Output ONLY valid JSON:
{{
  "title": "[Research Paper Title]",
  "summary": "Abstract...",
  "sections": [
    {{"title": "Introduction", "content": "markdown"}},
    {{"title": "Literature Review", "content": "markdown"}},
    {{"title": "Methodology", "content": "markdown"}},
    {{"title": "Results", "content": "markdown"}},
    {{"title": "Discussion", "content": "markdown"}},
    {{"title": "Conclusion", "content": "markdown"}}
  ]
}}""",

    "tech-blog": """Generate a technical blog article:
1. Introduction
2. Background/Context
3. Main Content (with code examples)
4. Practical Guide
5. Conclusion

Output ONLY valid JSON:
{{
  "title": "[Catchy Blog Title]",
  "summary": "Introduction...",
  "sections": [
    {{"title": "Background", "content": "markdown"}},
    {{"title": "Main Content", "content": "markdown with code"}},
    {{"title": "Practical Guide", "content": "markdown"}},
    {{"title": "Conclusion", "content": "markdown"}}
  ]
}}""",

    "api-documentation": """Generate API documentation:
1. Overview
2. Authentication
3. API Endpoints
4. Error Handling

Output ONLY valid JSON:
{{
  "title": "API Documentation: [API Name]",
  "summary": "Overview...",
  "sections": [
    {{"title": "Authentication", "content": "markdown"}},
    {{"title": "API Endpoints", "content": "markdown tables"}},
    {{"title": "Error Handling", "content": "markdown"}}
  ]
}}""",
}


def parse_json_response(response_text: str) -> Dict[str, Any]:
    """解析AI响应中的JSON"""
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        response_text = response_text.strip()
        
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()
        
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}')
        
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            json_str = response_text[start_idx:end_idx + 1]
            try:
                return json.loads(json_str)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON: {e}")
                raise
        
        raise ValueError("No valid JSON found in response")


# Endpoint for generating documents using AI
@router.post("/api/v1/ai-office/quick-generate", response_model=QuickGenerateResponse)
async def quick_generate(request: QuickGenerateRequest):
    """
    快速生成文档 - 基于自然语言描述
    对标Genspark的核心功能
    """
    try:
        logger.info(f"Quick generate: {request.prompt[:50]}... using {request.model}")

        # 1. 构建增强的prompt
        enhanced_prompt = f"""Based on the following user request, generate a complete, professional document:

USER REQUEST:
{request.prompt}

DOCUMENT TYPE: {request.template}

"""

        # 2. 如果启用自动研究
        if request.autoResearch:
            enhanced_prompt += """
IMPORTANT - AUTO RESEARCH:
- Include key facts, statistics, and data
- Reference current trends and developments
- Add expert insights and real-world examples
- Cite relevant case studies

"""

        # 3. 如果启用智能配图
        if request.autoMedia:
            enhanced_prompt += """
IMPORTANT - MEDIA SUGGESTIONS:
In your content, suggest where images/diagrams would be helpful.
Use placeholders like: [IMAGE: Description of what image should show]

"""

        # 4. 添加模板指令
        template_prompt = QUICK_PROMPTS.get(request.template, QUICK_PROMPTS['tech-blog'])
        full_prompt = enhanced_prompt + template_prompt

        # 5. 调用AI生成
        ai_client = grok_client if request.model == "grok" else openai_client
        
        if not ai_client:
            raise HTTPException(status_code=500, detail="AI client not initialized")
        
        response = await ai_client.chat(
            messages=[{
                "role": "system",
                "content": "You are a professional document generator. Create comprehensive, well-structured documents. Always output valid JSON."
            }, {
                "role": "user",
                "content": full_prompt
            }],
            temperature=0.7,
            max_tokens=3000
        )

        # 6. 解析响应
        report_data = parse_json_response(response)

        # 7. 验证必需字段
        if "title" not in report_data or "summary" not in report_data or "sections" not in report_data:
            raise ValueError("Response missing required fields")

        # 8. 构建响应
        result = QuickGenerateResponse(
            title=report_data["title"],
            summary=report_data["summary"],
            sections=[
                ReportSection(title=s["title"], content=s["content"])
                for s in report_data["sections"]
            ],
            metadata={
                "model": request.model,
                "template": request.template,
                "autoResearch": request.autoResearch,
                "autoMedia": request.autoMedia,
                "userPrompt": request.prompt[:100]
            }
        )

        logger.info(f"Successfully generated: {result.title}")
        return result

    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse AI response: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Quick generate error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate document: {str(e)}"
        )

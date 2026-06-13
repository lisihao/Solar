"""
报告生成路由 - 多素材AI综合报告
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import json
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

# AI客户端将从main.py导入
grok_client = None
openai_client = None


def init_clients(grok, openai):
    """
    初始化AI客户端（从main.py注入）

    Args:
        grok: GrokClient实例
        openai: OpenAIClient实例
    """
    global grok_client, openai_client
    grok_client = grok
    openai_client = openai
    logger.info("Report router: AI clients initialized")


class Resource(BaseModel):
    """资源模型"""
    id: str
    title: str
    abstract: Optional[str] = None
    authors: Optional[Any] = None
    published_date: Optional[str] = None
    tags: Optional[Any] = None
    type: str


class ReportRequest(BaseModel):
    """报告生成请求"""
    resources: List[Resource] = Field(..., min_items=2, max_items=10)
    template: str = Field(..., pattern="^(comparison|trend|learning-path|literature-review)$")
    model: str = Field(default="grok", pattern="^(grok|gpt-4)$")


class ReportSection(BaseModel):
    """报告章节"""
    title: str
    content: str


class ReportResponse(BaseModel):
    """报告响应"""
    title: str
    summary: str
    sections: List[ReportSection]
    metadata: Optional[Dict[str, Any]] = None


def prepare_resources_info(resources: List[Resource]) -> str:
    """准备资源信息文本"""
    info_parts = []
    for i, resource in enumerate(resources, 1):
        # 处理authors
        authors_str = "N/A"
        if resource.authors:
            if isinstance(resource.authors, list):
                # 处理dict或string列表
                author_names = []
                for author in resource.authors[:3]:
                    if isinstance(author, dict):
                        # 尝试从dict中提取name字段
                        author_names.append(author.get('name', author.get('id', str(author))))
                    elif isinstance(author, str):
                        author_names.append(author)
                authors_str = ", ".join(author_names) if author_names else "N/A"
            elif isinstance(resource.authors, str):
                authors_str = resource.authors

        # 处理tags
        tags_str = "N/A"
        if resource.tags:
            if isinstance(resource.tags, list):
                tags_str = ", ".join(resource.tags[:5])  # 只显示前5个标签
            elif isinstance(resource.tags, str):
                tags_str = resource.tags

        # 处理abstract
        abstract = resource.abstract or "No abstract available"
        if len(abstract) > 500:
            abstract = abstract[:500] + "..."

        info = f"""
Resource {i}:
- ID: {resource.id}
- Title: {resource.title}
- Type: {resource.type}
- Date: {resource.published_date or 'N/A'}
- Authors: {authors_str}
- Tags: {tags_str}
- Abstract: {abstract}
"""
        info_parts.append(info)

    return "\n".join(info_parts)


# 报告模板Prompts
REPORT_PROMPTS = {
    "comparison": """You are a technical analyst. Analyze and compare the following {count} resources.

Resources:
{resources_info}

Generate a comprehensive comparison report with these sections:

1. **Executive Summary** (200-300 words)
   - Overview of all resources
   - Main themes and connections
   - Key takeaways

2. **Detailed Comparison**
   Create a comparison table in markdown format with these aspects:
   - Approach/Method
   - Key Innovation
   - Performance/Results
   - Limitations
   - Use Cases

3. **Key Insights** (5-7 bullet points)
   - Common patterns across resources
   - Key differences and trade-offs
   - Evolution and improvements
   - Complementary aspects

4. **Recommendations**
   - Which to choose for different scenarios
   - Learning order suggestions
   - Further reading

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "Comparison of [Topic]",
  "summary": "Executive summary text...",
  "sections": [
    {{"title": "Detailed Comparison", "content": "markdown table and text"}},
    {{"title": "Key Insights", "content": "markdown list"}},
    {{"title": "Recommendations", "content": "markdown text"}}
  ]
}}

JSON output:
""",

    "trend": """You are a technology trend analyst. Analyze the following {count} resources to identify trends.

Resources:
{resources_info}

Generate a trend analysis report with these sections:

1. **Overview** (150-200 words)
   - Time span covered
   - Main themes
   - Overall direction

2. **Technology Timeline**
   Create a chronological timeline in markdown format showing:
   - Year/Date
   - Key milestone
   - Innovation introduced
   - Impact level (High/Medium/Low)

3. **Key Breakthroughs** (4-6 items)
   For each breakthrough:
   - What changed
   - Why it matters
   - Follow-up work

4. **Trend Predictions**
   - Emerging patterns
   - Likely next developments (3-6 months)
   - Opportunities and challenges

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "Trend Analysis: [Topic]",
  "summary": "Overview text...",
  "sections": [
    {{"title": "Technology Timeline", "content": "markdown timeline"}},
    {{"title": "Key Breakthroughs", "content": "markdown list"}},
    {{"title": "Trend Predictions", "content": "markdown text"}}
  ]
}}

JSON output:
""",

    "learning-path": """You are a learning path designer. Create a structured learning plan from these {count} resources.

Resources:
{resources_info}

Generate a learning path report with these sections:

1. **Learning Objectives** (150 words)
   - What you'll learn
   - Target audience
   - Prerequisites

2. **Recommended Learning Sequence**
   For each resource (in order):
   - Resource title and type
   - Difficulty level (Beginner/Intermediate/Advanced)
   - Estimated time investment
   - Key concepts covered
   - Why this sequence matters

3. **Difficulty Analysis**
   - Concept progression
   - Knowledge dependencies
   - Potential challenges

4. **Practice Recommendations**
   - Hands-on projects
   - Additional resources
   - Learning tips

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "Learning Path: [Topic]",
  "summary": "Learning objectives text...",
  "sections": [
    {{"title": "Recommended Learning Sequence", "content": "markdown ordered list"}},
    {{"title": "Difficulty Analysis", "content": "markdown text"}},
    {{"title": "Practice Recommendations", "content": "markdown list"}}
  ]
}}

JSON output:
""",

    "literature-review": """You are an academic researcher. Write a literature review for these {count} resources.

Resources:
{resources_info}

Generate an academic literature review with these sections:

1. **Introduction and Background** (200-250 words)
   - Research context
   - Motivation and significance
   - Scope of review

2. **Methodology Evolution**
   Discuss how methods have evolved:
   - Early approaches
   - Key innovations
   - Current state-of-the-art

3. **Comparative Analysis**
   Create a detailed comparison of:
   - Research methods
   - Results and findings
   - Strengths and limitations

4. **Future Directions**
   - Open problems
   - Promising research directions
   - Potential applications

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "Literature Review: [Topic]",
  "summary": "Introduction text...",
  "sections": [
    {{"title": "Methodology Evolution", "content": "markdown text"}},
    {{"title": "Comparative Analysis", "content": "markdown text with tables"}},
    {{"title": "Future Directions", "content": "markdown list"}}
  ]
}}

JSON output:
"""

    ,"business-plan": """You are a business consultant. Create a professional business plan from these {count} resources.

Resources:
{resources_info}

Generate a comprehensive business plan with these sections:

1. **Executive Summary** (300-400 words)
2. **Problem & Solution**
3. **Market Analysis**
4. **Business Model**
5. **Financial Projections**

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "Business Plan: [Company Name]",
  "summary": "Executive summary text...",
  "sections": [
    {{"title": "Problem & Solution", "content": "markdown text"}},
    {{"title": "Market Analysis", "content": "markdown with data"}},
    {{"title": "Business Model", "content": "markdown text"}},
    {{"title": "Financial Projections", "content": "markdown table"}}
  ]
}}

JSON output:
"""

    ,"api-documentation": """You are a technical writer. Create clear API documentation from these {count} resources.

Resources:
{resources_info}

Generate API documentation with these sections:

1. **Overview** (200-300 words)
2. **Authentication**
3. **API Endpoints**
4. **Error Handling**

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "API Documentation: [API Name]",
  "summary": "Overview text...",
  "sections": [
    {{"title": "Authentication", "content": "markdown with code"}},
    {{"title": "API Endpoints", "content": "markdown tables"}},
    {{"title": "Error Handling", "content": "markdown list"}}
  ]
}}

JSON output:
"""

    ,"academic-presentation": """You are a presentation designer. Create academic slide content from these {count} resources.

Resources:
{resources_info}

Generate presentation outline (15-20 slides):

1. **Title Slide**
2. **Introduction** (2-3 slides)
3. **Methodology** (2-3 slides)
4. **Results** (4-6 slides)
5. **Conclusion** (1-2 slides)

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "Presentation: [Research Title]",
  "summary": "Research overview...",
  "sections": [
    {{"title": "Slides 1-3: Introduction", "content": "markdown bullets"}},
    {{"title": "Slides 4-8: Methodology", "content": "markdown"}},
    {{"title": "Slides 9-14: Results", "content": "markdown with data"}},
    {{"title": "Slides 15-20: Conclusion", "content": "markdown summary"}}
  ]
}}

JSON output:
"""

    ,"tech-blog": """You are a tech blogger. Write an engaging article from these {count} resources.

Resources:
{resources_info}

Generate a blog article with these sections:

1. **Introduction** (150-200 words)
2. **Background** (200-300 words)
3. **Main Content** (800-1200 words)
4. **Practical Guide** (400-600 words)
5. **Conclusion** (100-150 words)

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "[Catchy Blog Title]",
  "summary": "Introduction text...",
  "sections": [
    {{"title": "Background", "content": "markdown text"}},
    {{"title": "Main Content", "content": "markdown with code"}},
    {{"title": "Practical Guide", "content": "markdown steps"}},
    {{"title": "Conclusion", "content": "summary"}}
  ]
}}

JSON output:
"""

    ,"academic-research-page": """You are an academic researcher. Create a research paper from these {count} resources.

Resources:
{resources_info}

Generate a complete research paper:

1. **Abstract** (150-250 words)
2. **Introduction** (400-600 words)
3. **Literature Review** (600-800 words)
4. **Methodology** (500-700 words)
5. **Results** (600-800 words)
6. **Discussion** (500-700 words)
7. **Conclusion** (250-350 words)
8. **References**

IMPORTANT: Output ONLY valid JSON in this exact format:
{{
  "title": "[Research Paper Title]",
  "summary": "Abstract text...",
  "sections": [
    {{"title": "Introduction", "content": "markdown text"}},
    {{"title": "Literature Review", "content": "markdown with citations"}},
    {{"title": "Methodology", "content": "markdown text"}},
    {{"title": "Results", "content": "markdown with tables"}},
    {{"title": "Discussion", "content": "markdown text"}},
    {{"title": "Conclusion", "content": "markdown summary"}},
    {{"title": "References", "content": "markdown citations"}}
  ]
}}

JSON output:
"""
}


def parse_json_response(response_text: str) -> Dict[str, Any]:
    """解析AI响应中的JSON"""
    try:
        # 尝试直接解析
        return json.loads(response_text)
    except json.JSONDecodeError:
        # 尝试提取JSON部分
        response_text = response_text.strip()

        # 移除markdown代码块
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()

        # 查找JSON对象
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}')

        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            json_str = response_text[start_idx:end_idx + 1]
            try:
                return json.loads(json_str)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON: {e}\nContent: {json_str[:200]}")
                raise

        raise ValueError("No valid JSON found in response")


@router.post("/api/v1/ai/generate-report", response_model=ReportResponse)
async def generate_report(request: ReportRequest):
    """
    生成多素材综合报告

    Args:
        request: 包含资源列表、模板和模型的请求

    Returns:
        ReportResponse: 结构化的报告内容
    """
    try:
        logger.info(f"Generating {request.template} report for {len(request.resources)} resources using {request.model}")

        # 1. 准备资源信息
        resources_info = prepare_resources_info(request.resources)

        # 2. 选择prompt模板
        prompt_template = REPORT_PROMPTS.get(request.template)
        if not prompt_template:
            raise HTTPException(status_code=400, detail=f"Invalid template: {request.template}")

        # 3. 构建完整prompt
        prompt = prompt_template.format(
            count=len(request.resources),
            resources_info=resources_info
        )

        # 4. 调用AI生成
        if request.model == "gpt-4":
            logger.info("Using OpenAI GPT-4")
            response = await openai_client.chat(
                messages=[{
                    "role": "system",
                    "content": "You are a helpful AI assistant that generates structured reports. Always output valid JSON."
                }, {
                    "role": "user",
                    "content": prompt
                }],
                model="gpt-4",
                temperature=0.7,
                max_tokens=3000
            )
        else:
            logger.info("Using Grok")
            response = await grok_client.chat(
                messages=[{
                    "role": "system",
                    "content": "You are a helpful AI assistant that generates structured reports. Always output valid JSON."
                }, {
                    "role": "user",
                    "content": prompt
                }],
                temperature=0.7,
                max_tokens=3000
            )

        # 5. 解析响应
        report_data = parse_json_response(response)

        # 6. 验证必需字段
        if "title" not in report_data or "summary" not in report_data or "sections" not in report_data:
            raise ValueError("Response missing required fields: title, summary, or sections")

        # 7. 构建响应
        result = ReportResponse(
            title=report_data["title"],
            summary=report_data["summary"],
            sections=[
                ReportSection(title=s["title"], content=s["content"])
                for s in report_data["sections"]
            ],
            metadata={
                "model": request.model,
                "template": request.template,
                "resourceCount": len(request.resources),
            }
        )

        logger.info(f"Successfully generated report: {result.title}")
        return result

    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse AI response as JSON: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Report generation error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate report: {str(e)}"
        )


@router.get("/api/v1/ai/report-templates")
async def get_report_templates():
    """获取可用的报告模板列表"""
    return {
        "templates": [
            {
                "id": "comparison",
                "name": "对比分析",
                "description": "多维度对比各素材的特点、优劣势和适用场景",
                "icon": "📊",
                "minItems": 2,
                "maxItems": 5,
                "estimatedTime": "60秒",
                "model": "gpt-4",
            },
            {
                "id": "trend",
                "name": "趋势报告",
                "description": "分析技术演进轨迹和未来发展方向",
                "icon": "📈",
                "minItems": 3,
                "maxItems": 10,
                "estimatedTime": "45秒",
                "model": "grok",
            },
            {
                "id": "learning-path",
                "name": "学习路径",
                "description": "生成由浅入深的学习计划和实践建议",
                "icon": "🗺️",
                "minItems": 3,
                "maxItems": 8,
                "estimatedTime": "50秒",
                "model": "grok",
            },
            {
                "id": "literature-review",
                "name": "文献综述",
                "description": "学术风格的文献综述报告",
                "icon": "📝",
                "minItems": 5,
                "maxItems": 10,
                "estimatedTime": "90秒",
                "model": "gpt-4",
            },
        ]
    }


class ChatRequest(BaseModel):
    """资源对话请求"""
    resources: List[Resource] = Field(..., min_items=1, max_items=10)
    message: str = Field(..., min_length=1)
    history: List[Dict[str, str]] = Field(default_factory=list)
    model: str = Field(default="grok", pattern="^(grok|gpt-4)$")


class ChatResponse(BaseModel):
    """对话响应"""
    message: str


@router.post("/api/v1/ai/chat", response_model=ChatResponse)
async def chat_with_resources(request: ChatRequest):
    """
    与资源进行对话，基于资源内容回答问题

    Args:
        request: 包含资源列表、用户消息和对话历史

    Returns:
        ChatResponse: AI的回答
    """
    try:
        logger.info(f"Chat request for {len(request.resources)} resources using {request.model}")

        # 1. 准备资源信息上下文
        resources_context = prepare_resources_info(request.resources)

        # 2. 构建系统提示
        system_prompt = f"""你是一个专业的研究助手。用户选择了以下资源，你需要基于这些资源的内容回答用户的问题。

资源信息：
{resources_context}

请基于以上资源内容回答用户的问题。如果问题涉及资源中没有的信息，请明确指出。回答要准确、专业、有条理。"""

        # 3. 构建消息列表
        messages = [{"role": "system", "content": system_prompt}]

        # 添加历史对话（最多保留最近5轮）
        for h in request.history[-10:]:  # 最多10条历史消息
            messages.append(h)

        # 添加当前用户消息
        messages.append({"role": "user", "content": request.message})

        # 4. 调用AI生成响应
        if request.model == "gpt-4":
            logger.info("Using OpenAI GPT-4")
            response = await openai_client.chat(
                messages=messages,
                model="gpt-4",
                temperature=0.7,
                max_tokens=1500
            )
        else:
            logger.info("Using Grok")
            response = await grok_client.chat(
                messages=messages,
                temperature=0.7,
                max_tokens=1500
            )

        if response is None:
            raise HTTPException(
                status_code=503,
                detail="AI service unavailable"
            )

        logger.info(f"Chat response generated: {len(response)} characters")
        return ChatResponse(message=response)

    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"对话失败: {str(e)}"
        )


# AI Office Chat 相关模型和端点
class ReportsChatRequest(BaseModel):
    """AI Office 报告对话请求"""
    message: str = Field(..., min_length=1)
    context: Optional[str] = None
    model: Optional[str] = None  # 可选，由调用方从系统配置获取，为空时使用 AI Service 编排器默认
    stream: bool = Field(default=False)
    resources: Optional[List[Dict[str, Any]]] = None
    conversationHistory: Optional[List[Dict[str, str]]] = None  # 对话历史


@router.post("/api/v1/reports/chat")
async def reports_chat(request: ReportsChatRequest):
    """
    AI Office 对话端点 - 支持流式和非流式响应

    这个端点专门为 AI Office 设计，支持基于上下文的对话
    """
    try:
        logger.info(f"Reports chat request using {request.model}, stream={request.stream}, message={request.message[:50]}...")

        # 构建消息列表
        messages = []

        # 如果有上下文，添加为系统消息
        if request.context:
            messages.append({
                "role": "system",
                "content": request.context
            })

        # 添加对话历史（如果有）
        if request.conversationHistory and len(request.conversationHistory) > 0:
            # 只取最近的5轮对话（10条消息），避免上下文过长
            recent_history = request.conversationHistory[-10:]
            logger.info(f"Adding {len(recent_history)} messages from conversation history")
            for hist_msg in recent_history:
                if 'role' in hist_msg and 'content' in hist_msg:
                    messages.append({
                        "role": hist_msg['role'],
                        "content": hist_msg['content']
                    })

        # 添加当前用户消息
        messages.append({
            "role": "user",
            "content": request.message
        })

        logger.info(f"Total messages in context: {len(messages)}")

        # 选择 AI 客户端 - 基于传入的模型名称
        # 支持: gpt-4, openai, grok 等
        model_name = (request.model or "").lower()
        if model_name in ("gpt-4", "openai", "gpt-3.5", "gpt-4o"):
            ai_client = openai_client
            logger.info(f"Using OpenAI client for model: {request.model}")
        else:
            # 默认使用 grok（包括 grok, gemini 等，因为 grok_client 实际是通用客户端）
            ai_client = grok_client
            logger.info(f"Using Grok client for model: {request.model}")

        if not ai_client or not ai_client.available:
            raise HTTPException(
                status_code=503,
                detail="AI service unavailable"
            )

        # 流式响应
        if request.stream:
            from fastapi.responses import StreamingResponse
            import asyncio

            async def generate_stream():
                """生成 SSE 流式响应"""
                try:
                    import json
                    logger.info("Starting SSE stream generation")
                    # 使用 stream_completion 方法
                    # 将 messages 转换为单个 prompt
                    prompt_parts = []
                    for msg in messages:
                        role = msg.get("role", "user")
                        content = msg.get("content", "")
                        if role == "system":
                            prompt_parts.append(f"System: {content}")
                        elif role == "user":
                            prompt_parts.append(f"User: {content}")

                    full_prompt = "\n\n".join(prompt_parts)
                    logger.info(f"Prompt length: {len(full_prompt)} chars")

                    chunk_count = 0
                    async for chunk in ai_client.stream_completion(
                        prompt=full_prompt,
                        max_tokens=2000,
                        temperature=0.7
                    ):
                        if chunk:
                            chunk_count += 1
                            # SSE 格式 - 返回 JSON
                            json_data = json.dumps({'content': chunk})
                            logger.debug(f"Sending chunk {chunk_count}: {len(chunk)} chars")
                            yield f"data: {json_data}\n\n"
                            await asyncio.sleep(0)  # 让出控制权

                    logger.info(f"Stream completed. Total chunks: {chunk_count}")
                    # 发送结束标记
                    yield "data: [DONE]\n\n"

                except Exception as e:
                    logger.error(f"Stream generation error: {e}", exc_info=True)
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"

            return StreamingResponse(
                generate_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                }
            )

        # 非流式响应
        else:
            response = await ai_client.chat(
                messages=messages,
                max_tokens=2000,
                temperature=0.7
            )

            if response is None:
                raise HTTPException(
                    status_code=503,
                    detail="AI service unavailable"
                )

            return {
                "message": response,
                "model": request.model
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reports chat error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"对话失败: {str(e)}"
        )


# YouTube报告相关模型
class YoutubeReportRequest(BaseModel):
    """YouTube报告生成请求"""
    title: str
    transcript: str
    model: str = Field(default="gpt-4", pattern="^(grok|gpt-4)$")


class TranscriptLine(BaseModel):
    """字幕行"""
    english: str
    chinese: str


class YoutubeReportResponse(BaseModel):
    """YouTube报告响应"""
    title: str
    summary: str
    translations: List[TranscriptLine]


@router.post("/youtube-report", response_model=YoutubeReportResponse)
async def generate_youtube_report(request: YoutubeReportRequest):
    """
    生成YouTube视频字幕报告（含逐句中英翻译）
    """
    try:
        logger.info(f"Generating YouTube report for: {request.title}")

        # 选择AI客户端
        ai_client = openai_client if request.model == "gpt-4" else grok_client

        # 第一步：生成概要
        summary_prompt = f"""
请为以下YouTube视频生成一个简洁的概要（200-300字），包括：
1. 视频主要内容
2. 核心观点
3. 关键信息

视频标题：{request.title}
视频字幕：
{request.transcript}

请直接返回概要文本，不需要其他格式。
"""

        logger.info("Step 1: Generating summary...")
        summary_response = await ai_client.chat_completion(
            messages=[
                {"role": "system", "content": "你是一个专业的视频内容分析师。"},
                {"role": "user", "content": summary_prompt}
            ]
        )

        summary = summary_response.get("content", "")
        logger.info(f"Summary generated: {len(summary)} characters")

        # 第二步：将字幕分句并翻译
        # 简化：一次性处理所有文本，但限制最大长度
        transcript_text = request.transcript[:6000]  # 限制最大长度避免token超限

        translation_prompt = f"""
请将以下英文字幕按句翻译成中文。

要求：
1. 按语义完整性分句（每句2-3行左右）
2. 每句英文对应一句中文翻译
3. 翻译要准确、流畅、地道
4. 确保ALL句子都有翻译，不要遗漏
5. 返回JSON格式

格式：
{{
  "translations": [
    {{"english": "First sentence here.", "chinese": "第一句的中文翻译。"}},
    {{"english": "Second sentence here.", "chinese": "第二句的中文翻译。"}}
  ]
}}

英文字幕：
{transcript_text}

请严格按照JSON格式返回，不要添加markdown标记。
"""

        logger.info("Step 2: Generating translations...")
        translation_response = await ai_client.chat_completion(
            messages=[
                {"role": "system", "content": "你是专业的英中翻译专家。请严格按照JSON格式返回完整的翻译结果。"},
                {"role": "user", "content": translation_prompt}
            ]
        )

        # 解析翻译结果
        translation_content = translation_response.get("content", "")
        logger.info(f"Translation response: {len(translation_content)} characters")

        # 清理并解析JSON
        try:
            # 移除可能的markdown代码块标记
            clean_content = translation_content.strip()
            if clean_content.startswith("```"):
                lines = clean_content.split("\n")
                clean_content = "\n".join(lines[1:-1]) if len(lines) > 2 else clean_content
                clean_content = clean_content.replace("```json", "").replace("```", "").strip()

            translation_data = json.loads(clean_content)
            translations = translation_data.get("translations", [])

            if not translations:
                raise ValueError("No translations found in response")

            logger.info(f"Successfully parsed {len(translations)} translation pairs")

        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Failed to parse translations: {e}")
            logger.error(f"Raw content: {translation_content[:1000]}")

            # 降级处理：简单分段
            sentences = [s.strip() + '.' for s in request.transcript.split('.') if s.strip()]
            translations = []

            for i, sentence in enumerate(sentences[:30]):  # 限制最多30句
                if sentence:
                    translations.append({
                        "english": sentence,
                        "chinese": f"[翻译失败] 句子 {i+1}"
                    })

        logger.info(f"Generated {len(translations)} translation pairs")

        return YoutubeReportResponse(
            title=request.title,
            summary=summary,
            translations=[TranscriptLine(**t) for t in translations]
        )

    except Exception as e:
        logger.error(f"Error generating YouTube report: {e}")
        raise HTTPException(status_code=500, detail=str(e))

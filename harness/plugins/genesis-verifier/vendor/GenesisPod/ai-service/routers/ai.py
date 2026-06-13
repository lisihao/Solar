"""
AI API 路由
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from loguru import logger
from models.schemas import (
    SummaryRequest, SummaryResponse,
    InsightRequest, InsightResponse, Insight,
    ClassificationRequest, ClassificationResponse,
    HealthResponse,
    GenerateStructuredSummaryRequest, GenerateStructuredSummaryResponse
)
from services.ai_orchestrator import AIOrchestrator
from pydantic import BaseModel
from typing import Optional, Literal, List, Tuple
import json
import time


router = APIRouter(prefix="/ai", tags=["AI"])


class ChatRequest(BaseModel):
    """聊天请求"""
    message: str
    context: Optional[str] = None
    model: Literal["grok", "openai"] = "grok"
    stream: bool = False


class QuickActionRequest(BaseModel):
    """快捷操作请求"""
    content: str
    action: Literal["methodology", "summary", "insights"]
    model: Literal["grok", "openai"] = "grok"


def get_orchestrator() -> AIOrchestrator:
    """获取 AI 编排器实例（依赖注入）"""
    from main import orchestrator
    return orchestrator


def select_ai_client(
    preferred_model: Literal["grok", "openai", "gpt-4"],
    orch: AIOrchestrator,
    purpose: str,
    error_detail: str = "AI services unavailable"
) -> Tuple[object, str]:
    """
    根据首选模型选择可用的 AI 客户端，如需时自动回退。

    Args:
        preferred_model: 请求指定的模型
        orch: AI 编排器
        purpose: 日志上下文

    Returns:
        (可用客户端, 实际使用的模型名称)
    """
    client = None

    normalized = preferred_model
    if preferred_model not in ("grok", "openai"):
        normalized = "openai"

    active_model = normalized

    if normalized == "grok":
        if orch.grok.available:
            client = orch.grok
        elif orch.openai.available:
            logger.warning("%s: Grok unavailable, falling back to OpenAI", purpose)
            client = orch.openai
            active_model = "openai"
    else:
        if orch.openai.available:
            client = orch.openai
        elif orch.grok.available:
            logger.warning("%s: OpenAI unavailable, falling back to Grok", purpose)
            client = orch.grok
            active_model = "grok"

    if client is None or not getattr(client, "available", False):
        raise HTTPException(status_code=503, detail=error_detail)

    return client, active_model



# OPTIONS endpoints for CORS preflight
@router.options("/summary")
@router.options("/insights")
@router.options("/classify")
@router.options("/simple-chat")
@router.options("/quick-action")
@router.options("/translate")
@router.options("/translate-segments")
@router.options("/youtube-report")
@router.options("/chat")
async def options_handler():
    return {}

@router.post("/summary", response_model=SummaryResponse)
async def generate_summary(
    request: SummaryRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    生成内容摘要

    Args:
        request: 摘要请求

    Returns:
        摘要响应
    """
    logger.info(f"Generating summary for content length: {len(request.content)}")

    prompt = f"""请为以下内容生成一个简洁的摘要（不超过{request.max_length}字）：

{request.content}

要求：
- 使用{request.language}语言
- 抓住核心要点
- 简洁明了
"""

    result, model = await orch.generate_completion(
        prompt,
        max_tokens=request.max_length * 2,  # 中文一个字约2个token
        temperature=0.5
    )

    if result is None:
        raise HTTPException(status_code=503, detail="All AI services unavailable")

    return SummaryResponse(
        summary=result,
        model_used=model
    )


@router.post("/insights", response_model=InsightResponse)
async def extract_insights(
    request: InsightRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    提取关键洞察

    Args:
        request: 洞察请求

    Returns:
        洞察响应
    """
    logger.info(f"Extracting insights for content length: {len(request.content)}")

    prompt = f"""请从以下内容中提取3-5个关键洞察：

{request.content}

要求：
- 使用{request.language}语言
- 每个洞察包含标题和描述
- 标注重要性（high/medium/low）
- 以 JSON 格式返回，格式如下：
[
  {{"title": "洞察标题", "description": "洞察描述", "importance": "high"}},
  ...
]
"""

    result, model = await orch.generate_completion(
        prompt,
        max_tokens=800,
        temperature=0.7
    )

    if result is None:
        raise HTTPException(status_code=503, detail="All AI services unavailable")

    # 解析 JSON 响应
    try:
        import json
        # 提取 JSON 部分（可能被 markdown 代码块包裹）
        if "```json" in result:
            result = result.split("```json")[1].split("```")[0].strip()
        elif "```" in result:
            result = result.split("```")[1].split("```")[0].strip()

        insights_data = json.loads(result)
        insights = [Insight(**item) for item in insights_data]

        return InsightResponse(
            insights=insights,
            model_used=model
        )
    except Exception as e:
        logger.error(f"Failed to parse insights: {str(e)}")
        # 降级处理：返回空列表
        return InsightResponse(
            insights=[],
            model_used=model
        )


@router.post("/classify", response_model=ClassificationResponse)
async def classify_content(
    request: ClassificationRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    分类内容

    Args:
        request: 分类请求

    Returns:
        分类响应
    """
    logger.info(f"Classifying content length: {len(request.content)}")

    prompt = f"""请对以下内容进行分类：

{request.content}

要求：
- 确定主类别（如：AI/机器学习、前端开发、后端开发、数据科学等）
- 提取子类别（2-3个）
- 提取相关标签（3-5个）
- 评估难度等级（beginner/intermediate/advanced/expert）
- 以 JSON 格式返回：
{{
  "category": "主类别",
  "subcategories": ["子类别1", "子类别2"],
  "tags": ["标签1", "标签2", "标签3"],
  "difficulty_level": "intermediate"
}}
"""

    # 使用 "fast" tier (GPT-4o-mini)
    result, model = await orch.generate_completion(
        prompt,
        max_tokens=500,
        temperature=0.3,
        tier="fast"
    )

    if result is None:
        raise HTTPException(status_code=503, detail="All AI services unavailable")

    # 解析 JSON 响应
    try:
        import json
        if "```json" in result:
            result = result.split("```json")[1].split("```")[0].strip()
        elif "```" in result:
            result = result.split("```")[1].split("```")[0].strip()

        classification_data = json.loads(result)

        return ClassificationResponse(
            category=classification_data.get("category", "Unknown"),
            subcategories=classification_data.get("subcategories", []),
            tags=classification_data.get("tags", []),
            difficulty_level=classification_data.get("difficulty_level", "intermediate"),
            model_used=model
        )
    except Exception as e:
        logger.error(f"Failed to parse classification: {str(e)}")
        # 降级处理
        return ClassificationResponse(
            category="Unknown",
            subcategories=[],
            tags=[],
            difficulty_level="intermediate",
            model_used=model
        )


@router.get("/health", response_model=HealthResponse)
async def health_check(orch: AIOrchestrator = Depends(get_orchestrator)):
    """
    健康检查

    Returns:
        健康状态
    """
    health_status = await orch.health_check()

    return HealthResponse(
        status=health_status["status"],
        grok_available=health_status["grok_available"],
        openai_available=health_status["openai_available"],
        active_model=health_status["active_model"]
    )


@router.post("/generate-structured-summary", response_model=GenerateStructuredSummaryResponse)
async def generate_structured_summary(
    request: GenerateStructuredSummaryRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    生成结构化 AI 摘要

    针对不同资源类型（Paper, News, Video等）生成特定的结构化摘要
    """
    start_time = time.time()
    logger.info(f"Generating structured summary for {request.resourceType}, content length: {len(request.content)}")

    # 构建 Prompt
    base_requirements = """
    Requirements:
    1. Analyze the content deeply
    2. Extract key information based on the specific structure below
    3. Output ONLY valid JSON
    4. Use Simplified Chinese (zh-CN) for all content unless specified otherwise
    5. Ensure all fields are filled with meaningful content
    """

    # 根据资源类型定义特定结构
    type_prompts = {
        "PAPER": """
        Output JSON structure for ACADEMIC PAPER:
        {
          "overview": "200-300 words comprehensive summary",
          "category": "Academic",
          "subcategories": ["Specific Field", "Topic"],
          "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
          "keywords": ["keyword1", "keyword2"],
          "difficulty": "beginner/intermediate/advanced/expert",
          "readingTime": 5,
          "confidence": 0.9,
          "contributions": ["Contribution 1", "Contribution 2"],
          "methodology": "Detailed description of methods used",
          "results": "Summary of experimental results",
          "limitations": ["Limitation 1", "Limitation 2"],
          "futureWork": ["Future direction 1"],
          "field": "Main Field",
          "subfield": "Sub Field"
        }
        """,
        "NEWS": """
        Output JSON structure for NEWS:
        {
          "overview": "Summary of the news event",
          "category": "News",
          "subcategories": ["Topic"],
          "keyPoints": ["Key fact 1", "Key fact 2"],
          "keywords": ["keyword1", "keyword2"],
          "difficulty": "beginner/intermediate/advanced",
          "readingTime": 3,
          "confidence": 0.9,
          "headline": "Catchy headline",
          "coreNews": "The core news event",
          "background": "Context and background info",
          "impact": "Implications and impact",
          "newsFactor": "breaking/developing/analysis/feature",
          "sentiment": "positive/neutral/negative",
          "urgency": "high/medium/low",
          "relatedEntities": [{"name": "Entity Name", "type": "person/org/location", "relevance": 0.9}]
        }
        """,
        "YOUTUBE_VIDEO": """
        Output JSON structure for VIDEO:
        {
          "overview": "Video summary",
          "category": "Video",
          "subcategories": ["Topic"],
          "keyPoints": ["Takeaway 1", "Takeaway 2"],
          "keywords": ["keyword1"],
          "difficulty": "beginner/intermediate/advanced",
          "readingTime": 5,
          "confidence": 0.9,
          "mainTopic": "Main topic",
          "subtopics": ["Subtopic 1", "Subtopic 2"],
          "videoType": "lecture/tutorial/interview/demo/discussion",
          "pace": "slow/normal/fast",
          "audience": "target audience",
          "speakers": [{"name": "Speaker Name", "role": "Host/Guest"}],
          "chapters": [{"timestamp": 0, "title": "Intro", "summary": "Introduction"}],
          "estimatedWatchTime": 10,
          "keyTimestamps": [{"time": 60, "label": "Key moment"}]
        }
        """,
        "PROJECT": """
        Output JSON structure for PROJECT/CODE:
        {
          "overview": "Project overview",
          "category": "Technology",
          "subcategories": ["Language", "Framework"],
          "keyPoints": ["Feature 1", "Feature 2"],
          "keywords": ["keyword1"],
          "difficulty": "beginner/intermediate/advanced",
          "readingTime": 3,
          "confidence": 0.9,
          "projectName": "Project Name",
          "purpose": "Main purpose/problem solved",
          "mainFeatures": ["Feature 1", "Feature 2"],
          "techStack": ["Tech 1", "Tech 2"],
          "maturity": "alpha/beta/stable/mature",
          "license": "MIT/Apache/etc",
          "ecosystem": "Related ecosystem",
          "gettingStarted": "Brief how-to start",
          "useCases": ["Use case 1"],
          "learningCurve": "easy/moderate/steep",
          "activity": {
             "stars": 0, "forks": 0, "openIssues": 0, "activeContributors": 0,
             "lastUpdate": "2023-01-01", "isActive": true
          }
        }
        """
    }

    # 默认使用 PAPER 结构如果类型未匹配
    specific_prompt = type_prompts.get(request.resourceType, type_prompts["PAPER"])

    full_prompt = f"""
    Content to Analyze:
    Title: {request.title or 'Unknown'}
    Abstract: {request.abstract or 'None'}
    Body: {request.content[:5000]}  # Limit content length

    {base_requirements}

    {specific_prompt}

    JSON Output:
    """

    # 调用 AI
    # 对于结构化数据生成，GPT-4 通常表现更好，但 Grok 也可以
    # 使用 orchestrator 自动选择
    client, active_model = select_ai_client("gpt-4", orch, "Structured Summary")

    result = await client.generate_completion(
        full_prompt,
        max_tokens=2000,
        temperature=0.2  # 低温度以保证格式正确
    )

    if result is None:
        raise HTTPException(status_code=503, detail="Failed to generate structured summary")

    # 解析 JSON
    try:
        # 清理可能的 Markdown 标记
        cleaned = result.strip()
        if "```json" in cleaned:
            cleaned = cleaned.split("```json")[1].split("```")[0].strip()
        elif "```" in cleaned:
            cleaned = cleaned.split("```")[1].split("```")[0].strip()

        summary_data = json.loads(cleaned)

        # 添加元数据
        summary_data["generatedAt"] = datetime.now().isoformat()
        summary_data["model"] = active_model

        execution_time = (time.time() - start_time) * 1000

        return GenerateStructuredSummaryResponse(
            summary=summary_data,
            model=active_model,
            generationTime=execution_time
        )

    except Exception as e:
        logger.error(f"Failed to parse structured summary JSON: {e}")
        logger.debug(f"Raw output: {result}")
        # 如果解析失败，尝试返回一个基本的结构
        # 这里可以选择抛出错误或者返回降级结果
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")


@router.post("/simple-chat")
async def simple_chat(
    request: ChatRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    简单聊天接口（支持流式响应）
    注意：这是一个简单的聊天接口，不支持资源对话。
    如果需要与资源对话，请使用 /api/v1/ai/chat 端点。

    Args:
        request: 聊天请求

    Returns:
        聊天响应（流式或常规）
    """
    logger.info(f"Chat request: model={request.model}, stream={request.stream}, message_len={len(request.message)}")

    # 构建完整的提示
    prompt = request.message
    if request.context:
        prompt = f"Context:\n{request.context}\n\nUser Question:\n{request.message}"

    # Select AI client, fallback when preferred provider is unavailable
    client, active_model = select_ai_client(request.model, orch, "Chat")

    if request.stream:
        # 流式响应
        async def generate():
            try:
                async for chunk in client.stream_completion(prompt, max_tokens=2000, temperature=0.7):
                    yield f"data: {json.dumps({'content': chunk, 'model': active_model})}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                logger.error(f"Streaming error: {str(e)}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )
    else:
        # 常规响应
        result = await client.generate_completion(prompt, max_tokens=2000, temperature=0.7)

        if result is None:
            raise HTTPException(status_code=503, detail="Failed to generate response")

        return {
            "content": result,
            "model": active_model
        }


@router.post("/quick-action")
async def quick_action(
    request: QuickActionRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    快捷操作（摘要、洞察、方法论）

    Args:
        request: 快捷操作请求

    Returns:
        操作结果
    """
    logger.info(f"Quick action: {request.action}, model={request.model}")

    # 根据不同的 action 构建不同的 prompt
    if request.action == "methodology":
        prompt = f"""You are a JSON-only API. Analyze the research methodology or technical methods in the following content.

Content:
{request.content}

Requirements:
1. Extract 3-5 main methods or techniques
2. Each method must have exactly these fields: title, description, importance
3. importance must be one of: high, medium, low
4. All titles and descriptions must be written in Simplified Chinese
5. Output ONLY a valid JSON array, nothing else
6. No explanations, no markdown, no code blocks, just the JSON array

Output format (follow exactly):
[{{"title":"方法名称","description":"方法的关键步骤与核心要点","importance":"high"}},{{"title":"方法名称2","description":"方法的应用场景与优势","importance":"medium"}}]

JSON output:
["""
    elif request.action == "summary":
        prompt = f"""请为以下内容生成一个结构化的摘要：

{request.content}

要求：
- 核心观点（2-3个要点）
- 主要发现或结论
- 实际应用价值
- 使用清晰的标题和列表格式
"""
    else:  # insights
        prompt = f"""You are a JSON-only API. Extract key insights from the following content.

Content:
{request.content}

Requirements:
1. Extract 3-5 key insights
2. Each insight must have exactly these fields: title, description, importance
3. importance must be one of: high, medium, low
4. Output ONLY a valid JSON array, nothing else
5. No explanations, no markdown, no code blocks, just the JSON array

Output format (follow exactly):
[{{"title":"Core Finding","description":"Research reveals significant breakthrough","importance":"high"}},{{"title":"Application Value","description":"Can be applied to production","importance":"medium"}}]

JSON output:
["""

    # Select AI client for quick actions with automatic fallback
    client, active_model = select_ai_client(request.model, orch, "Quick action")

    result = await client.generate_completion(prompt, max_tokens=1500, temperature=0.7)

    if result is None:
        raise HTTPException(status_code=503, detail="Failed to generate response")

    # 对于需要JSON格式的action，尝试提取JSON
    if request.action in ["methodology", "insights"]:
        try:
            # 提取JSON部分（可能被markdown代码块包裹）
            json_content = result.strip()

            # 如果prompt以"["结尾，响应可能不包含开头的"["，需要补上
            # 检查响应是否以某个对象开始
            if json_content.startswith('{"') or json_content.startswith('{'):
                # 可能缺少开头的"["，补上
                if not json_content.startswith('['):
                    json_content = '[' + json_content
                    # 检查结尾是否缺少"]"
                    if not json_content.endswith(']'):
                        # 尝试找到最后一个完整的}
                        last_brace = json_content.rfind('}')
                        if last_brace != -1:
                            json_content = json_content[:last_brace + 1] + ']'

            # 移除markdown代码块标记
            if "```json" in json_content:
                json_content = json_content.split("```json")[1].split("```")[0].strip()
            elif "```" in json_content:
                json_content = json_content.split("```")[1].split("```")[0].strip()

            # 移除可能的前后文本，只保留JSON数组部分
            # 尝试找到第一个 [ 和最后一个 ]
            start_idx = json_content.find('[')
            end_idx = json_content.rfind(']')

            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                json_content = json_content[start_idx:end_idx + 1]

            # 尝试解析JSON
            import json as json_lib
            parsed_json = json_lib.loads(json_content)

            # 验证是否为数组
            if isinstance(parsed_json, list):
                # 如果解析成功，返回JSON字符串
                result = json_lib.dumps(parsed_json, ensure_ascii=False)
                logger.info(f"Successfully parsed JSON for {request.action}: {len(parsed_json)} items")
            else:
                logger.warning(f"Parsed JSON is not an array for {request.action}, returning original content")

        except Exception as e:
            logger.error(f"Failed to parse JSON for {request.action}: {str(e)}")
            logger.debug(f"Original content: {result[:500]}...")
            # 如果解析失败，返回原始内容，前端会尝试使用markdown解析

    return {
        "content": result,
        "action": request.action,
        "model": active_model
    }


class TranslateRequest(BaseModel):
    """翻译请求"""
    text: str
    targetLanguage: str = "zh-CN"
    model: Literal["grok", "openai", "gpt-4"] = "gpt-4"


@router.post("/translate")
async def translate_text(
    request: TranslateRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    翻译文本

    Args:
        request: 翻译请求

    Returns:
        翻译结果
    """
    logger.info(f"Translating text to {request.targetLanguage}, length: {len(request.text)}")

    prompt = f"""Translate the following text to {request.targetLanguage}.
Preserve the line breaks and structure. Only output the translation, no explanations.

Text to translate:
{request.text}

Translation:"""

    client, active_model = select_ai_client(
        request.model,
        orch,
        "Translate text",
        "AI translation services unavailable"
    )

    result = await client.generate_completion(prompt, max_tokens=4000, temperature=0.3)

    if result is None:
        raise HTTPException(status_code=503, detail="Failed to generate translation")

    return {
        "translatedText": result.strip(),
        "targetLanguage": request.targetLanguage,
        "model": active_model
    }


class TranslateSegmentsRequest(BaseModel):
    """逐句翻译请求"""
    segments: List[str]
    targetLanguage: str = "zh-CN"
    model: Literal["grok", "openai", "gpt-4"] = "gpt-4"
    batchSize: int = 40


@router.post("/translate-segments")
async def translate_segments(
    request: TranslateSegmentsRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    逐句翻译字幕段落，确保与原始顺序对应

    Args:
        request: 翻译请求

    Returns:
        翻译结果数组
    """
    if not request.segments:
        raise HTTPException(status_code=400, detail="segments cannot be empty")

    logger.info(
        "Translating %d caption segments to %s",
        len(request.segments),
        request.targetLanguage,
    )

    client, active_model = select_ai_client(
        request.model,
        orch,
        "Translate segments",
        "AI translation services unavailable"
    )

    translations: List[str] = [""] * len(request.segments)
    batch_size = max(1, min(request.batchSize, 80))

    for start in range(0, len(request.segments), batch_size):
        end = min(start + batch_size, len(request.segments))
        chunk = request.segments[start:end]

        numbered_lines = "\n".join(
            f"{index}: {segment}"
            for index, segment in enumerate(chunk, start=start)
        )

        prompt = f"""You are a professional translator. Translate each caption line into {request.targetLanguage}.
Return a JSON array where each element has the form {{"index": number, "translation": "..."}}.
- The index must match the zero-based index shown before each caption.
- Keep the same number of items as the input.
- Do not merge or split lines.
- Preserve punctuation and speaker labels.
- Use double quotes for strings and output valid JSON only.

Captions:
{numbered_lines}

JSON:"""

        result = await client.generate_completion(
            prompt,
            max_tokens=min(4096, 200 + len(chunk) * 40),
            temperature=0.2,
        )

        if result is None:
            raise HTTPException(status_code=503, detail="Failed to generate translation")

        cleaned = result.strip()
        if "```" in cleaned:
            cleaned = cleaned.split("```", 2)
            if len(cleaned) >= 2:
                cleaned = cleaned[1]
            else:
                cleaned = result.strip()

        cleaned = cleaned.strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip(": \n\r\t")

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            # 尝试从文本中提取 JSON 数组
            start_idx = cleaned.find("[")
            end_idx = cleaned.rfind("]")
            if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
                logger.error("Failed to parse translation JSON: %s", cleaned[:200])
                raise HTTPException(status_code=500, detail="Invalid translation response format")
            try:
                parsed = json.loads(cleaned[start_idx:end_idx + 1])
            except json.JSONDecodeError as json_error:
                logger.error("JSON parsing failed: %s", str(json_error))
                logger.debug("Translation response: %s", cleaned)
                raise HTTPException(status_code=500, detail="Invalid translation response format")

        if not isinstance(parsed, list):
            raise HTTPException(status_code=500, detail="Unexpected translation response structure")

        for item in parsed:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            translation = item.get("translation")
            if isinstance(idx, int) and isinstance(translation, str):
                if 0 <= idx < len(translations):
                    translations[idx] = translation.strip()

    # 回填未翻译的段落为原文
    for idx, text in enumerate(translations):
        if not text:
            translations[idx] = request.segments[idx]

    return {
        "translations": translations,
        "targetLanguage": request.targetLanguage,
        "model": active_model,
    }


class TranslateSingleRequest(BaseModel):
    """单句翻译请求"""
    text: str
    targetLanguage: str = "zh-CN"
    model: Literal["grok", "openai"] = "grok"  # 默认使用 grok (OpenAI在Railway上不可用)


@router.post("/translate-single")
async def translate_single(
    request: TranslateSingleRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    翻译单个句子（使用最便宜的模型）

    Args:
        request: 翻译请求

    Returns:
        翻译结果
    """
    if not request.text or not request.text.strip():
        return {
            "translation": "",
            "targetLanguage": request.targetLanguage,
            "model": "none"
        }

    logger.info("Translating: '%s' -> %s", request.text[:50], request.targetLanguage)

    # 智能多语言翻译prompt
    target_lang_name = {
        "zh-CN": "Simplified Chinese (简体中文)",
        "zh-TW": "Traditional Chinese (繁體中文)",
        "en": "English",
        "ja": "Japanese (日本語)",
        "ko": "Korean (한국어)",
        "fr": "French (Français)",
        "de": "German (Deutsch)",
        "es": "Spanish (Español)",
    }.get(request.targetLanguage, request.targetLanguage)

    prompt = f"""You are a professional translator. Translate the following text to {target_lang_name}.

IMPORTANT RULES:
1. Detect the source language automatically
2. Translate to {target_lang_name} regardless of source language
3. If the text is already in {target_lang_name}, keep it as is
4. Only return the translation, no explanations or notes
5. Preserve the original meaning and tone

Text to translate:
{request.text}

Translation:"""

    # Use fast tier for single sentence translation
    result, active_model = await orch.generate_completion(
        prompt,
        max_tokens=200,
        temperature=0.2,
        tier="fast"
    )

    if result is None:
        # Fallback to original text
        logger.warning("Translation failed, using original text")
        return {
            "translation": request.text,
            "targetLanguage": request.targetLanguage,
            "model": active_model
        }

    translation = result.strip()
    logger.info("Translation result: '%s'", translation[:50])

    return {
        "translation": translation,
        "targetLanguage": request.targetLanguage,
        "model": active_model
    }


class YouTubeReportRequest(BaseModel):
    """YouTube报告生成请求"""
    title: str
    transcript: str
    model: Literal["grok", "openai", "gpt-4"] = "gpt-4"


@router.post("/youtube-report")
async def generate_youtube_report(
    request: YouTubeReportRequest,
    orch: AIOrchestrator = Depends(get_orchestrator)
):
    """
    根据YouTube字幕生成报告

    Args:
        request: YouTube报告请求

    Returns:
        报告内容
    """
    logger.info(f"Generating YouTube report for: {request.title}")

    prompt = f"""Please analyze the following YouTube video transcript and generate a comprehensive report.

Video Title: {request.title}

Transcript:
{request.transcript}

Generate a structured report with the following sections:
1. **Summary** (概要): 2-3 sentences summarizing the main content
2. **Key Points** (要点): 3-5 bullet points of the most important takeaways
3. **Detailed Analysis** (详细分析): Deeper analysis of the content, themes, and implications
4. **Conclusions** (结论): Final thoughts and recommendations

Format the output in clear sections with markdown headings."""

    # Select AI client for YouTube reports with fallback
    client, active_model = select_ai_client(request.model, orch, "YouTube report")

    result = await client.generate_completion(prompt, max_tokens=2000, temperature=0.7)

    if result is None:
        raise HTTPException(status_code=503, detail="Failed to generate report")

    return {
        "title": f"Analysis Report: {request.title}",
        "summary": "AI-generated analysis of the video content",
        "sections": [
            {
                "title": "Full Report",
                "content": result
            }
        ],
        "model": active_model
    }

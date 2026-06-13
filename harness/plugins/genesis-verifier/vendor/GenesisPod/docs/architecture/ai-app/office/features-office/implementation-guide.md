# AI-Office 优化实施指南 (快速版)

## 🎯 目标

完成Phase 2和Phase 3,实现前后端完整对接

---

## ⚡ 快速实施步骤

### Step 1: 更新ReportRequest模型 (2分钟)

**文件**: `ai-service/routers/report.py`

**位置**: 第43-47行

**原代码**:

```python
class ReportRequest(BaseModel):
    \"\"\"报告生成请求\"\"\"
    resources: List[Resource] = Field(..., min_items=2, max_items=10)
    template: str = Field(..., pattern=\"^(comparison|trend|learning-path|literature-review)$\")
    model: str = Field(default=\"grok\", pattern=\"^(grok|gpt-4)$\")
```

**新代码**:

```python
class ReportRequest(BaseModel):
    \"\"\"报告生成请求\"\"\"
    resources: List[Resource] = Field(..., min_items=2, max_items=10)
    template: str = Field(..., pattern=\"^(comparison|trend|learning-path|literature-review|business-plan|api-documentation|academic-presentation|tech-blog|academic-research-page)$\")
    model: str = Field(default=\"grok\", pattern=\"^(grok|gpt-4)$\")
    config: Optional[Dict[str, Any]] = None  # 生成配置
```

---

### Step 2: 增强generate_report函数 (5分钟)

**文件**: `ai-service/routers/report.py`

**位置**: 第272行 `async def generate_report(request: ReportRequest):` 函数内

**在第283行后添加**:

```python
        logger.info(f\"Generating {request.template} report for {len(request.resources)} resources using {request.model}\")

        # 1. 准备资源信息
        resources_info = prepare_resources_info(request.resources)

        # === 新增: 处理配置参数 ===
        tone = 'academic'
        detail_level = 2
        if request.config:
            tone = request.config.get('tone', 'academic')
            detail_level = request.config.get('detailLevel', 2)

        # 构建增强的system prompt
        tone_mapping = {
            'academic': 'formal, rigorous, and scholarly',
            'business': 'professional, persuasive, and action-oriented',
            'casual': 'friendly, accessible, and conversational',
            'technical': 'precise, detailed, and technical'
        }

        detail_mapping = {
            1: 'brief and concise (focus on key points only)',
            2: 'standard and balanced (comprehensive coverage)',
            3: 'comprehensive and detailed (in-depth analysis)'
        }

        enhanced_system_prompt = f\"\"\"You are a helpful AI assistant that generates structured reports.

Writing Style: {tone_mapping.get(tone, 'professional')}
Detail Level: {detail_mapping.get(detail_level, 'standard')}

Always output valid JSON in the specified format.\"\"\"
        # === 新增结束 ===

        # 2. 选择prompt模板
        prompt_template = REPORT_PROMPTS.get(request.template)
```

**在第300-313行修改**:

```python
        # 4. 调用AI生成
        if request.model == \"gpt-4\":
            logger.info(\"Using OpenAI GPT-4\")
            response = await openai_client.chat(
                messages=[{
                    \"role\": \"system\",
                    \"content\": enhanced_system_prompt  # 使用增强的prompt
                }, {
                    \"role\": \"user\",
                    \"content\": prompt
                }],
                model=\"gpt-4\",
                temperature=0.7,
                max_tokens=3000
            )
        else:
            logger.info(\"Using Grok\")
            response = await grok_client.chat(
                messages=[{
                    \"role\": \"system\",
                    \"content\": enhanced_system_prompt  # 使用增强的prompt
                }, {
                    \"role\": \"user\",
                    \"content\": prompt
                }],
                temperature=0.7,
                max_tokens=3000
            )
```

---

### Step 3: 创建资源扩展服务 (可选,10分钟)

**新建文件**: `ai-service/services/resource_extension.py`

```python
\"\"\"
智能资源扩展服务 - MVP版本
\"\"\"
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)

class ResourceExtensionService:
    \"\"\"资源扩展服务 - 基于AI生成建议\"\"\"

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def extend_resources(
        self,
        base_resources: List[Dict],
        options: Dict[str, bool]
    ) -> Dict[str, Any]:
        \"\"\"扩展资源\"\"\"
        topic = ' | '.join([r.get('title', '')[:50] for r in base_resources[:3]])
        extensions = {}

        if options.get('searchImages'):
            extensions['images_note'] = f\"Suggested: Add diagrams/charts for {topic}\"

        if options.get('fetchData'):
            extensions['data_note'] = f\"Suggested: Include statistics/metrics for {topic}\"

        if options.get('citePapers'):
            papers = [r for r in base_resources if r.get('type') == 'PAPER']
            extensions['papers'] = papers[:5]

        if options.get('findReports'):
            extensions['reports_note'] = f\"Suggested: Reference industry reports on {topic}\"

        return extensions
```

**在 `generate_report` 中集成** (第285行后):

```python
        resources_info = prepare_resources_info(request.resources)

        # === 新增: 智能扩展 ===
        extended_note = \"\"
        if request.config and request.config.get('extensions'):
            try:
                from services.resource_extension import ResourceExtensionService
                extension_service = ResourceExtensionService(
                    grok_client if request.model == \"grok\" else openai_client
                )
                extended = await extension_service.extend_resources(
                    [r.dict() for r in request.resources],
                    request.config['extensions']
                )

                notes = []
                if 'images_note' in extended:
                    notes.append(extended['images_note'])
                if 'data_note' in extended:
                    notes.append(extended['data_note'])
                if 'reports_note' in extended:
                    notes.append(extended['reports_note'])

                if notes:
                    extended_note = \"\\n\\nAI Suggestions:\\n\" + \"\\n\".join(f\"- {n}\" for n in notes)
            except Exception as e:
                logger.warning(f\"Resource extension failed: {e}\")
        # === 新增结束 ===

        # 2. 选择prompt模板
        prompt_template = REPORT_PROMPTS.get(request.template)
        if not prompt_template:
            raise HTTPException(status_code=400, detail=f\"Invalid template: {request.template}\")

        # 3. 构建完整prompt
        prompt = prompt_template.format(
            count=len(request.resources),
            resources_info=resources_info + extended_note  # 添加扩展建议
        )
```

---

### Step 4: 前端对接 (可选,5分钟)

**文件**: `frontend/components/ai-office/chat/ChatPanel.tsx`

**查找**: `DocumentGenerationWizard` 的 `onGenerate` 回调

**更新API调用**:

```typescript
const handleDocumentGeneration = async (config: GenerationConfig) => {
  try {
    const response = await fetch("/api/v1/ai/generate-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resources: selectedResources.map((r) => ({
          id: r._id,
          title: r.metadata?.title || "",
          abstract: r.metadata?.abstract || "",
          authors: r.metadata?.authors || [],
          published_date: r.metadata?.published_date || "",
          tags: r.metadata?.tags || [],
          type: r.type,
        })),
        template: config.template.id,
        model: "grok",
        config: {
          detailLevel: config.options.detailLevel,
          tone: config.options.tone,
          extensions: config.options.extensions.reduce((acc, ext) => {
            acc[ext] = true;
            return acc;
          }, {}),
        },
      }),
    });

    if (!response.ok) throw new Error("Generation failed");

    const result = await response.json();
    // 处理返回的报告...
  } catch (error) {
    console.error("Document generation error:", error);
  }
};
```

---

## ✅ 验证测试

### 测试1: 模板支持

```bash
# 测试新模板是否可用
curl -X POST http://localhost:8000/api/v1/ai/generate-report \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"resources\": [{\"id\":\"1\",\"title\":\"Test\",\"type\":\"PAPER\"}],
    \"template\": \"business-plan\",
    \"model\": \"grok\"
  }'
```

### 测试2: 配置参数

```bash
# 测试config参数
curl -X POST http://localhost:8000/api/v1/ai/generate-report \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"resources\": [{\"id\":\"1\",\"title\":\"Test\",\"type\":\"PAPER\"}],
    \"template\": \"tech-blog\",
    \"model\": \"grok\",
    \"config\": {
      \"detailLevel\": 3,
      \"tone\": \"casual\",
      \"extensions\": {\"searchImages\": true}
    }
  }'
```

---

## 📊 完成度追踪

- [x] Phase 1: 后端模板补全 (100%)
- [ ] Phase 2: API接口增强
  - [ ] Step 1: 更新ReportRequest (0%)
  - [ ] Step 2: 增强generate_report (0%)
- [ ] Phase 3: 智能扩展服务
  - [ ] Step 3: 创建ResourceExtensionService (0%)
  - [ ] Step 4: 前端对接 (0%)

---

## 🎯 最小可行方案 (MVP)

**只需完成 Step 1 + Step 2 即可实现核心功能!**

Step 3 和 Step 4 是增强功能,可以后续迭代。

---

**预计总耗时**: 7-15分钟 (MVP) 或 20-30分钟 (完整版)
**难度**: ⭐⭐ (中等)
**优先级**: 🔥🔥🔥 (高)

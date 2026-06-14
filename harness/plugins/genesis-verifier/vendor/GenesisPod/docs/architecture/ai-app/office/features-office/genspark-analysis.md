# Genspark AI文档/PPT功能深度分析与实现方案

## 📊 Genspark产品分析

### 一、核心功能观察

#### 1. **AI Docs (AI文档生成)**

**输入方式**:

- 主输入框: "Describe the document you want to create..."
- 格式选择: Rich Text / Markdown
- 模板分类:
  - Business (商业文档)
  - Academic (学术文档)
  - Creative (创意文档)
  - Technical (技术文档)

**关键特性**:

- ✨ 自然语言描述即可生成
- 📋 提供预设模板快速开始
- 🎨 支持多种输出格式
- 🔄 可从模板或空白开始

**用户流程**:

```
描述需求 → 选择格式 → (可选)选择模板 → AI生成 → 编辑/导出
```

---

#### 2. **AI Slides (AI PPT生成)**

**输入方式**:

- 主输入框: "Enter your presentation topic and requirements..."
- 两个Tab:
  - **Explore**: 浏览预设模板
  - **My Templates**: 我的模板
- 筛选器:
  - All Styles (所有风格)
  - All Themes (所有主题)
  - Sort by: Popularity (按热度排序)

**核心能力** (从页面提取):

1. **Say a topic, get complete professional slides**
   - 输入主题,自动生成完整专业幻灯片
2. **Auto research and compile findings into slides**
   - 自动研究并将发现整理成幻灯片
3. **Add images, videos, sounds using AI or from web**
   - 使用AI或从网络添加图片、视频、音频
4. **Import any document and convert to AI slides**
   - 导入任何文档并转换为AI幻灯片

**用户流程**:

```
输入主题 → (可选)选择模板/风格 → AI生成 → 自动添加媒体 → 编辑/导出
```

---

### 二、Genspark的设计亮点

#### 1. **极简输入,强大输出**

- 用户只需用自然语言描述需求
- 无需复杂配置,AI自动理解意图
- 降低使用门槛,提升转化率

#### 2. **模板驱动 + AI生成**

- 提供丰富的预设模板作为灵感
- 用户可以从模板开始,也可以从空白开始
- 模板分类清晰 (Business/Academic/Creative/Technical)

#### 3. **智能资源扩展**

- **自动研究**: AI主动搜索相关信息
- **智能配图**: 自动添加图片、视频、音频
- **文档转换**: 支持导入现有文档转为PPT

#### 4. **清晰的视觉层次**

- 大输入框占据中心位置
- 模板以卡片形式展示,易于浏览
- 筛选器和排序功能方便查找

---

### 三、与GenesisPod的对比

| 功能         | Genspark               | GenesisPod (当前) | 差距      |
| ------------ | ---------------------- | ----------------- | --------- |
| **输入方式** | 自然语言描述           | 选择资源 + 对话   | ⚠️ 需优化 |
| **模板系统** | 丰富的预设模板         | 9种文档类型       | ✅ 已补全 |
| **自动研究** | ✅ 支持                | ❌ 未实现         | ⚠️ 缺失   |
| **智能配图** | ✅ 支持                | ❌ 未实现         | ⚠️ 缺失   |
| **文档导入** | ✅ 支持                | ❌ 未实现         | ⚠️ 缺失   |
| **格式选择** | Rich Text/Markdown     | Markdown          | ⚠️ 可扩展 |
| **模板浏览** | Explore + My Templates | 向导式选择        | ✅ 已有   |

---

## 🎯 实现方案:对标Genspark

### Phase 1: 优化输入体验 (高优先级)

#### 1.1 简化输入流程

**当前**: 用户需要先选择资源,再通过向导选择模板

**优化为**:

```
单一输入框 → AI理解需求 → 自动选择模板 → 生成文档
```

**实现**:

```typescript
// frontend/components/ai-office/QuickGenerateInput.tsx
export default function QuickGenerateInput() {
  const [input, setInput] = useState('');

  const handleQuickGenerate = async () => {
    // 1. AI分析用户输入,识别文档类型
    const analysis = await analyzeUserIntent(input);

    // 2. 自动选择最合适的模板
    const template = selectBestTemplate(analysis);

    // 3. 调用生成API
    const result = await generateDocument({
      prompt: input,
      template: template.id,
      autoResearch: true,  // 启用自动研究
      autoMedia: true      // 启用智能配图
    });
  };

  return (
    <div className="quick-generate">
      <textarea
        placeholder="Describe the document you want to create...

Examples:
- Create a business plan for a SaaS startup
- Generate a research paper on AI safety
- Make a presentation about climate change"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button onClick={handleQuickGenerate}>
        ✨ Generate with AI
      </button>
    </div>
  );
}
```

---

#### 1.2 智能意图识别

**新建服务**: `ai-service/services/intent_analyzer.py`

```python
"""
用户意图分析服务
基于用户输入的自然语言,识别文档类型和需求
"""
from typing import Dict, Any
import re

class IntentAnalyzer:
    """分析用户意图,推荐最佳模板"""

    # 关键词映射
    TEMPLATE_KEYWORDS = {
        'business-plan': ['business plan', 'startup', 'pitch', 'funding', 'investor'],
        'api-documentation': ['api', 'endpoint', 'documentation', 'rest', 'graphql'],
        'academic-presentation': ['presentation', 'slides', 'ppt', 'conference', 'talk'],
        'tech-blog': ['blog', 'tutorial', 'guide', 'how to', 'article'],
        'academic-research-page': ['research', 'paper', 'study', 'thesis', 'academic'],
        'comparison': ['compare', 'vs', 'versus', 'difference', 'comparison'],
        'trend': ['trend', 'analysis', 'forecast', 'prediction', 'evolution'],
    }

    def analyze(self, user_input: str) -> Dict[str, Any]:
        """
        分析用户输入

        Returns:
            {
                'template': 'business-plan',
                'confidence': 0.85,
                'extracted_topic': 'SaaS startup',
                'suggested_sections': ['Executive Summary', 'Market Analysis'],
                'auto_research': True
            }
        """
        input_lower = user_input.lower()

        # 1. 识别文档类型
        template_scores = {}
        for template, keywords in self.TEMPLATE_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in input_lower)
            if score > 0:
                template_scores[template] = score

        # 选择得分最高的模板
        best_template = max(template_scores, key=template_scores.get) if template_scores else 'tech-blog'
        confidence = template_scores.get(best_template, 0) / 5  # 归一化

        # 2. 提取主题
        topic = self._extract_topic(user_input)

        # 3. 判断是否需要自动研究
        auto_research = any(kw in input_lower for kw in ['research', 'analyze', 'comprehensive', 'detailed'])

        return {
            'template': best_template,
            'confidence': min(confidence, 1.0),
            'extracted_topic': topic,
            'auto_research': auto_research,
            'auto_media': 'presentation' in input_lower or 'slides' in input_lower
        }

    def _extract_topic(self, user_input: str) -> str:
        """提取核心主题"""
        # 简化版:提取名词短语
        # 实际可以使用NLP库如spaCy
        words = user_input.split()
        return ' '.join(words[:10])  # 取前10个词作为主题
```

---

### Phase 2: 自动研究功能 (中优先级)

#### 2.1 自动研究服务

**新建服务**: `ai-service/services/auto_research.py`

```python
"""
自动研究服务 - 对标Genspark的Auto Research功能
"""
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)

class AutoResearchService:
    """自动研究服务"""

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def research_topic(self, topic: str, template: str) -> Dict[str, Any]:
        """
        自动研究主题

        Args:
            topic: 研究主题
            template: 文档模板类型

        Returns:
            {
                'key_points': [...],
                'statistics': [...],
                'references': [...],
                'suggested_structure': [...]
            }
        """
        # 1. 生成研究提示词
        research_prompt = self._build_research_prompt(topic, template)

        # 2. 调用AI进行研究
        research_result = await self.ai_client.chat(
            messages=[{
                "role": "user",
                "content": research_prompt
            }],
            max_tokens=2000
        )

        # 3. 解析研究结果
        parsed = self._parse_research_result(research_result)

        return parsed

    def _build_research_prompt(self, topic: str, template: str) -> str:
        """构建研究提示词"""
        prompts = {
            'business-plan': f"""Research the following business topic: {topic}

Provide:
1. Market size and growth trends
2. Key competitors and their strategies
3. Target customer segments
4. Potential challenges and opportunities
5. Industry best practices

Format as JSON with keys: market_data, competitors, customers, challenges, best_practices""",

            'academic-research-page': f"""Research the academic topic: {topic}

Provide:
1. Key research papers and findings
2. Current state of the field
3. Main researchers and institutions
4. Open problems and debates
5. Potential research directions

Format as JSON with keys: papers, state_of_art, researchers, open_problems, future_directions""",

            'tech-blog': f"""Research the technical topic: {topic}

Provide:
1. Core concepts and definitions
2. Common use cases and examples
3. Best practices and tips
4. Common pitfalls to avoid
5. Related technologies

Format as JSON with keys: concepts, use_cases, best_practices, pitfalls, related_tech"""
        }

        return prompts.get(template, f"Research the topic: {topic} and provide key insights.")

    def _parse_research_result(self, result: str) -> Dict[str, Any]:
        """解析研究结果"""
        try:
            import json
            # 尝试解析JSON
            return json.loads(result)
        except:
            # 如果不是JSON,返回原始文本
            return {'raw_research': result}
```

---

#### 2.2 集成到文档生成流程

**修改**: `ai-service/routers/report.py` 的 `generate_report` 函数

```python
async def generate_report(request: ReportRequest):
    # ... 现有代码 ...

    # === 新增: 自动研究 ===
    research_data = None
    if request.config and request.config.get('autoResearch'):
        try:
            from services.auto_research import AutoResearchService
            research_service = AutoResearchService(
                grok_client if request.model == "grok" else openai_client
            )

            # 提取主题
            topic = ' | '.join([r.title for r in request.resources[:3]])

            # 执行自动研究
            research_data = await research_service.research_topic(
                topic=topic,
                template=request.template
            )

            logger.info(f"Auto research completed for: {topic}")
        except Exception as e:
            logger.warning(f"Auto research failed: {e}")

    # 将研究数据添加到prompt
    research_context = ""
    if research_data:
        research_context = f"""

=== AUTO RESEARCH FINDINGS ===
{json.dumps(research_data, indent=2)}

Please incorporate these research findings into your report.
"""

    # 3. 构建完整prompt
    prompt = prompt_template.format(
        count=len(request.resources),
        resources_info=resources_info + research_context
    )
    # ... 继续生成 ...
```

---

### Phase 3: 智能配图功能 (中优先级)

#### 3.1 智能媒体服务

**新建服务**: `ai-service/services/media_suggester.py`

```python
"""
智能媒体建议服务 - 对标Genspark的智能配图功能
"""
from typing import List, Dict, Any

class MediaSuggester:
    """智能媒体建议服务"""

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def suggest_media(
        self,
        content: str,
        media_type: str = 'image'
    ) -> List[Dict[str, Any]]:
        """
        为内容建议媒体

        Args:
            content: 文档内容
            media_type: 'image' | 'video' | 'audio'

        Returns:
            [
                {
                    'type': 'image',
                    'description': 'Diagram showing AI architecture',
                    'suggested_position': 'after_section_2',
                    'search_query': 'AI neural network architecture diagram',
                    'style': 'technical_diagram'
                }
            ]
        """
        prompt = f"""Analyze the following content and suggest {media_type}s that would enhance it:

Content:
{content[:1000]}

For each suggestion, provide:
1. Description of the {media_type}
2. Where to place it (section number or position)
3. Search query to find it
4. Style/type (e.g., diagram, photo, chart)

Output as JSON array.
"""

        response = await self.ai_client.chat(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000
        )

        try:
            import json
            suggestions = json.loads(response)
            return suggestions if isinstance(suggestions, list) else []
        except:
            return []
```

---

#### 3.2 图片搜索集成 (MVP)

**新建服务**: `ai-service/services/image_search.py`

```python
"""
图片搜索服务 - MVP版本使用Unsplash API
"""
import os
import httpx
from typing import List, Dict, Any

class ImageSearchService:
    """图片搜索服务"""

    def __init__(self):
        self.unsplash_key = os.getenv('UNSPLASH_ACCESS_KEY')
        self.base_url = "https://api.unsplash.com"

    async def search_images(
        self,
        query: str,
        count: int = 3
    ) -> List[Dict[str, Any]]:
        """
        搜索图片

        Returns:
            [
                {
                    'url': 'https://images.unsplash.com/...',
                    'thumbnail': 'https://images.unsplash.com/.../thumb',
                    'description': 'AI neural network visualization',
                    'author': 'John Doe',
                    'source': 'Unsplash'
                }
            ]
        """
        if not self.unsplash_key:
            return self._mock_images(query, count)

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/search/photos",
                    params={
                        'query': query,
                        'per_page': count,
                        'client_id': self.unsplash_key
                    }
                )

                if response.status_code == 200:
                    data = response.json()
                    return [
                        {
                            'url': img['urls']['regular'],
                            'thumbnail': img['urls']['thumb'],
                            'description': img.get('description', query),
                            'author': img['user']['name'],
                            'source': 'Unsplash'
                        }
                        for img in data.get('results', [])
                    ]
        except Exception as e:
            logger.warning(f"Image search failed: {e}")

        return self._mock_images(query, count)

    def _mock_images(self, query: str, count: int) -> List[Dict[str, Any]]:
        """Mock图片数据 (当API不可用时)"""
        return [
            {
                'url': f'https://via.placeholder.com/800x600?text={query.replace(" ", "+")}+{i+1}',
                'thumbnail': f'https://via.placeholder.com/200x150?text={query.replace(" ", "+")}+{i+1}',
                'description': f'{query} - Image {i+1}',
                'author': 'AI Generated',
                'source': 'Placeholder'
            }
            for i in range(count)
        ]
```

---

### Phase 4: 文档导入转换 (低优先级)

#### 4.1 文档导入服务

```python
"""
文档导入服务 - 支持导入Word/PDF并转换为PPT
"""
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

class DocumentImportService:
    """文档导入服务"""

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def convert_to_slides(
        self,
        document_content: str,
        document_type: str = 'text'
    ) -> Dict[str, Any]:
        """
        将文档转换为幻灯片

        Args:
            document_content: 文档内容
            document_type: 'text' | 'pdf' | 'docx'

        Returns:
            {
                'slides': [
                    {'title': 'Slide 1', 'content': '...'},
                    ...
                ],
                'metadata': {...}
            }
        """
        prompt = f"""Convert the following document into presentation slides:

Document:
{document_content[:3000]}

Create 10-15 slides with:
1. Title slide
2. Agenda
3. Main content slides (one key point per slide)
4. Conclusion

Output as JSON with format:
{{
  "slides": [
    {{"title": "Slide Title", "content": "Bullet points..."}},
    ...
  ]
}}
"""

        response = await self.ai_client.chat(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2500
        )

        try:
            import json
            return json.loads(response)
        except:
            return {'slides': [], 'error': 'Failed to parse response'}
```

---

## 🎨 UI/UX优化方案

### 1. 新增"快速生成"入口

**位置**: `frontend/app/ai-office/page.tsx`

```typescript
<div className="ai-office-layout">
  {/* 新增: 快速生成区域 */}
  <div className="quick-generate-section">
    <h2>✨ Quick Generate</h2>
    <QuickGenerateInput />

    <div className="or-divider">
      <span>OR</span>
    </div>

    <button onClick={() => setShowAdvanced(true)}>
      🔧 Advanced Mode (Select Resources)
    </button>
  </div>

  {/* 原有: 资源选择 + 向导模式 */}
  {showAdvanced && (
    <div className="advanced-mode">
      <ResourcePanel />
      <ChatPanel />
    </div>
  )}
</div>
```

---

### 2. 模板浏览优化

**新增**: `frontend/components/ai-office/TemplateGallery.tsx`

```typescript
export default function TemplateGallery() {
  const [activeTab, setActiveTab] = useState<'explore' | 'my-templates'>('explore');
  const [styleFilter, setStyleFilter] = useState('all');
  const [themeFilter, setThemeFilter] = useState('all');

  return (
    <div className="template-gallery">
      {/* Tabs */}
      <div className="tabs">
        <button
          className={activeTab === 'explore' ? 'active' : ''}
          onClick={() => setActiveTab('explore')}
        >
          Explore
        </button>
        <button
          className={activeTab === 'my-templates' ? 'active' : ''}
          onClick={() => setActiveTab('my-templates')}
        >
          My Templates
        </button>
      </div>

      {/* Filters */}
      <div className="filters">
        <select value={styleFilter} onChange={(e) => setStyleFilter(e.target.value)}>
          <option value="all">All Styles</option>
          <option value="minimal">Minimal</option>
          <option value="corporate">Corporate</option>
          <option value="creative">Creative</option>
        </select>

        <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)}>
          <option value="all">All Themes</option>
          <option value="business">Business</option>
          <option value="academic">Academic</option>
          <option value="technical">Technical</option>
        </select>

        <select>
          <option>Sort by: Popularity</option>
          <option>Sort by: Recent</option>
          <option>Sort by: Name</option>
        </select>
      </div>

      {/* Template Cards */}
      <div className="template-grid">
        {DOCUMENT_TEMPLATES[themeFilter]?.map(template => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>
    </div>
  );
}
```

---

## 📊 实施优先级

### 🔥 Phase 1: 核心体验优化 (本周)

- [ ] 创建QuickGenerateInput组件
- [ ] 实现IntentAnalyzer服务
- [ ] 简化用户输入流程
- [ ] 测试自然语言输入 → 文档生成

### 🔥 Phase 2: 自动研究 (下周)

- [ ] 实现AutoResearchService
- [ ] 集成到文档生成流程
- [ ] 测试自动研究功能
- [ ] 优化研究结果呈现

### ⚡ Phase 3: 智能配图 (2周内)

- [ ] 实现MediaSuggester
- [ ] 集成Unsplash API
- [ ] 实现图片搜索和插入
- [ ] 测试智能配图效果

### 💡 Phase 4: 高级功能 (未来)

- [ ] 文档导入转换
- [ ] 视频/音频支持
- [ ] 模板市场
- [ ] 协作编辑

---

## 🎯 预期效果

### 用户体验提升:

- **输入简化**: 从"选资源→选模板→配置"简化为"描述需求→生成"
- **智能程度**: AI自动研究、配图、优化结构
- **生成质量**: 内容更丰富、更专业、更完整

### 与Genspark对标:

| 功能         | Genspark | GenesisPod (优化后) |
| ------------ | -------- | ------------------- |
| 自然语言输入 | ✅       | ✅                  |
| 自动研究     | ✅       | ✅                  |
| 智能配图     | ✅       | ✅                  |
| 文档导入     | ✅       | ⏳ (Phase 4)        |
| 模板系统     | ✅       | ✅ (已有9种)        |
| 资源整合     | ❌       | ✅ (独特优势)       |

**差异化优势**: Genesis保留了"基于已选资源生成"的能力,这是Genspark没有的!

---

## 📝 总结

通过对标Genspark,我们需要:

1. **简化输入** - 支持自然语言描述,降低使用门槛
2. **自动研究** - AI主动搜集信息,丰富内容
3. **智能配图** - 自动建议和插入媒体
4. **保持优势** - 继续发挥资源整合的独特能力

**实施策略**: 渐进式增强,先实现Phase 1-2,快速验证效果,再迭代Phase 3-4。

---

**文档创建**: 2025-11-19  
**分析对象**: Genspark AI Docs + AI Slides  
**目标**: 实现一致的产品体验

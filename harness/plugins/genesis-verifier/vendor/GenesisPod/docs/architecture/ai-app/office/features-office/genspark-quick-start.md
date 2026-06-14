# 对标Genspark - 快速实施指南

## 🎯 核心目标

实现与Genspark一致的用户体验:

- ✨ 自然语言输入即可生成
- 🔍 AI自动研究补充内容
- 🖼️ 智能配图和媒体建议
- 📋 丰富的模板系统

---

## 🚀 最小可行方案 (MVP)

### Step 1: 创建快速生成入口 (15分钟)

**新建文件**: `frontend/components/ai-office/QuickGenerateInput.tsx`

```typescript
'use client';

import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

export default function QuickGenerateInput() {
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!input.trim() || isGenerating) return;

    setIsGenerating(true);

    try {
      // 调用快速生成API
      const response = await fetch('/api/ai-office/quick-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: input,
          autoResearch: true,
          autoMedia: true
        })
      });

      const result = await response.json();

      // 处理生成结果
      console.log('Generated:', result);

    } catch (error) {
      console.error('Generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="quick-generate-container max-w-4xl mx-auto p-6">
      <div className="mb-4">
        <h2 className="text-2xl font-bold mb-2">
          ✨ Quick Generate
        </h2>
        <p className="text-gray-600">
          Describe what you want to create, and AI will do the rest
        </p>
      </div>

      <div className="relative">
        <textarea
          className="w-full h-40 p-4 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none resize-none"
          placeholder="Describe the document you want to create...

Examples:
• Create a business plan for a SaaS startup focused on AI tools
• Generate a research paper on climate change impacts
• Make a presentation about the future of renewable energy
• Write a technical blog about React Server Components"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isGenerating}
        />

        <button
          onClick={handleGenerate}
          disabled={!input.trim() || isGenerating}
          className="mt-4 w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-6 rounded-lg font-medium flex items-center justify-center space-x-2 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed transition-all"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" />
              <span>Generate with AI</span>
            </>
          )}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm text-gray-600">
        <div className="flex items-start space-x-2">
          <span className="text-green-500">✓</span>
          <span>Auto research and compile findings</span>
        </div>
        <div className="flex items-start space-x-2">
          <span className="text-green-500">✓</span>
          <span>Add images and media suggestions</span>
        </div>
        <div className="flex items-start space-x-2">
          <span className="text-green-500">✓</span>
          <span>Professional formatting</span>
        </div>
        <div className="flex items-start space-x-2">
          <span className="text-green-500">✓</span>
          <span>Export to multiple formats</span>
        </div>
      </div>
    </div>
  );
}
```

---

### Step 2: 创建快速生成API (20分钟)

**新建文件**: `backend/src/modules/ai-office/quick-generate.controller.ts`

```typescript
import { Controller, Post, Body } from "@nestjs/common";
import { QuickGenerateService } from "./quick-generate.service";

@Controller("ai-office")
export class QuickGenerateController {
  constructor(private readonly quickGenerateService: QuickGenerateService) {}

  @Post("quick-generate")
  async quickGenerate(
    @Body()
    body: {
      prompt: string;
      autoResearch?: boolean;
      autoMedia?: boolean;
    },
  ) {
    return this.quickGenerateService.generate(body);
  }
}
```

**新建文件**: `backend/src/modules/ai-office/quick-generate.service.ts`

```typescript
import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

@Injectable()
export class QuickGenerateService {
  constructor(private readonly httpService: HttpService) {}

  async generate(params: {
    prompt: string;
    autoResearch?: boolean;
    autoMedia?: boolean;
  }) {
    try {
      // 1. 分析用户意图
      const intent = await this.analyzeIntent(params.prompt);

      // 2. 调用AI服务生成文档
      const response = await firstValueFrom(
        this.httpService.post(
          "http://localhost:8000/api/v1/ai/quick-generate",
          {
            prompt: params.prompt,
            template: intent.template,
            autoResearch: params.autoResearch,
            autoMedia: params.autoMedia,
            model: "grok",
          },
        ),
      );

      return response.data;
    } catch (error) {
      throw new HttpException(
        "Document generation failed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async analyzeIntent(prompt: string): Promise<{
    template: string;
    confidence: number;
  }> {
    // 简单的关键词匹配
    const promptLower = prompt.toLowerCase();

    if (
      promptLower.includes("business plan") ||
      promptLower.includes("startup")
    ) {
      return { template: "business-plan", confidence: 0.9 };
    }
    if (
      promptLower.includes("presentation") ||
      promptLower.includes("slides")
    ) {
      return { template: "academic-presentation", confidence: 0.9 };
    }
    if (promptLower.includes("research") || promptLower.includes("paper")) {
      return { template: "academic-research-page", confidence: 0.85 };
    }
    if (promptLower.includes("blog") || promptLower.includes("article")) {
      return { template: "tech-blog", confidence: 0.85 };
    }

    // 默认使用技术博客模板
    return { template: "tech-blog", confidence: 0.5 };
  }
}
```

---

### Step 3: AI服务端点 (15分钟)

**新建文件**: `ai-service/routers/quick_generate.py`

```python
"""
快速生成路由 - 对标Genspark的自然语言生成
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import logging

from .report import (
    grok_client,
    openai_client,
    REPORT_PROMPTS,
    ReportResponse,
    parse_json_response
)

router = APIRouter()
logger = logging.getLogger(__name__)


class QuickGenerateRequest(BaseModel):
    """快速生成请求"""
    prompt: str = Field(..., min_length=10)
    template: str = Field(default="tech-blog")
    autoResearch: bool = Field(default=False)
    autoMedia: bool = Field(default=False)
    model: str = Field(default="grok", pattern="^(grok|gpt-4)$")


@router.post("/api/v1/ai/quick-generate", response_model=ReportResponse)
async def quick_generate(request: QuickGenerateRequest):
    """
    快速生成文档 - 基于自然语言描述

    这是对标Genspark的核心功能
    """
    try:
        logger.info(f"Quick generate: {request.prompt[:50]}... using {request.model}")

        # 1. 构建增强的prompt
        enhanced_prompt = f"""Based on the following user request, generate a complete document:

User Request:
{request.prompt}

Document Type: {request.template}

"""

        # 2. 如果启用自动研究
        if request.autoResearch:
            enhanced_prompt += """
IMPORTANT: Please conduct research on this topic and include:
- Key facts and statistics
- Current trends and developments
- Expert opinions and insights
- Relevant examples and case studies

"""

        # 3. 如果启用智能配图
        if request.autoMedia:
            enhanced_prompt += """
IMPORTANT: Suggest images, diagrams, or media that would enhance this document.
For each suggestion, describe:
- What the image/media should show
- Where it should be placed
- Why it's relevant

"""

        # 4. 添加模板指令
        template_prompt = REPORT_PROMPTS.get(request.template, REPORT_PROMPTS['tech-blog'])

        # 简化模板prompt,只保留结构要求
        simplified_template = template_prompt.split("IMPORTANT:")[1] if "IMPORTANT:" in template_prompt else template_prompt

        full_prompt = enhanced_prompt + simplified_template

        # 5. 调用AI生成
        ai_client = grok_client if request.model == "grok" else openai_client

        response = await ai_client.chat(
            messages=[{
                "role": "system",
                "content": "You are a professional document generator. Create comprehensive, well-structured documents based on user requests."
            }, {
                "role": "user",
                "content": full_prompt
            }],
            temperature=0.7,
            max_tokens=3000
        )

        # 6. 解析响应
        report_data = parse_json_response(response)

        # 7. 构建响应
        result = ReportResponse(
            title=report_data["title"],
            summary=report_data["summary"],
            sections=[
                {"title": s["title"], "content": s["content"]}
                for s in report_data["sections"]
            ],
            metadata={
                "model": request.model,
                "template": request.template,
                "autoResearch": request.autoResearch,
                "autoMedia": request.autoMedia,
                "userPrompt": request.prompt
            }
        )

        logger.info(f"Successfully generated: {result.title}")
        return result

    except Exception as e:
        logger.error(f"Quick generate error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate document: {str(e)}"
        )
```

**在 `ai-service/main.py` 中注册路由**:

```python
from routers import quick_generate

# 注册路由
app.include_router(quick_generate.router)
```

---

### Step 4: 集成到前端 (10分钟)

**修改**: `frontend/app/ai-office/page.tsx`

```typescript
import QuickGenerateInput from '@/components/ai-office/QuickGenerateInput';

export default function AIOfficePage() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="h-full flex-1 overflow-hidden">
        {!showAdvanced ? (
          // 新增: 快速生成模式
          <div className="h-full flex flex-col">
            <QuickGenerateInput />

            <div className="text-center py-4">
              <button
                onClick={() => setShowAdvanced(true)}
                className="text-blue-600 hover:text-blue-700 underline"
              >
                Switch to Advanced Mode (Select Resources)
              </button>
            </div>
          </div>
        ) : (
          // 原有: 高级模式
          <div className="h-full">
            <WorkspaceLayout />
            <button
              onClick={() => setShowAdvanced(false)}
              className="absolute top-4 right-4 text-blue-600 hover:text-blue-700"
            >
              ← Back to Quick Generate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## ✅ 测试验证

### 测试1: 快速生成商业计划

```bash
curl -X POST http://localhost:8000/api/v1/ai/quick-generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a business plan for a SaaS startup that helps developers generate documentation automatically",
    "autoResearch": true,
    "autoMedia": true,
    "model": "grok"
  }'
```

### 测试2: 生成技术博客

```bash
curl -X POST http://localhost:8000/api/v1/ai/quick-generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a technical blog about React Server Components and how they improve performance",
    "autoResearch": true,
    "model": "grok"
  }'
```

---

## 📊 实施进度

- [ ] Step 1: 创建QuickGenerateInput组件
- [ ] Step 2: 创建后端API
- [ ] Step 3: 创建AI服务端点
- [ ] Step 4: 集成到前端
- [ ] 测试验证

**预计总耗时**: 60分钟

---

## 🎯 预期效果

### 用户体验:

```
优化前: 选择资源 → 打开向导 → 选择类型 → 选择模板 → 配置选项 → 生成
优化后: 描述需求 → 生成 ✨
```

### 生成质量:

- ✅ 自动研究补充内容
- ✅ 智能建议配图位置
- ✅ 专业格式和结构
- ✅ 完整的JSON输出

---

## 🚀 下一步增强

完成MVP后,可以继续实现:

1. **Phase 2**: 真实的自动研究服务
2. **Phase 3**: Unsplash图片搜索集成
3. **Phase 4**: 模板市场和自定义模板

---

**创建时间**: 2025-11-19  
**目标**: 对标Genspark的快速生成体验  
**状态**: 待实施

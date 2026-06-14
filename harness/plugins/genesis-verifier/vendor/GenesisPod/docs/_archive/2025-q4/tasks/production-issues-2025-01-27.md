# 生产环境问题清单 (2025-01-27)

> 来源: Railway 后台日志监控
> 时间: 2025-01-27 19:16 - 19:26 UTC

---

## 🔴 ERROR 级别 (需立即修复)

### E1. PromptTemplateService 数据库表不存在

```
[PromptTemplateService] [refreshActiveTemplateCache] Failed: PrismaClientKnownRequestError:
The table `public.prompt_templates` does not exist in the current database.
```

**影响**: 服务启动时缓存刷新失败
**定位**: `backend/src/modules/ai-engine/services/prompt-template.service.ts`
**修复方案**: 检查数据库迁移是否完整执行

---

### E2. DataSourceRouterService searchAcademic 空指针

```
[DataSourceRouterService] [searchAcademic] Failed: Cannot read properties of undefined (reading 'slice')
```

**影响**: 学术搜索功能异常
**定位**: `backend/src/modules/ai-app/research/topic-research/services/data-source-router.service.ts`
**修复方案**: 添加空值检查

---

### E3. OpenAI API 连接重置

```
[AiChatService] [callAPIWithConfig] OpenAI API error for gpt-5.1: read ECONNRESET
```

**影响**: AI 调用偶发失败
**定位**: `backend/src/modules/ai-engine/services/ai-chat.service.ts`
**修复方案**: 增加重试机制或检查网络配置

---

### E4. ResearchLeaderService JSON 解析失败

```
[ResearchLeaderService] [extractJsonFromResponse] Could not extract JSON from response
```

**影响**: 维度规划解析失败
**定位**: `backend/src/modules/ai-app/research/topic-research/services/research-leader.service.ts`
**修复方案**: 增强 JSON 提取逻辑的容错性

---

## 🟡 WARN 级别 (应优化)

### W1. 401 未授权请求频繁

```
[AllExceptionsFilter] Client Error: {"statusCode":401,"code":"Unauthorized"...}
```

**出现次数**: 10+ 次/分钟
**影响**: 客户端可能存在 token 过期未刷新问题
**定位**: 前端 token 刷新逻辑
**修复方案**: 检查前端 401 响应处理逻辑

---

### W2. SearchService URL 抓取失败 (403 Forbidden)

```
[SearchService] Failed to fetch URL https://investor.cisco.com/...: HTTP 403: Forbidden
[SearchService] Failed to fetch URL https://www.gartner.com/...: HTTP 403: Forbidden
[SearchService] Failed to fetch URL https://convergedigest.com/...: HTTP 403: Forbidden
```

**影响**: 部分网站无法抓取内容
**定位**: `backend/src/modules/ai-engine/tools/implementations/search.service.ts`
**修复方案**: 添加 User-Agent 伪装或使用代理

---

### W3. SearchService Header Overflow

```
[SearchService] Failed to fetch URL https://finance.yahoo.com/...: Parse Error: Header overflow
```

**影响**: Yahoo Finance 页面无法抓取
**定位**: HTTP 客户端配置
**修复方案**: 增加 maxHeaderSize 配置

---

### W4. OpenAI API Key 缺少权限

```
[OpenAIQuotaProvider] [fetchQuota] OpenAI API Key 缺少 api.usage.read 权限，配额查询已禁用
```

**影响**: 无法查询 API 使用配额
**定位**: OpenAI 控制台 API Key 权限配置
**修复方案**: 在 OpenAI 控制台添加 `api.usage.read` 权限

---

### W5. AiEngineModule 孤立工具配置

```
[AiEngineModule] Found 15 orphaned ToolConfig entries (in DB but not in registry):
  - youtube-transcript, tavilyExtract, tavily, supadata, skillsmp
  - shell-executor, serper, regulationData, python-executor, perplexity
  - jina, javascript-executor, googleTts, firecrawl, elevenlabs
```

**影响**: 数据库中存在无用配置
**定位**: `tool_configs` 表
**修复方案**: 清理数据库中的孤立记录

---

### W6. DataSourceSeederService RSS 源无效

```
[DataSourceSeederService] Invalid RSS sources skipped:
  Anthropic News, a]16z Blog, The Batch (DeepLearning.AI), Reuters Technology, Center for AI Safety (CAIS)
```

**影响**: 部分 RSS 源无法使用
**定位**: `backend/src/modules/ai-engine/seeds/data-source.seeder.ts`
**修复方案**: 更新 RSS 源 URL 或移除无效源

---

### W7. RAGSearchTool OPENAI_API_KEY 未配置

```
[RAGSearchTool] OPENAI_API_KEY not configured
```

**影响**: RAG 搜索功能不可用
**定位**: 环境变量配置
**修复方案**: 确认 OPENAI_API_KEY 已配置

---

### W8. ResearchLeaderService 修订次数耗尽

```
[ResearchLeaderService] [reviewSectionOutput] Max revisions reached, forcing approval for XXX
```

**影响**: 部分章节质量可能不达标但被强制通过
**定位**: `backend/src/modules/ai-app/research/topic-research/services/research-leader.service.ts`
**修复方案**: 评估是否需要增加最大修订次数

---

### W9. DimensionMissionService 无效 URL 检测

```
[DimensionMissionService] Found X invalid URLs (404/error pages)
```

**影响**: 研究过程中发现无效链接
**状态**: ✅ 这是正常的警告信息，系统已自动过滤
**建议**: 可降低日志级别或统计汇总

---

## 📊 问题统计

| 级别  | 数量 | 状态      |
| ----- | ---- | --------- |
| ERROR | 4    | 🔴 待修复 |
| WARN  | 9    | 🟡 待优化 |

## 优先级建议

1. **P0 (立即)**: E1, E2, E4
2. **P1 (本周)**: W1, W2, W4
3. **P2 (下周)**: W3, W5, W6, W7, W8

---

**更新时间**: 2025-01-27
**监控来源**: `railway logs --lines 3000`

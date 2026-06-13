# AI Group 交互规范 v2.0

## 产品需求规格书 - AI 交互核心功能

**版本**: v2.0
**创建日期**: 2025-01-28
**状态**: 待审核

---

## 一、问题背景

当前 AI Group 功能存在以下严重问题：

1. **基础功能不稳定**：单个 AI @后无法正常完成要求内容
2. **Mock 响应混乱**：API Key 缺失时返回错误的 AI 身份
3. **辩论模式角色分配错误**：红蓝方分配与用户预期不符
4. **AI-AI 协作不可靠**：AI @另一个 AI 时触发机制不稳定
5. **@Everyone 处理有缺陷**：多 AI 同时触发时行为混乱

---

## 二、核心功能规格

### 2.1 场景一：单个 AI 交互（人 → AI）

**用户场景**：

```
用户: @AI-Grok 请帮我分析这段代码的性能问题
```

**预期行为**：

| 步骤 | 系统行为                               | 用户可见结果                                                   |
| ---- | -------------------------------------- | -------------------------------------------------------------- |
| 1    | 检测到 @AI-Grok                        | 显示 "AI-Grok 正在输入..."                                     |
| 2    | 构建上下文（最近 N 条消息 + 共享资源） | -                                                              |
| 3    | 查找 AI-Grok 对应的模型配置            | -                                                              |
| 4    | 检查 API Key 是否存在                  | -                                                              |
| 5a   | **有 API Key**：调用 AI API            | AI 生成真实回复                                                |
| 5b   | **无 API Key**：返回明确错误           | 显示："API Key 未配置，请在管理后台配置 [模型名称] 的 API Key" |
| 6    | 保存 AI 消息到数据库                   | 消息出现在聊天流中                                             |

**关键规则**：

- **绝不伪装身份**：无论何种情况，AI 必须显示真实身份
- **明确错误提示**：API Key 缺失时，必须明确告知，而非返回模糊的 mock 响应
- **上下文透明**：AI 收到的 Prompt 应可展开查看

**技术要求**：

```typescript
// 伪代码：单 AI 响应流程
async function handleSingleAIMention(
  topicId: string,
  aiMemberId: string,
  message: string,
) {
  const aiMember = await getAIMember(aiMemberId);
  const modelConfig = await getModelConfig(aiMember.aiModel);

  // 1. 检查 API Key
  const apiKey = modelConfig?.apiKey || getEnvApiKey(aiMember.aiModel);

  if (!apiKey) {
    // 返回明确的错误消息，而非 mock 响应
    return {
      content: `**API Key 未配置**\n\n我是 ${aiMember.displayName}，但无法生成回复，因为 "${aiMember.aiModel}" 的 API Key 未配置。\n\n请在管理后台配置 API Key。`,
      isError: true,
    };
  }

  // 2. 构建上下文
  const context = await buildContext(topicId, aiMemberId);

  // 3. 调用 AI API
  const response = await callAIApi(modelConfig, context);

  // 4. 返回真实响应
  return {
    content: response.content,
    tokensUsed: response.tokensUsed,
    isError: false,
  };
}
```

---

### 2.2 场景二：人与 AI 交互（明确功能边界）

**用户场景**：用户可能请求各种功能

**功能支持矩阵**：

| 功能类型     | 是否支持 | 处理方式                       |
| ------------ | -------- | ------------------------------ |
| 文本对话     | 是       | 正常响应                       |
| 代码分析     | 是       | 正常响应                       |
| 图片生成     | 有条件   | 需 IMAGE_GENERATION capability |
| 文件分析     | 有条件   | 需要文件内容注入上下文         |
| 网络搜索     | 有条件   | 自动检测是否需要搜索           |
| URL 抓取     | 是       | 自动抓取 URL 内容              |
| 不支持的功能 | 否       | **明确告知不支持**             |

**关键规则**：

```typescript
// 伪代码：功能边界处理
async function handleUserRequest(request: UserRequest) {
  const requestType = analyzeRequestType(request.content);

  switch (requestType) {
    case "IMAGE_GENERATION":
      if (!aiMember.capabilities.includes("IMAGE_GENERATION")) {
        return `我是 ${aiMember.displayName}，不具备图像生成能力。请 @具有图像生成能力的 AI 成员。`;
      }
      return await generateImage(request);

    case "UNSUPPORTED":
      return `抱歉，我目前不支持此功能：${requestType}。`;

    default:
      return await generateTextResponse(request);
  }
}
```

**错误处理规则**：

- **不降级**：不支持的功能直接告知，不尝试"退而求其次"
- **不伪装**：API 调用失败时，告知错误原因，而非返回假响应
- **不猜测**：不确定用户意图时，询问确认

---

### 2.3 场景三：AI-AI 交互

**用户场景**：

```
AI-Grok: 关于这个问题，让我问问 @AI-Claude 的看法
```

**预期行为**：

| 步骤 | 触发条件                    | 系统行为              |
| ---- | --------------------------- | --------------------- |
| 1    | AI 消息包含 @AI-Claude      | 检测到 AI-AI 协作触发 |
| 2    | 验证 AI-Claude 存在于 Topic | 获取 AI-Claude 配置   |
| 3    | 无需 `autoRespond=true`     | AI-AI 协作始终触发    |
| 4    | 构建 AI-Claude 的上下文     | 包含 AI-Grok 的消息   |
| 5    | AI-Claude 生成响应          | 显示在聊天流中        |

**关键规则**：

```typescript
// 伪代码：AI-AI 协作检测
function parseAIMentionsFromAIResponse(aiResponse: string, topicAIs: AI[]) {
  const mentions: string[] = [];

  for (const ai of topicAIs) {
    // 检测 @AI名称 格式
    const patterns = [
      new RegExp(`@${escapeRegExp(ai.displayName)}(?![\\w])`, "i"),
      new RegExp(`@"${escapeRegExp(ai.displayName)}"`, "i"),
    ];

    for (const pattern of patterns) {
      if (pattern.test(aiResponse)) {
        mentions.push(ai.id);
        break;
      }
    }
  }

  return mentions;
}

// AI-AI 协作：无需检查 autoRespond
async function triggerAIAICollaboration(
  fromAI: string,
  toAIs: string[],
  context: Context,
) {
  for (const toAI of toAIs) {
    // 直接触发，不检查 autoRespond
    await generateAIResponse(context.topicId, context.userId, toAI);
  }
}
```

**AI 感知规则**：

- AI 必须知道 @其他AI 会触发真实响应
- 在系统 Prompt 中明确说明协作机制

```markdown
## AI 协作能力

你可以通过 @AI名称 来触发其他 AI 参与讨论：

- @AI-Claude：触发 Claude 回应
- @AI-Gemini：触发 Gemini 回应

当你在回复中写 "@AI-XXX" 时，系统会自动触发该 AI 生成响应。
这不是文本装饰，是真实的函数调用。
```

---

### 2.4 场景四：@多个 AI

**用户场景**：

```
用户: @AI-Grok @AI-Claude 你们对这个问题怎么看？
```

**预期行为**：

| 步骤 | 系统行为                              | 用户可见结果                |
| ---- | ------------------------------------- | --------------------------- |
| 1    | 解析消息，发现 @AI-Grok 和 @AI-Claude | -                           |
| 2    | 按 @ 在消息中的顺序排序               | AI-Grok 在前                |
| 3    | **并行或顺序**触发两个 AI             | 两个 AI 都显示"正在输入..." |
| 4    | 各 AI 独立生成响应                    | 两条 AI 消息出现            |

**响应策略**：

| 模式 | 描述                 | 适用场景         |
| ---- | -------------------- | ---------------- |
| 并行 | 所有 AI 同时开始生成 | 独立观点收集     |
| 顺序 | 按 @ 顺序依次生成    | 需要参考前序回复 |

**当前实现**：并行模式（所有 AI 同时触发）

**关键规则**：

- 每个 AI 独立获取相同的初始上下文
- 每个 AI 的响应互不影响（并行模式下）
- 响应按生成完成顺序显示

---

### 2.5 场景五：@Everyone

**用户场景**：

```
用户: @Everyone 请各位分享对这个方案的看法
```

**预期行为**：

| 参与者       | 行为     |
| ------------ | -------- |
| 所有人类成员 | 收到通知 |
| 所有 AI 成员 | 触发响应 |

**AI 响应规则**：

- 所有 AI 同时被触发
- 每个 AI 独立生成响应
- 不触发辩论模式（除非消息包含辩论关键词）

**@Everyone + 辩论关键词**：

```
用户: @Everyone 辩论一下：AI 会取代人类吗？
```

此时触发辩论模式：

- 按 AI 创建顺序分配红蓝方
- 第一个创建的 AI = 红方（正方）
- 第二个创建的 AI = 蓝方（反方）
- 其他 AI 作为观察者/评论者

---

### 2.6 场景六：红蓝辩论模式

**触发条件**：

1. 消息包含辩论关键词（辩论、思辨、debate、argue 等）
2. @了两个或以上 AI

**触发方式一：具体 @两个 AI**

```
用户: @AI-Grok @AI-Claude 辩论一下：996 是否合理
```

角色分配：

- AI-Grok（第一个 @）= 红方/正方
- AI-Claude（第二个 @）= 蓝方/反方

**触发方式二：@Everyone + 辩论关键词**

```
用户: @Everyone 辩论一下：996 是否合理
```

角色分配：

- 按 AI 创建时间排序
- 第一个创建的 AI = 红方
- 第二个创建的 AI = 蓝方

**辩论 Prompt 模板**：

红方 Prompt：

```markdown
## 辩论模式 - 你是【红方/正方】

**辩论主题**：{topic}
**你的对手**：@{opponent}

### 你的角色

- 你是正方，需要**支持**该主题的立场
- 积极提出论点，主动进攻
- 使用数据、研究、案例作为佐证

### 发言格式

**我方立场**：[明确表态]
**核心论点**：[你的主要观点]
**数据佐证**：[具体数据，注明来源]
**向对方提问**：[针对性问题]

@{opponent} 请回应
```

蓝方 Prompt：

```markdown
## 辩论模式 - 你是【蓝方/反方】

**辩论主题**：{topic}
**你的对手**：@{opponent}

### 你的角色

- 你是反方，需要**反对/质疑**对方立场
- 寻找对方论证的漏洞
- 使用数据、研究反驳

### 发言格式

**对方问题**：[分析对方论点漏洞]
**我方反驳**：[你的反驳观点]
**反面证据**：[具体数据，注明来源]
**质疑点**：[向对方提问]

@{opponent} 请继续
```

**辩论流程**：

```
1. 用户发起辩论
   ↓
2. 系统检测到辩论关键词 + 多 AI @
   ↓
3. 确定红蓝方
   ↓
4. 红方 AI 收到红方 Prompt，生成开场论述
   ↓
5. 红方响应中 @蓝方
   ↓
6. 蓝方 AI 收到蓝方 Prompt，生成反驳
   ↓
7. 蓝方响应中 @红方
   ↓
8. 循环进行，直到达到最大轮次或用户中断
```

**最大轮次**：3 轮（可配置）

---

## 三、错误处理规范

### 3.1 API Key 缺失

**错误响应格式**：

```markdown
**API Key 未配置**

我是 {displayName}（模型：{modelId}），但无法生成回复。

**原因**：{modelId} 的 API Key 未在系统中配置。

**解决方法**：

1. 进入管理后台 → AI 模型管理
2. 找到 "{modelId}" 并添加 API Key
3. 或设置环境变量：{envVarName}
```

### 3.2 API 调用失败

**错误响应格式**：

```markdown
**AI 响应失败**

我是 {displayName}，调用 AI 服务时遇到错误：

**错误信息**：{errorMessage}

请稍后重试，或联系管理员检查 API 配置。
```

### 3.3 模型不支持功能

**错误响应格式**：

```markdown
**功能不支持**

我是 {displayName}，不具备 {capability} 能力。

**建议**：请 @具有此能力的 AI 成员，例如 {suggestedAI}。
```

---

## 四、实现检查清单

### 4.1 单 AI 交互

- [ ] @单个 AI 能正确触发响应
- [ ] AI 使用正确的身份回复
- [ ] API Key 缺失时显示明确错误（不是 mock 响应）
- [ ] 上下文正确构建（包含最近消息）
- [ ] Prompt 可展开查看

### 4.2 人-AI 交互

- [ ] 文本对话正常
- [ ] 图片生成仅在有能力时触发
- [ ] 不支持的功能明确告知
- [ ] URL 自动抓取
- [ ] 搜索自动触发

### 4.3 AI-AI 协作

- [ ] AI @另一个 AI 能触发响应
- [ ] 不需要 autoRespond=true
- [ ] AI 知道 @会触发真实响应
- [ ] 最大递归深度限制（防止无限循环）

### 4.4 多 AI @

- [ ] @多个 AI 全部触发
- [ ] 按 @ 顺序处理
- [ ] 各 AI 独立响应

### 4.5 @Everyone

- [ ] 所有 AI 被触发
- [ ] 所有人类收到通知
- [ ] 与辩论关键词组合正确处理

### 4.6 辩论模式

- [ ] 辩论关键词正确检测
- [ ] 红蓝方按 @ 顺序/创建顺序分配
- [ ] 红方收到正方 Prompt
- [ ] 蓝方收到反方 Prompt
- [ ] AI 互相 @继续辩论
- [ ] 最大轮次限制

---

## 五、测试用例

### 5.1 单 AI 交互测试

| 测试用例     | 输入                     | 预期输出                |
| ------------ | ------------------------ | ----------------------- |
| 正常对话     | @AI-Grok 你好            | AI-Grok 友好回复        |
| API Key 缺失 | @AI-NoKey 你好           | 显示 API Key 未配置错误 |
| 复杂问题     | @AI-Grok 分析这段代码... | AI-Grok 分析代码        |

### 5.2 AI-AI 协作测试

| 测试用例          | 场景                        | 预期结果                           |
| ----------------- | --------------------------- | ---------------------------------- |
| AI @另一 AI       | AI-Grok 回复包含 @AI-Claude | AI-Claude 被触发                   |
| autoRespond=false | AI-Claude.autoRespond=false | 仍然被触发（AI-AI 协作无视此设置） |

### 5.3 辩论模式测试

| 测试用例      | 输入                          | 预期结果                           |
| ------------- | ----------------------------- | ---------------------------------- |
| 两 AI 辩论    | @AI-Grok @AI-Claude 辩论：xxx | Grok=红方, Claude=蓝方             |
| Everyone 辩论 | @Everyone 辩论：xxx           | 第一个创建=红方, 第二个创建=蓝方   |
| 角色正确      | 上述场景                      | 红方说"我是正方", 蓝方说"我是反方" |

---

## 六、当前代码问题与修复

### 6.1 问题：Mock 响应显示错误身份

**原因**：

- `generateChatCompletion` 的 switch 语句对未知模型默认调用 `callGrokAPI`
- `callGrokAPI` 返回 `getMockResponse("grok", ...)`
- 导致 Gemini 模型显示 "I'm GROK"

**修复**：

- 改为基于模型名称匹配提供商
- 未知模型直接返回正确身份的错误消息

### 6.2 问题：辩论角色分配错误

**原因**：

- @Everyone 时，所有 AI 被触发，但辩论检测代码在每个 AI 的 `generateAIResponse` 中独立运行
- 消息中只有 @Everyone，没有具体 @AI-Grok @AI-Claude
- 导致 AI 位置匹配失败

**修复**：

- 检测 @Everyone 场景
- 使用 AI 创建顺序分配角色

### 6.3 问题：AI-AI 协作需要 autoRespond

**原因**：

- 之前的检查要求目标 AI 的 `autoRespond=true`

**修复**：

- AI-AI 协作无视 `autoRespond` 设置，始终触发

---

## 七、附录

### A. 辩论关键词列表

中文：辩论、辩一下、辩一辩、思辨、红蓝、正方反方、PK
英文：debate, argue, discuss opposing views

### B. AI 能力列表

| 能力             | 说明             |
| ---------------- | ---------------- |
| TEXT_GENERATION  | 文本生成（默认） |
| IMAGE_GENERATION | 图片生成         |
| CODE_ANALYSIS    | 代码分析         |
| WEB_SEARCH       | 网络搜索         |
| FILE_ANALYSIS    | 文件分析         |

### C. 环境变量映射

| 模型前缀    | 环境变量          |
| ----------- | ----------------- |
| grok        | XAI_API_KEY       |
| gpt, o1, o3 | OPENAI_API_KEY    |
| claude      | ANTHROPIC_API_KEY |
| gemini      | GOOGLE_AI_API_KEY |

---

**文档审核状态**：待审核

**审核人**：[待填写]

**审核意见**：[待填写]

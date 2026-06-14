# 日志规范

> 统一的后端日志记录规范，确保日志清晰、可读、有意义。

## 日志级别使用规范

### 级别定义

| 级别      | 用途                   | 生产环境可见 |
| --------- | ---------------------- | ------------ |
| `error`   | 错误，需要立即关注     | 是           |
| `warn`    | 警告，潜在问题但不阻塞 | 是           |
| `log`     | 正常操作流程信息       | 是           |
| `debug`   | 调试信息，详细参数     | 否           |
| `verbose` | 极详细调试信息         | 否           |

### 使用场景

**`error` - 错误级别**

```typescript
// API 调用失败
this.logger.error(`[callAPI] Failed: ${error.message}`);

// 关键操作失败
this.logger.error(`[saveMission] Database error: ${error}`);
```

**`warn` - 警告级别**

```typescript
// 回退到备用方案
this.logger.warn(
  `[getModel] No reasoning model found, falling back to default`,
);

// 配置缺失但有默认值
this.logger.warn(`[search] No API key configured, using fallback`);

// 重试操作
this.logger.warn(
  `[callAPI] Attempt ${attempt}/${maxRetries} failed, retrying...`,
);

// 功能未实现
this.logger.warn(`[search] RSS search not implemented yet`);
```

**`log` - 信息级别**

```typescript
// 服务启动/停止
this.logger.log(`[init] Service started`);

// 关键操作完成
this.logger.log(`[saveMission] Mission saved: ${missionId}`);

// 重要状态变更
this.logger.log(`[selectModel] Selected ${modelId} via circuit breaker`);
```

**`debug` - 调试级别**

```typescript
// 详细参数信息
this.logger.debug(`[callAPI] model=${modelId}, maxTokens=${maxTokens}`);

// 中间状态
this.logger.debug(`[process] Step 2 completed, data=${JSON.stringify(data)}`);
```

## 日志格式规范

### 标准格式

```
[操作名称] 消息内容
```

NestJS Logger 会自动添加服务名称，例如：

```
[AIEngineFacade] [selectModel] Selected gpt-4o
```

### 命名规范

1. **操作名称使用方法名或功能名**
   - 正确: `[selectModel]`, `[callAPI]`, `[saveMission]`
   - 错误: `★ Starting...`, `[METHOD]`

2. **消息内容简洁明了**
   - 正确: `Selected gpt-4o via circuit breaker`
   - 错误: `★ FINAL: Selected gpt-4o by circuit breaker (isReasoning=true)`

3. **变量使用键值对格式**
   - 正确: `model=${modelId}, tokens=${maxTokens}`
   - 错误: `${modelId} with ${maxTokens} tokens at temp ${temperature}`

## 禁止事项

### 1. 不使用特殊符号

```typescript
// 错误
this.logger.warn(`[method] ★ Starting process...`);
this.logger.log(`✅ Operation completed`);
this.logger.error(`❌ Failed: ${error}`);
this.logger.warn(`⚠️ Warning: low memory`);

// 正确
this.logger.log(`[method] Starting process...`);
this.logger.log(`[method] Operation completed`);
this.logger.error(`[method] Failed: ${error}`);
this.logger.warn(`[method] Warning: low memory`);
```

### 2. 不使用临时诊断日志

```typescript
// 错误 - 诊断日志不应该用 warn
this.logger.warn(`[debug] ★ Request details: ${JSON.stringify(request)}`);

// 正确 - 使用 debug 级别
this.logger.debug(`[method] Request: model=${model}, tokens=${tokens}`);
```

### 3. 不输出敏感信息

```typescript
// 错误
this.logger.log(`[auth] API Key: ${apiKey}`);
this.logger.debug(`[request] Headers: ${JSON.stringify(headers)}`);

// 正确
this.logger.log(`[auth] API Key configured: ${!!apiKey}`);
this.logger.debug(`[request] Calling ${endpoint.substring(0, 50)}...`);
```

### 4. 不使用多行日志

```typescript
// 错误
this.logger.warn(
  `[method] Request Details:\n` +
    `  - Model: ${model}\n` +
    `  - Tokens: ${tokens}\n` +
    `  - Temperature: ${temp}`,
);

// 正确
this.logger.debug(`[method] model=${model}, tokens=${tokens}, temp=${temp}`);
```

## 模块标识规范

不同模块使用一致的操作名称前缀：

| 模块        | 前缀示例                               |
| ----------- | -------------------------------------- |
| AI Engine   | `[selectModel]`, `[callAPI]`, `[chat]` |
| AI Research | `[createMission]`, `[searchDimension]` |
| AI Writing  | `[writeChapter]`, `[reviewContent]`    |
| AI Teams    | `[executeTask]`, `[assignMember]`      |
| Prisma      | `[Prisma]`                             |
| Migration   | `[Migration]`                          |

## 日志审查清单

提交代码前检查：

- [ ] 所有 `log` 级别用于正常操作信息
- [ ] 所有 `warn` 级别用于真正的警告
- [ ] 所有 `debug` 级别用于调试信息
- [ ] 无特殊符号（★、✅、❌、⚠️等）
- [ ] 无敏感信息输出
- [ ] 格式统一：`[操作名称] 消息`

---

**最后更新**: 2026-01-17
**维护者**: Claude Code

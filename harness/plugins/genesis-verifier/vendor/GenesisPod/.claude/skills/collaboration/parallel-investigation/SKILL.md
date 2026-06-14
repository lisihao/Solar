---
name: parallel-investigation
description: 使用子代理并行调查多个方向，快速收集信息后综合分析。适用于需要探索多个可能性的问题。
context: fork
agent: Explore
allowed-tools:
  - Read
  - Grep
  - Glob
tags:
  - collaboration
  - investigation
  - subagent
---

# 并行调查技能

> 并行探索多个方向，快速收集信息，避免串行调查消耗主上下文。

## 适用场景

1. **Bug 调查**: 多个可能的问题来源
2. **架构分析**: 多个模块的交互关系
3. **代码搜索**: 多个可能的实现位置
4. **依赖分析**: 多个依赖的影响范围

## 调查原则

### 1. 分工明确

每个子代理负责一个明确的调查方向：

```
主线程: 协调和综合
  ├── 子代理 A: 调查方向 1
  ├── 子代理 B: 调查方向 2
  └── 子代理 C: 调查方向 3
```

### 2. 结果汇总

子代理返回结构化的调查结果：

```markdown
## 调查报告: [方向名称]

### 调查范围

- 检查了哪些文件/模块

### 发现

- 关键发现 1
- 关键发现 2

### 文件引用

- `path/to/file1.ts:line` - 描述
- `path/to/file2.ts:line` - 描述

### 结论

- [初步结论]

### 建议

- [后续建议]
```

## 调查模板

### Bug 并行调查

```markdown
## 并行调查: [Bug 描述]

### 调查方向

#### 方向 1: 前端层

- 目标: 检查 UI 组件和事件处理
- 范围: frontend/components/**, frontend/hooks/**

#### 方向 2: API 层

- 目标: 检查 API 调用和数据传输
- 范围: backend/src/modules/\*\*/controller.ts

#### 方向 3: 服务层

- 目标: 检查业务逻辑
- 范围: backend/src/modules/\*\*/service.ts

#### 方向 4: 数据层

- 目标: 检查数据模型和查询
- 范围: backend/prisma/schema.prisma, \*_/_.repository.ts
```

### 架构并行分析

```markdown
## 并行分析: [模块名称]

### 分析方向

#### 方向 1: 入口分析

- 目标: 找到所有入口点
- 关键词: @Controller, @Get, @Post

#### 方向 2: 依赖分析

- 目标: 找到所有依赖关系
- 关键词: import, @Inject

#### 方向 3: 导出分析

- 目标: 找到对外暴露的 API
- 关键词: export, @Public

#### 方向 4: 配置分析

- 目标: 找到相关配置
- 文件: _.module.ts, _.config.ts
```

## 执行流程

### Step 1: 定义调查方向

```typescript
const investigations = [
  {
    name: "方向1",
    target: "...",
    scope: ["path/to/files/**"],
    keywords: ["keyword1", "keyword2"],
  },
  // ...更多方向
];
```

### Step 2: 并行执行

```bash
# 子代理 1
Grep: "keyword1" in path/to/files/**
Read: 相关文件

# 子代理 2 (并行)
Grep: "keyword2" in path/to/other/**
Read: 相关文件
```

### Step 3: 综合分析

收集所有子代理结果后：

```markdown
## 综合分析

### 各方向发现

| 方向  | 关键发现 | 置信度 |
| ----- | -------- | ------ |
| 方向1 | 发现 X   | 高     |
| 方向2 | 发现 Y   | 中     |
| 方向3 | 无发现   | -      |

### 交叉验证

- 方向1 和方向2 的发现相互印证

### 最终结论

根据并行调查结果，问题最可能在 [...]

### 建议行动

1. 首先检查 [...]
2. 然后验证 [...]
```

## 使用示例

### 示例 1: 调查"用户登录失败"

```
/parallel-investigation 用户登录失败

调查方向:
1. 前端表单验证和提交逻辑
2. 认证 API 端点处理
3. JWT Token 生成和验证
4. 用户服务的认证逻辑
```

### 示例 2: 分析"AI Engine 架构"

```
/parallel-investigation AI Engine 模块依赖

调查方向:
1. AiChatService 的调用者
2. ModelSelector 的实现
3. TaskProfile 的使用
4. 事件系统的订阅者
```

## 注意事项

1. **控制并发数量**: 一般 3-5 个方向足够
2. **明确范围**: 每个方向要有清晰的搜索范围
3. **结构化输出**: 要求子代理返回结构化结果
4. **综合判断**: 主线程负责综合所有结果

---

**记住**: 并行调查的目的是快速收集信息，不是替代深度分析。收集完信息后，仍需要人工判断和决策。

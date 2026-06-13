# AI Engine 质量改进计划

> 基于 2026-02 质量评审报告，制定分阶段改进计划

---

## 改进原则

1. **安全优先**: P0 安全问题必须在第一阶段完成
2. **最小侵入**: 每次改进尽量不影响现有功能
3. **可验证**: 每项改进必须有明确的验收标准
4. **渐进式**: 大型重构拆分为可独立交付的小步骤

---

## 第一阶段: 安全加固 (P0)

### 1.1 DTO 输入验证强化

**问题**: SendMessageDto 等 DTO 的 content 字段缺少 @MaxLength，存在 DoS/OOM 风险

**改进方案**:

- 为所有接受用户文本输入的 DTO 字段添加 @MaxLength 和 @IsNotEmpty 装饰器
- 重点检查: ask、teams、writing、social 模块的消息/内容 DTO

**验收标准**:

- [ ] 所有用户输入的 string 字段都有 @MaxLength 限制
- [ ] 所有必填 string 字段都有 @IsNotEmpty
- [ ] TypeScript 编译通过
- [ ] 现有测试全部通过

### 1.2 类型定义统一 (TaskProfile / ChatMessage)

**问题**: TaskProfile 在 2 处定义，ChatMessage 在 3 处定义，存在同步风险

**改进方案**:

- 在 `ai-engine/core/types/` 下建立唯一的类型定义
- 其他位置改为从唯一定义处 re-export
- 消除字段不一致（responseFormat vs outputFormat）

**验收标准**:

- [ ] TaskProfile 只有一处权威定义
- [ ] ChatMessage 只有一处权威定义
- [ ] 所有引用方通过 re-export 或直接 import 唯一定义
- [ ] TypeScript 编译通过
- [ ] 现有测试全部通过

### 1.3 any 类型消除（高频文件）

**问题**: file-parser.tool.ts (18处 any), template-render.tool.ts (24处 any)

**改进方案**:

- 为外部库调用定义明确的类型接口（如 PDFParseResult）
- 使用 `unknown` + 类型守卫替代 `any`
- 优先处理 any 最多的 2 个文件

**验收标准**:

- [ ] file-parser.tool.ts 中 any 减少到 0
- [ ] template-render.tool.ts 中 any 减少到 0
- [ ] 使用明确的 interface 替代所有 any
- [ ] TypeScript 编译通过
- [ ] 现有测试全部通过

---

## 第二阶段: 架构治理 (P1)

> 注意: 此阶段涉及大型重构，本次改进仅完成设计文档和最小化可行改动

### 2.1 AiAskService 拆分设计

**问题**: 1156 行单体服务，sendMessage 316 行含 7 层嵌套

**改进方案设计**:

```
AiAskService (Coordinator, ~200行)
  ├── AskSessionService (会话 CRUD, ~150行)
  ├── AskMessageService (消息发送/重生成, ~300行)
  └── AskContextService (上下文构建/RAG, ~200行)
```

**本阶段交付**:

- 产出拆分设计文档
- 标注具体的方法归属

### 2.2 WritingController 依赖收敛设计

**问题**: Controller 直接依赖 16 个专项服务，违反迪米特法则

**改进方案设计**:

```
AiWritingController
  └── WritingCoordinator (新增中间层)
        ├── ProjectService
        ├── ChapterWritingService
        ├── ConsistencyEngineService
        └── ...其他专项服务
```

**本阶段交付**:

- 产出 Coordinator 接口设计
- 标注 Controller 方法到 Coordinator 方法的映射

---

## 验收检查清单

### 通用验收标准

- [ ] `npm run type-check` 通过（零类型错误）
- [ ] `npm run test:quick` 通过（零测试失败）
- [ ] 无新增 `any` 类型
- [ ] 无新增 `@ts-ignore` 或 `@ts-expect-error`
- [ ] 改动文件的 import 顺序符合规范
- [ ] 无 console.log 残留

### 安全验收标准

- [ ] 所有用户输入 DTO 有长度限制
- [ ] 类型定义无重复
- [ ] 高频 any 文件已清理

---

**计划制定时间**: 2026-02-07
**预计交付**: 第一阶段 1-2 周
**负责团队**: Claude Code Agent Team

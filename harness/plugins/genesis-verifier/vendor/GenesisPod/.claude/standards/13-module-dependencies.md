# NestJS 模块依赖管理规范

**版本：** 1.0
**更新日期：** 2026-01-21
**规范级别：** 🔴 MUST

---

## 概述

本规范定义了 NestJS 模块间依赖管理的最佳实践，旨在防止循环依赖导致的运行时错误。

### 背景

循环依赖是 NestJS 应用中常见的问题，表现为：

```
Error: Nest cannot create the XxxModule instance.
The module at index [N] of the XxxModule "imports" array is undefined.
```

---

## 核心规则

### 规则 1：禁止 Barrel Export 导入模块 🔴

```typescript
// ❌ 禁止 - barrel export 在循环依赖时会返回 undefined
import { AiEngineModule } from "../../ai-engine";
import { AiEngineModule } from "@/modules/ai-engine";

// ✅ 必须 - 直接文件导入
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { AiEngineModule } from "@/modules/ai-engine/ai-engine.module";
```

**原因**：当存在循环依赖时，barrel export（index.ts）可能在模块完全初始化前被访问，导致返回 `undefined`。

### 规则 2：循环依赖必须双向 forwardRef 🔴

当两个或多个模块形成循环时，**所有边**都必须使用 `forwardRef`：

```typescript
// AiEngineModule
@Module({
  imports: [
    forwardRef(() => AiImageModule), // ✅
  ],
})
export class AiEngineModule {}

// AiImageModule
@Module({
  imports: [
    forwardRef(() => AiEngineModule), // ✅ 双向都要加
  ],
})
export class AiImageModule {}
```

### 规则 3：服务注入也需要 forwardRef 🔴

当服务依赖来自循环依赖链中的其他模块时：

```typescript
// ❌ 错误
constructor(private readonly externalService: ExternalService) {}

// ✅ 正确
constructor(
  @Inject(forwardRef(() => ExternalService))
  private readonly externalService: ExternalService,
) {}
```

---

## 模块分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Core Layer                              │
│         AiEngineModule（核心引擎，被广泛依赖）                │
│                                                              │
│  规则：只能被其他模块导入，不应导入 Application Layer 模块   │
│  例外：如需导入，必须使用 forwardRef                         │
└─────────────────────────────────────────────────────────────┘
                           ↓ 单向依赖
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│     AiImageModule, AiOfficeModule, AiTeamsModule, etc.      │
│                                                              │
│  规则：互相导入必须使用 forwardRef                           │
│  原因：这些模块功能相关，容易形成循环                        │
└─────────────────────────────────────────────────────────────┘
                           ↓ 单向依赖
┌─────────────────────────────────────────────────────────────┐
│                      Leaf Layer                              │
│   collections, notes, reports, feedback, etc.               │
│                                                              │
│  规则：可以直接导入上层模块，无需 forwardRef                 │
│  原因：这些是末端模块，不会被上层导入                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 已知循环依赖链

以下模块已确认存在循环依赖，必须使用 forwardRef：

### 三角循环：AI 核心模块

```
AiEngineModule ──forwardRef──→ AiImageModule
       ↑                            ↓
  forwardRef                   forwardRef
       │                            ↓
       └────── AiOfficeModule ←─────┘
```

| 模块           | 导入           | 处理方式                           |
| -------------- | -------------- | ---------------------------------- |
| AiEngineModule | AiImageModule  | `forwardRef(() => AiImageModule)`  |
| AiImageModule  | AiEngineModule | `forwardRef(() => AiEngineModule)` |
| AiImageModule  | AiOfficeModule | `forwardRef(() => AiOfficeModule)` |
| AiOfficeModule | AiEngineModule | `forwardRef(() => AiEngineModule)` |
| AiOfficeModule | AiImageModule  | `forwardRef(() => AiImageModule)`  |

### 双向循环：Admin 模块

```
ExploreModule ←──forwardRef──→ AdminModule
RAGModule ────forwardRef────→ AdminModule
```

---

## PR 检查清单

新增或修改模块导入时，必须检查：

- [ ] **直接文件导入**：使用 `.module` 后缀的完整路径
- [ ] **循环检测**：是否形成 A → B → C → A 的循环？
- [ ] **forwardRef 完整性**：循环中的所有边都加了 forwardRef？
- [ ] **服务注入**：跨模块服务是否需要 `@Inject(forwardRef(...))`？

### 快速检测命令

```bash
# 检查是否有使用 barrel export 导入模块的代码
grep -r "from [\"'].*\/ai-engine[\"']" backend/src/modules --include="*.ts" | grep -v ".module"

# 检查所有 forwardRef 使用情况
grep -r "forwardRef" backend/src/modules --include="*.module.ts"
```

---

## ESLint 规则配置（推荐）

在 `.eslintrc.js` 中添加：

```javascript
module.exports = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/ai-engine", "**/ai-engine/index"],
            message:
              '禁止使用 barrel export。请使用: import { XxxModule } from "path/to/xxx.module"',
          },
          {
            group: ["**/ai-app/image", "**/ai-app/office", "**/ai-app/teams"],
            message: "禁止使用 barrel export。请使用直接文件导入。",
          },
        ],
      },
    ],
  },
};
```

---

## 故障排查

### 错误：`The module at index [N] is undefined`

1. **定位模块**：查看错误中的 `XxxModule` 名称
2. **查看 imports 数组**：找到 index [N] 对应的模块
3. **检查导入方式**：
   - 是否使用了 barrel export？→ 改为直接文件导入
   - 是否在循环链中？→ 添加 forwardRef
4. **检查完整循环**：确保循环中的所有边都有 forwardRef

### 错误：`Nest can't resolve dependencies of XxxService`

1. **定位服务**：查看错误中的服务名称
2. **检查该服务的依赖**：是否依赖循环链中的服务？
3. **添加 forwardRef**：在构造器中使用 `@Inject(forwardRef(() => Xxx))`

---

## 相关文档

- [NestJS 官方文档 - 循环依赖](https://docs.nestjs.com/fundamentals/circular-dependency)
- [02-directory-structure.md](02-directory-structure.md) - 模块目录结构
- [04-code-style.md](04-code-style.md) - 代码风格规范

---

**维护者**: Claude Code
**最后更新**: 2026-01-21

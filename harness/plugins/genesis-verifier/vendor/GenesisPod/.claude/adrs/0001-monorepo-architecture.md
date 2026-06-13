# ADR-0001: 采用Monorepo架构

> **创建日期**: 2025-01-01
> **作者**: GenesisPod Team
> **审阅者**: -

---

## 状态

✅ **已接受** (Accepted) - 2025-01-01

---

## 上下文

### 问题描述

GenesisPod包含多个紧密关联的模块：

- **Frontend**: Next.js应用，用户界面
- **Backend**: NestJS API服务
- **AI Service**: Python FastAPI服务，处理AI推荐
- **Shared Types**: 类型定义和共享代码

我们需要决定如何组织代码仓库结构，以便：

- 保持代码同步和一致性
- 简化开发工作流
- 便于跨模块重构
- 高效的CI/CD流程

### 约束条件

- **技术约束**:
  - 使用TypeScript（前后端）+ Python（AI服务）
  - 需要支持独立部署各个服务

- **资源约束**:
  - 小团队（3-5人）
  - 需要快速迭代MVP

- **业务约束**:
  - 频繁的跨模块功能开发
  - 需要保持API和类型定义同步

### 目标

- [x] 简化依赖管理和版本控制
- [x] 实现代码和类型共享
- [x] 支持原子化提交（跨模块变更）
- [x] 降低开发和维护成本

---

## 决策

我们决定采用 **Monorepo（单一代码仓库）** 架构。

### 详细说明

项目结构如下：

```
genesis-ai/
├── frontend/              # Next.js前端
│   ├── package.json
│   └── ...
├── backend/               # NestJS后端
│   ├── package.json
│   └── ...
├── ai-service/            # Python AI服务
│   ├── requirements.txt
│   └── ...
├── packages/              # 共享代码（未来）
│   └── shared-types/
├── package.json           # 根package.json
├── package-lock.json      # 统一依赖锁定
└── .github/
    └── workflows/         # 统一CI/CD
```

### 实施要点

- 使用npm workspaces管理TypeScript项目
- Python服务保持独立的virtualenv
- 共享的GitHub Actions工作流
- 统一的ESLint、Prettier、TypeScript配置

---

## 考虑的方案

### 方案A: Monorepo（单一仓库）

#### 描述

所有代码存放在单一Git仓库中，使用npm workspaces管理。

#### 优点

- ✅ **原子化提交**: 跨模块变更可以在一次commit完成
- ✅ **代码共享简单**: 共享类型、工具函数无需发布npm包
- ✅ **重构友好**: 跨模块重构很容易
- ✅ **版本一致性**: 所有模块版本同步
- ✅ **简化CI/CD**: 单一流水线处理所有构建和测试

#### 缺点

- ❌ **仓库变大**: 随着代码增长，克隆时间增加
- ❌ **构建复杂**: 需要智能构建只变更的部分
- ❌ **权限控制难**: 无法精细控制各模块访问权限

#### 成本

- 开发时间：1-2天配置
- 学习曲线：低
- 长期维护：中

---

### 方案B: Polyrepo（多仓库）

#### 描述

前端、后端、AI服务分别独立仓库，通过npm发布共享代码。

#### 优点

- ✅ **清晰的边界**: 每个服务完全独立
- ✅ **精细的权限控制**: 可以按仓库控制访问权限
- ✅ **简单的CI/CD**: 每个仓库独立流水线

#### 缺点

- ❌ **跨仓库变更复杂**: 需要多个PR和版本发布
- ❌ **代码共享困难**: 需要发布npm包才能共享代码
- ❌ **版本管理噩梦**: 多个版本需要手动同步
- ❌ **重构成本高**: 跨仓库重构需要精心协调

#### 成本

- 开发时间：3-5天配置多个仓库
- 学习曲线：中
- 长期维护：高（版本同步成本）

---

### 方案C: Micro-frontend + Polyrepo

#### 描述

使用微前端架构，每个功能模块独立仓库。

#### 优点

- ✅ **最大化独立性**: 每个模块完全自治
- ✅ **团队自主性**: 不同团队可以独立开发

#### 缺点

- ❌ **过度工程**: 对小团队来说太复杂
- ❌ **集成困难**: 微前端架构有额外的复杂性
- ❌ **性能开销**: 运行时集成有性能损失

#### 成本

- 开发时间：2-3周
- 学习曲线：高
- 长期维护：高

---

## 决策理由

我们选择**方案A: Monorepo**的主要理由：

1. **团队规模小**: 3-5人的小团队，不需要严格的代码隔离，更需要协作效率
2. **MVP阶段**: 需要快速迭代，跨模块变更频繁，Monorepo大幅降低协调成本
3. **类型安全**: TypeScript类型定义可以直接共享，无需发布npm包
4. **原子化变更**: API变更和Frontend调整可以在一个PR完成，避免版本同步问题
5. **业界验证**: Google、Facebook、Microsoft等大公司都在使用Monorepo

### 对比总结

| 维度         | Monorepo   | Polyrepo   | Micro-frontend |
| ------------ | ---------- | ---------- | -------------- |
| 协作效率     | ⭐⭐⭐⭐⭐ | ⭐⭐       | ⭐⭐           |
| 代码共享     | ⭐⭐⭐⭐⭐ | ⭐⭐       | ⭐             |
| 重构友好     | ⭐⭐⭐⭐⭐ | ⭐⭐       | ⭐             |
| 版本管理     | ⭐⭐⭐⭐⭐ | ⭐⭐       | ⭐⭐           |
| 构建复杂度   | ⭐⭐⭐     | ⭐⭐⭐⭐   | ⭐⭐           |
| 权限控制     | ⭐⭐       | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐       |
| 小团队适用性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐     | ⭐             |

---

## 结果

### 正面影响

- ✅ **开发效率提升**: 跨模块开发无需切换仓库，变更可以原子化提交
- ✅ **类型安全**: Frontend和Backend共享类型定义，编译时发现不匹配
- ✅ **CI/CD简化**: 单一流水线，统一的质量门禁
- ✅ **重构友好**: 大规模重构可以一次性完成，不会有版本同步问题
- ✅ **代码复用**: 共享工具函数、常量、配置无需发布包

### 负面影响 / 权衡

- ⚠️ **仓库大小**: 随着项目增长，仓库会变大（但现代Git工具处理得很好）
- ⚠️ **构建时间**: 全量构建时间较长（可通过增量构建缓解）

### 风险与缓解措施

#### 风险1: 构建时间随着项目增长变长

- **可能性**: 高
- **影响**: 中
- **缓解措施**:
  - 使用Turborepo或Nx实现增量构建
  - CI中缓存node_modules和构建产物
  - 只构建变更的模块

#### 风险2: 新成员克隆仓库时间长

- **可能性**: 中
- **影响**: 低
- **缓解措施**:
  - 使用Git shallow clone（--depth=1）
  - 提供开发环境Docker镜像

### 成功指标

- [x] PR从创建到合并的平均时间减少50%
- [x] 跨模块变更的PR数量减少（无需多个PR协调）
- [x] 类型错误在编译时发现，运行时API错误减少80%

---

## 实施计划

### 阶段1: 初始设置 (Day 1)

- [x] 创建根package.json配置workspaces
- [x] 配置npm workspaces
- [x] 统一ESLint、Prettier配置

### 阶段2: CI/CD迁移 (Day 2)

- [x] 配置GitHub Actions统一流水线
- [x] 设置缓存策略
- [x] 配置并行构建

### 阶段3: 共享代码提取 (Week 2)

- [x] 创建shared-types包
- [x] 提取通用工具函数
- [x] 统一配置文件

---

## 参考资料

- [Google's Monorepo Approach](https://cacm.acm.org/magazines/2016/7/204032-why-google-stores-billions-of-lines-of-code-in-a-single-repository/fulltext)
- [Microsoft's Monorepo](https://www.microsoft.com/en-us/research/publication/building-at-cloud-scale-inside-the-azure-devops-monorepo/)
- [npm workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces)
- [Monorepo Tools](https://monorepo.tools/)

---

## 变更历史

| 日期       | 版本 | 变更内容 | 作者 |
| ---------- | ---- | -------- | ---- |
| 2025-01-01 | 1.0  | 初始版本 | Team |

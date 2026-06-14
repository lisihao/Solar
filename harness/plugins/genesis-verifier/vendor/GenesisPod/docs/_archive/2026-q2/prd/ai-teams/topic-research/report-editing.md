# Topic Research 洞察报告编辑功能 PRD

## 文档信息

| 属性     | 内容                                                |
| -------- | --------------------------------------------------- |
| 版本     | 1.0                                                 |
| 作者     | PM Agent                                            |
| 创建日期 | 2026-01-13                                          |
| 状态     | 草稿                                                |
| 模块     | Topic Research (专题研究)                           |
| 路径     | frontend/components/ai-research/                    |
|          | backend/src/modules/ai-app/research/topic-research/ |

---

## 1. 概述

### 1.1 背景

当前 Topic Research 模块可以生成专题研究报告，但缺少完善的编辑和协作功能。用户在生成报告后，需要能够：

1. 直接编辑报告内容，修正 AI 生成的错误或不足
2. 使用 AI 辅助编辑特定段落（重写、润色、扩展等）
3. 添加批注进行审核和反馈
4. 管理版本历史，支持回滚
5. 查看继承式更新中的新增内容

### 1.2 目标

| 目标             | 成功指标                     |
| ---------------- | ---------------------------- |
| 提升报告编辑效率 | 用户编辑报告平均时间减少 40% |
| 增强 AI 协作能力 | AI 编辑功能使用率 > 60%      |
| 完善审核流程     | 批注功能使用率 > 30%         |
| 保障内容安全     | 版本回滚成功率 100%          |
| 支持迭代式更新   | 新内容识别准确率 > 95%       |

### 1.3 非目标

本次迭代不包含：

- 多人实时协作编辑（类似 Google Docs）
- 离线编辑能力
- 报告模板自定义设计器
- 复杂的审批流程系统

---

## 2. 用户故事

### 2.1 角色定义

| 角色       | 描述                             |
| ---------- | -------------------------------- |
| **研究员** | 创建和管理专题研究，编辑报告内容 |
| **审核者** | 审阅报告，添加批注和建议         |
| **管理员** | 管理协作者权限，查看版本历史     |

### 2.2 用户故事列表

| ID     | 角色   | 故事                                                         | 优先级 |
| ------ | ------ | ------------------------------------------------------------ | ------ |
| US-001 | 研究员 | 作为研究员，我想在报告页面直接编辑内容，以便快速修正错误     | P0     |
| US-002 | 研究员 | 作为研究员，我想选中文本后调用 AI 进行润色，以便提升表达质量 | P0     |
| US-003 | 研究员 | 作为研究员，我想看到刷新后的新增内容标识，以便快速定位变化   | P0     |
| US-004 | 审核者 | 作为审核者，我想为特定段落添加批注，以便记录审核意见         | P1     |
| US-005 | 研究员 | 作为研究员，我想查看版本历史并回滚，以便恢复误删内容         | P1     |
| US-006 | 研究员 | 作为研究员，我想使用 AI 扩写或压缩段落，以便调整内容篇幅     | P1     |
| US-007 | 审核者 | 作为审核者，我想查看并处理所有待审批注，以便完成审核流程     | P1     |
| US-008 | 管理员 | 作为管理员，我想对比两个版本的差异，以便了解变更范围         | P2     |
| US-009 | 研究员 | 作为研究员，我想一键 Checkin 新内容，确认其为正式内容        | P2     |
| US-010 | 研究员 | 作为研究员，我想切换只读/编辑/审核模式，以便专注不同任务     | P2     |

---

## 3. 功能需求

### 3.1 功能列表

| ID    | 功能名称       | 描述                             | 优先级 |
| ----- | -------------- | -------------------------------- | ------ |
| F-001 | 报告编辑模式   | 支持预览、编辑、分屏三种视图模式 | P0     |
| F-002 | AI 浮动工具栏  | 选中文本时显示 AI 编辑选项       | P0     |
| F-003 | AI 编辑操作    | 重写、润色、扩展、压缩、风格调整 | P0     |
| F-004 | 继承式更新标识 | 不同颜色标识新增/修改/删除内容   | P0     |
| F-005 | 版本历史面板   | 展示修订历史列表                 | P1     |
| F-006 | 版本回滚       | 回滚到任意历史版本               | P1     |
| F-007 | 批注系统       | 添加、编辑、删除、解决批注       | P1     |
| F-008 | 变更摘要       | 刷新后显示变更概览               | P1     |
| F-009 | 版本对比       | Diff 视图对比两个版本差异        | P2     |
| F-010 | 新内容 Checkin | 确认新增内容为正式内容           | P2     |
| F-011 | 批量操作       | 批量解决批注、批量 Checkin       | P2     |

### 3.2 详细说明

---

#### F-001: 报告编辑模式

**描述**
用户可以在三种模式间切换查看和编辑报告内容。

**前置条件**

- 用户已登录
- 用户有报告编辑权限

**模式说明**

| 模式 | 说明                                      |
| ---- | ----------------------------------------- |
| 预览 | 只读模式，渲染 Markdown，显示引用 Tooltip |
| 编辑 | 编辑模式，左侧编辑器，支持文本选择触发 AI |
| 分屏 | 左编辑右预览，实时同步                    |

**UI 原型**

```
+------------------------------------------+
|  [预览] [编辑] [分屏]     [历史] [批注] [保存]  |
+------------------------------------------+
|                                          |
|  报告内容区域                              |
|  (根据模式显示不同视图)                     |
|                                          |
+------------------------------------------+
```

**验收标准**

- [ ] 三种模式可正常切换
- [ ] 编辑模式下修改内容后显示"未保存"提示
- [ ] 分屏模式下左右同步滚动
- [ ] 预览模式下引用 [1] 显示 Tooltip

---

#### F-002: AI 浮动工具栏

**描述**
当用户在编辑模式下选中文本时，显示浮动工具栏提供 AI 编辑选项。

**前置条件**

- 处于编辑模式
- 选中了有效文本（长度 > 10 字符）

**交互流程**

1. 用户选中文本
2. 在选区上方/下方显示浮动工具栏
3. 工具栏包含：重写、润色、扩展、压缩、风格、自定义
4. 点击选项执行相应 AI 操作
5. AI 返回结果后显示预览对话框
6. 用户可接受或拒绝修改

**UI 原型**

```
选中文本:
+-----------------------------------------+
| 这是一段需要编辑的文本内容，用户已经选中了 |
+-----------------------------------------+
        |
        v
+------------------------------------------------+
| [重写] [润色] [扩展] [压缩] [风格 v] [自定义...] |
+------------------------------------------------+
```

**验收标准**

- [ ] 选中文本时工具栏自动显示
- [ ] 点击空白处工具栏自动隐藏
- [ ] 工具栏位置自动适应（不超出视口）
- [ ] 移动端不显示浮动工具栏（使用底部菜单）

---

#### F-003: AI 编辑操作

**描述**
提供五种预设 AI 编辑操作和自定义指令功能。

**操作类型**

| 操作     | 说明                           | 图标 | TaskProfile        |
| -------- | ------------------------------ | ---- | ------------------ |
| 重写     | 完全重新生成内容，保持核心信息 | 🔄   | creativity: high   |
| 润色     | 优化语言表达，不改变含义       | ✨   | creativity: low    |
| 扩展     | 增加细节、例子和解释           | 📈   | creativity: medium |
| 压缩     | 精简内容，保留核心信息         | 📉   | creativity: low    |
| 风格调整 | 转换为学术/商业/通俗/技术风格  | 🎨   | creativity: medium |
| 自定义   | 用户输入自由指令               | 💬   | 根据指令判断       |

**响应格式**

```json
{
  "original": "原始选中文本",
  "edited": "AI 编辑后的文本",
  "operation": "polish",
  "changes": [
    {
      "type": "replace",
      "from": "旧文本",
      "to": "新文本"
    }
  ]
}
```

**验收标准**

- [ ] 五种预设操作正确执行
- [ ] 自定义指令支持中英文
- [ ] 编辑过程显示 loading 状态
- [ ] 编辑失败显示友好错误提示
- [ ] 编辑结果可预览后接受/拒绝

---

#### F-004: 继承式更新标识

**描述**
当报告刷新后，用不同颜色和样式标识新增、修改和删除的内容。

**标识规则**

| 类型   | 颜色/样式                     | 说明                  |
| ------ | ----------------------------- | --------------------- |
| 新增   | 浅绿色背景 (#E8F5E9)          | 本次刷新新增的内容    |
| 修改   | 浅黄色背景 (#FFF8E1)          | 本次刷新修改的内容    |
| 删除   | 浅红色背景 + 删除线 (#FFEBEE) | 上次存在但本次被删除  |
| 已确认 | 无特殊样式                    | 用户已 Checkin 的内容 |

**数据结构**

```typescript
interface ContentChange {
  id: string;
  sectionId: string;
  changeType: "added" | "modified" | "deleted";
  previousContent?: string;
  currentContent: string;
  startOffset: number;
  endOffset: number;
  checkedInAt?: Date;
  checkedInBy?: string;
}
```

**交互流程**

1. 刷新报告完成后，系统自动计算变更
2. 变更内容以颜色标识显示
3. 左侧显示变更摘要浮窗
4. 点击变更条目可跳转到对应位置
5. 用户可逐条或批量 Checkin 确认

**验收标准**

- [ ] 刷新后自动显示变更标识
- [ ] 点击变更摘要可跳转定位
- [ ] 颜色标识在预览和编辑模式都显示
- [ ] Checkin 后样式恢复正常

---

#### F-005: 版本历史面板

**描述**
在侧边栏显示报告的修订历史列表。

**显示信息**

| 字段     | 说明                          |
| -------- | ----------------------------- |
| 版本号   | 修订版本序号                  |
| 修改时间 | 修订创建时间                  |
| 修改类型 | 手动编辑/AI编辑/刷新更新/回滚 |
| 修改描述 | 简短描述修改内容              |
| 修改者   | 操作用户名称                  |
| 字数变化 | +100 / -50 等变化量           |

**UI 原型**

```
+----------------------------------+
| 📋 修订历史        [对比] [关闭]  |
+----------------------------------+
| v12 - 当前版本                   |
|   ✏️ 手动编辑  今天 14:30        |
|   "修正了第三节的数据"            |
+----------------------------------+
| v11                              |
|   ✨ AI润色    今天 14:15        |
|   "润色了执行摘要"                |
|   [预览] [回滚]                  |
+----------------------------------+
| v10                              |
|   🔄 刷新更新   昨天 10:00       |
|   "增量刷新，新增3个发现"         |
|   [预览] [回滚]                  |
+----------------------------------+
```

**验收标准**

- [ ] 按时间倒序显示历史版本
- [ ] 显示修改类型图标和描述
- [ ] 最多显示 50 个历史版本
- [ ] 点击"预览"可查看该版本内容
- [ ] 点击"回滚"可恢复到该版本

---

#### F-006: 版本回滚

**描述**
将报告内容恢复到指定的历史版本。

**交互流程**

1. 用户在版本历史中选择目标版本
2. 点击"回滚"按钮
3. 显示确认对话框，提示"当前内容将被覆盖"
4. 确认后执行回滚
5. 回滚成功后刷新页面内容
6. 自动创建新版本记录（类型：回滚）

**验收标准**

- [ ] 回滚操作需二次确认
- [ ] 回滚后内容正确恢复
- [ ] 回滚操作记录在版本历史中
- [ ] 回滚失败显示错误提示

---

#### F-007: 批注系统

**描述**
支持对报告特定内容添加批注，用于审核和反馈。

**批注类型**

| 类型 | 说明             | 颜色 | 图标 |
| ---- | ---------------- | ---- | ---- |
| 评论 | 一般性评论       | 蓝色 | 💬   |
| 建议 | 改进建议         | 绿色 | 💡   |
| 问题 | 需要关注的问题   | 红色 | ⚠️   |
| 引用 | 需要补充引用来源 | 紫色 | 📎   |

**批注状态**

| 状态   | 说明       |
| ------ | ---------- |
| 待处理 | 新建的批注 |
| 已解决 | 已处理完成 |
| 已忽略 | 不需要处理 |

**交互流程**

1. 用户选中文本
2. 点击"添加批注"按钮
3. 选择批注类型
4. 输入批注内容
5. 提交后显示在右侧批注栏
6. 点击批注可高亮对应文本

**验收标准**

- [ ] 支持四种批注类型
- [ ] 批注与文本位置关联
- [ ] 点击批注可跳转定位
- [ ] 支持批量解决批注
- [ ] 批注可编辑和删除

---

#### F-008: 变更摘要

**描述**
刷新报告后显示变更概览，帮助用户快速了解更新内容。

**显示内容**

```
+------------------------------------------+
| 📊 本次更新摘要           [全部 Checkin]  |
+------------------------------------------+
| 新增内容: 3 处                            |
|   • 第2节: 新增市场分析数据               |
|   • 第4节: 新增竞品对比表格               |
|   • 第5节: 新增风险提示                   |
+------------------------------------------+
| 修改内容: 2 处                            |
|   • 执行摘要: 更新核心结论                |
|   • 第3节: 修正技术趋势描述               |
+------------------------------------------+
| 删除内容: 1 处                            |
|   • 第6节: 移除过时的数据                 |
+------------------------------------------+
```

**验收标准**

- [ ] 刷新后自动显示变更摘要
- [ ] 点击条目可跳转到对应位置
- [ ] 显示新增/修改/删除的数量
- [ ] 支持一键全部 Checkin

---

#### F-009: 版本对比

**描述**
Diff 视图对比两个版本之间的内容差异。

**对比模式**

| 模式     | 说明                 |
| -------- | -------------------- |
| 并排对比 | 左旧右新，高亮差异   |
| 统一视图 | 单列显示，标记增删改 |
| 仅改动   | 只显示有变化的段落   |

**差异标识**

- 新增行: 绿色背景 + "+" 前缀
- 删除行: 红色背景 + "-" 前缀
- 修改: 黄色高亮变化的文字

**验收标准**

- [ ] 可选择任意两个版本对比
- [ ] 支持三种对比模式切换
- [ ] 差异标识清晰可辨
- [ ] 长内容可滚动查看

---

#### F-010: 新内容 Checkin

**描述**
确认新增/修改的内容为正式内容，清除变更标识。

**交互流程**

1. 悬停在新增内容上
2. 显示 "✓ Checkin" 按钮
3. 点击后清除该内容的变更标识
4. 记录 Checkin 用户和时间

**验收标准**

- [ ] 单条内容可独立 Checkin
- [ ] 批量 Checkin 全部变更
- [ ] Checkin 后样式恢复正常
- [ ] 记录 Checkin 操作日志

---

## 4. 交互设计

### 4.1 报告页面整体布局

```
+------------------------------------------------------------------+
|  [<] 返回   专题名称: AI 大模型发展趋势研究                         |
+------------------------------------------------------------------+
|                    |                                              |
|  +-------------+   |  +---------------------------------------+   |
|  | 目录导航    |   |  | [预览][编辑][分屏]  [历史][批注][保存] |   |
|  +-------------+   |  +---------------------------------------+   |
|  | 1. 执行摘要 |   |  |                                       |   |
|  | 2. 市场分析 |   |  |  报告内容区域                          |   |
|  | 3. 技术趋势 |   |  |                                       |   |
|  | 4. 竞品对比 |   |  |  (支持 Markdown 渲染)                  |   |
|  | 5. 风险提示 |   |  |  (选中文本显示 AI 工具栏)              |   |
|  | 6. 结论建议 |   |  |                                       |   |
|  +-------------+   |  +---------------------------------------+   |
|                    |                                              |
|  +-------------+   |  +---------------------------------------+   |
|  | 变更摘要    |   |  |  状态栏: 版本 v12 | 12,345 字 | 已保存 |   |
|  | 新增: 3     |   |  +---------------------------------------+   |
|  | 修改: 2     |   |                                              |
|  | [全部确认]  |   |                                              |
|  +-------------+   |                                              |
+------------------------------------------------------------------+
```

### 4.2 工具栏按钮设计

**主工具栏**

| 按钮 | 图标 | 快捷键 | 说明             |
| ---- | ---- | ------ | ---------------- |
| 预览 | 👁️   | Ctrl+1 | 切换到预览模式   |
| 编辑 | ✏️   | Ctrl+2 | 切换到编辑模式   |
| 分屏 | ⬜⬜ | Ctrl+3 | 切换到分屏模式   |
| 历史 | 📋   | Ctrl+H | 打开版本历史面板 |
| 批注 | 📝   | Ctrl+M | 打开批注面板     |
| 保存 | 💾   | Ctrl+S | 保存当前修改     |
| 导出 | ⬇️   | -      | 导出为 PDF/Word  |

**AI 浮动工具栏**

| 按钮   | 图标 | 说明           |
| ------ | ---- | -------------- |
| 重写   | 🔄   | 完全重新生成   |
| 润色   | ✨   | 优化语言表达   |
| 扩展   | 📈   | 增加细节       |
| 压缩   | 📉   | 精简内容       |
| 风格   | 🎨   | 下拉选择风格   |
| 自定义 | 💬   | 输入自定义指令 |

### 4.3 编辑模式详细设计

**编辑模式布局**

```
+------------------------------------------+
| 工具栏                                    |
+------------------------------------------+
|                                          |
| Markdown 编辑器                           |
| +--------------------------------------+ |
| | # 执行摘要                           | |
| |                                      | |
| | 本报告聚焦于 AI 大模型的发展趋势...   | |
| |     [选中文本时显示工具栏]            | |
| |                                      | |
| +--------------------------------------+ |
|                                          |
+------------------------------------------+
| 状态栏: 行 12, 列 45 | 12,345 字 | 编辑中 |
+------------------------------------------+
```

**AI 编辑预览对话框**

```
+------------------------------------------+
| ✨ AI 编辑结果预览                 [关闭] |
+------------------------------------------+
| 原文:                                    |
| +--------------------------------------+ |
| | 这是一段需要润色的文本内容。          | |
| +--------------------------------------+ |
|                                          |
| AI 润色结果:                             |
| +--------------------------------------+ |
| | 这是一段经过精心润色的优质文本内容。   | |
| | [高亮显示变化的部分]                   | |
| +--------------------------------------+ |
|                                          |
| [接受修改]              [放弃] [重新生成] |
+------------------------------------------+
```

### 4.4 审核模式设计

**审核模式特点**

- 报告内容只读
- 右侧显示批注列表
- 选中文本可添加批注
- 顶部显示批注统计

```
+------------------------------------------+
| 审核模式  待处理: 5 | 已解决: 12 | 已忽略: 2 |
+------------------------------------------+
|  报告内容 (只读)        |  批注面板       |
|                         |                |
|  [高亮批注位置]         |  💬 评论 #1    |
|                         |  位置: 第2段   |
|                         |  "建议补充..." |
|                         |  [解决] [回复] |
|                         |                |
|                         |  ⚠️ 问题 #2    |
|                         |  位置: 第5段   |
|                         |  "数据有误..." |
|                         |  [解决] [回复] |
+------------------------------------------+
```

---

## 5. 继承式更新设计

### 5.1 变更检测机制

**检测时机**

- 报告刷新完成后
- 报告内容合成阶段

**检测算法**
使用 diff 算法对比上一版本和新版本的内容：

```typescript
interface VersionDiff {
  reportId: string;
  fromVersion: number;
  toVersion: number;
  changes: ContentChange[];
  summary: {
    addedCount: number;
    modifiedCount: number;
    deletedCount: number;
    totalChangedWords: number;
  };
}

interface ContentChange {
  id: string;
  sectionId: string;
  sectionName: string;
  changeType: "added" | "modified" | "deleted";
  previousContent?: string;
  currentContent: string;
  startOffset: number;
  endOffset: number;
  wordsDiff: number; // 正数新增，负数删除
  confidence: number; // 变更检测置信度
}
```

### 5.2 变更标识样式

**CSS 样式定义**

```css
/* 新增内容 */
.change-added {
  background-color: #e8f5e9;
  border-left: 3px solid #4caf50;
  padding-left: 8px;
}

/* 修改内容 */
.change-modified {
  background-color: #fff8e1;
  border-left: 3px solid #ffc107;
  padding-left: 8px;
}

/* 删除内容 */
.change-deleted {
  background-color: #ffebee;
  text-decoration: line-through;
  color: #9e9e9e;
}

/* 悬停显示操作按钮 */
.change-added:hover .checkin-btn,
.change-modified:hover .checkin-btn {
  display: inline-flex;
}
```

### 5.3 Checkin 流程

**单条 Checkin**

1. 悬停变更内容块
2. 显示 "✓ Checkin" 按钮
3. 点击按钮
4. 调用 API 记录 Checkin
5. 移除变更样式

**批量 Checkin**

1. 点击变更摘要中的"全部确认"
2. 显示确认对话框
3. 确认后批量调用 API
4. 清除所有变更标识

**数据记录**

```typescript
interface Checkin {
  id: string;
  reportId: string;
  changeId: string;
  userId: string;
  checkedInAt: Date;
  comment?: string;
}
```

---

## 6. 版本管理设计

### 6.1 版本创建时机

| 触发事件     | 版本类型     |
| ------------ | ------------ |
| 用户手动保存 | MANUAL_EDIT  |
| AI 重写      | AI_REWRITE   |
| AI 润色      | AI_POLISH    |
| AI 扩写      | AI_EXPAND    |
| AI 压缩      | AI_CONDENSE  |
| AI 风格调整  | AI_STYLE_FIX |
| 报告刷新     | REFRESH      |
| 版本回滚     | ROLLBACK     |

### 6.2 版本数据结构

```typescript
interface ReportRevision {
  id: string;
  reportId: string;
  version: number;
  changeType: RevisionChangeType;
  changeSummary: string;
  content: {
    summary: string;
    fullReport: string;
    highlights: ReportHighlight[];
  };
  metadata: {
    wordCount: number;
    wordsDiff: number;
    sectionsChanged: string[];
  };
  createdById: string;
  createdAt: Date;
}
```

### 6.3 版本对比算法

使用 word-level diff 进行细粒度对比：

```typescript
interface DiffResult {
  fromVersion: number;
  toVersion: number;
  sections: SectionDiff[];
  stats: {
    addedWords: number;
    deletedWords: number;
    unchangedWords: number;
  };
}

interface SectionDiff {
  sectionId: string;
  sectionName: string;
  changes: DiffChange[];
}

interface DiffChange {
  type: "equal" | "insert" | "delete" | "replace";
  content: string;
  oldContent?: string;
}
```

---

## 7. 技术实现建议

### 7.1 前端组件设计

**新增组件**

| 组件名                | 路径                                             | 说明               |
| --------------------- | ------------------------------------------------ | ------------------ |
| ReportEditPanel       | components/ai-research/ReportEditPanel.tsx       | 报告编辑面板主组件 |
| ReportEditor          | components/ai-research/ReportEditor.tsx          | Markdown 编辑器    |
| AIFloatingToolbar     | components/ai-research/AIFloatingToolbar.tsx     | AI 浮动工具栏      |
| AIEditPreviewDialog   | components/ai-research/AIEditPreviewDialog.tsx   | AI 编辑预览对话框  |
| ReportRevisionHistory | components/ai-research/ReportRevisionHistory.tsx | 版本历史面板       |
| ReportAnnotations     | components/ai-research/ReportAnnotations.tsx     | 批注面板           |
| ReportVersionDiff     | components/ai-research/ReportVersionDiff.tsx     | 版本对比视图       |
| ChangeHighlighter     | components/ai-research/ChangeHighlighter.tsx     | 变更高亮组件       |
| ChangeSummaryPanel    | components/ai-research/ChangeSummaryPanel.tsx    | 变更摘要面板       |

**组件依赖关系**

```
TopicContentPanel (现有)
  └── ReportEditPanel (新增)
        ├── ReportEditor
        │     └── AIFloatingToolbar
        │           └── AIEditPreviewDialog
        ├── ChangeHighlighter
        ├── ChangeSummaryPanel
        └── (侧边面板)
              ├── ReportRevisionHistory
              │     └── ReportVersionDiff
              └── ReportAnnotations
```

### 7.2 后端 API 设计

**现有 API 扩展**

已有的 API 可以复用：

- `PATCH /topic-research/topics/:topicId/reports/:reportId` - 更新报告
- `POST /topic-research/topics/:topicId/reports/:reportId/ai-edit` - AI 编辑
- `GET /topic-research/topics/:topicId/reports/:reportId/revisions` - 获取修订历史
- `POST /topic-research/topics/:topicId/reports/:reportId/rollback` - 回滚版本
- `POST /topic-research/topics/:id/reports/compare` - 版本对比

**新增 API**

| 方法   | 路径                                                   | 说明         |
| ------ | ------------------------------------------------------ | ------------ |
| GET    | /topics/:topicId/reports/:reportId/changes             | 获取变更列表 |
| POST   | /topics/:topicId/reports/:reportId/changes/checkin     | 批量 Checkin |
| POST   | /topics/:topicId/reports/:reportId/changes/:id/checkin | 单条 Checkin |
| GET    | /topics/:topicId/reports/:reportId/annotations         | 获取批注列表 |
| POST   | /topics/:topicId/reports/:reportId/annotations         | 创建批注     |
| PATCH  | /topics/:topicId/reports/:reportId/annotations/:id     | 更新批注     |
| DELETE | /topics/:topicId/reports/:reportId/annotations/:id     | 删除批注     |
| POST   | /topics/:topicId/reports/:reportId/annotations/resolve | 批量解决批注 |

### 7.3 数据模型建议

**新增 Prisma 模型**

```prisma
// 报告变更记录
model ReportChange {
  id              String          @id @default(cuid())
  reportId        String
  sectionId       String?
  sectionName     String?
  changeType      ChangeType
  previousContent String?         @db.Text
  currentContent  String          @db.Text
  startOffset     Int
  endOffset       Int
  wordsDiff       Int             @default(0)
  confidence      Float           @default(1.0)
  checkedInAt     DateTime?
  checkedInById   String?
  createdAt       DateTime        @default(now())

  report          TopicReport     @relation(fields: [reportId], references: [id])
  checkedInBy     User?           @relation(fields: [checkedInById], references: [id])
}

enum ChangeType {
  ADDED
  MODIFIED
  DELETED
}

// 报告批注
model ReportAnnotation {
  id           String           @id @default(cuid())
  reportId     String
  content      String           @db.Text
  type         AnnotationType
  status       AnnotationStatus @default(OPEN)
  selectedText String?          @db.Text
  startOffset  Int
  endOffset    Int
  createdById  String
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  resolvedAt   DateTime?
  resolvedById String?

  report       TopicReport      @relation(fields: [reportId], references: [id])
  createdBy    User             @relation(fields: [createdById], references: [id])
  resolvedBy   User?            @relation(fields: [resolvedById], references: [id])
}

enum AnnotationType {
  COMMENT
  SUGGESTION
  ISSUE
  REFERENCE
}

enum AnnotationStatus {
  OPEN
  RESOLVED
  DISMISSED
}
```

### 7.4 服务层设计

**新增服务**

| 服务名                  | 路径                                  | 职责             |
| ----------------------- | ------------------------------------- | ---------------- |
| ReportEditService       | services/report-edit.service.ts       | 报告编辑核心逻辑 |
| ReportChangeService     | services/report-change.service.ts     | 变更检测和管理   |
| ReportAnnotationService | services/report-annotation.service.ts | 批注管理         |
| ReportDiffService       | services/report-diff.service.ts       | 版本对比逻辑     |

---

## 8. 任务拆分

### Epic: 报告编辑功能

#### Story 1: 基础编辑模式 (P0)

| ID    | 任务                              | 类型 | 预估 | 依赖         |
| ----- | --------------------------------- | ---- | ---- | ------------ |
| T-1.1 | 设计 ReportEditPanel 组件结构     | 前端 | 0.5d | -            |
| T-1.2 | 实现编辑模式切换 (预览/编辑/分屏) | 前端 | 1d   | T-1.1        |
| T-1.3 | 实现 Markdown 编辑器组件          | 前端 | 1d   | T-1.2        |
| T-1.4 | 实现内容保存功能                  | 前端 | 0.5d | T-1.3        |
| T-1.5 | 后端 updateReportContent 接口完善 | 后端 | 0.5d | -            |
| T-1.6 | 前后端联调                        | 全栈 | 0.5d | T-1.4, T-1.5 |

#### Story 2: AI 编辑功能 (P0)

| ID    | 任务                       | 类型 | 预估 | 依赖         |
| ----- | -------------------------- | ---- | ---- | ------------ |
| T-2.1 | 实现 AI 浮动工具栏组件     | 前端 | 1d   | T-1.3        |
| T-2.2 | 实现 AI 编辑预览对话框     | 前端 | 0.5d | T-2.1        |
| T-2.3 | 对接 AI 编辑 API           | 前端 | 0.5d | T-2.2        |
| T-2.4 | 优化 aiEditReport 后端实现 | 后端 | 1d   | -            |
| T-2.5 | 前后端联调测试             | 全栈 | 0.5d | T-2.3, T-2.4 |

#### Story 3: 继承式更新标识 (P0)

| ID    | 任务                         | 类型 | 预估 | 依赖         |
| ----- | ---------------------------- | ---- | ---- | ------------ |
| T-3.1 | 实现变更检测算法             | 后端 | 1d   | -            |
| T-3.2 | 设计 ReportChange 数据模型   | 后端 | 0.5d | T-3.1        |
| T-3.3 | 实现变更列表 API             | 后端 | 0.5d | T-3.2        |
| T-3.4 | 实现 ChangeHighlighter 组件  | 前端 | 1d   | -            |
| T-3.5 | 实现 ChangeSummaryPanel 组件 | 前端 | 0.5d | T-3.4        |
| T-3.6 | 实现 Checkin 功能            | 全栈 | 0.5d | T-3.3, T-3.5 |

#### Story 4: 版本管理 (P1)

| ID    | 任务                            | 类型 | 预估 | 依赖         |
| ----- | ------------------------------- | ---- | ---- | ------------ |
| T-4.1 | 实现 ReportRevisionHistory 组件 | 前端 | 1d   | -            |
| T-4.2 | 实现版本回滚功能                | 前端 | 0.5d | T-4.1        |
| T-4.3 | 实现 ReportVersionDiff 组件     | 前端 | 1d   | T-4.1        |
| T-4.4 | 完善 revisions API              | 后端 | 0.5d | -            |
| T-4.5 | 实现 compare API                | 后端 | 1d   | -            |
| T-4.6 | 前后端联调                      | 全栈 | 0.5d | T-4.3, T-4.5 |

#### Story 5: 批注系统 (P1)

| ID    | 任务                           | 类型 | 预估 | 依赖         |
| ----- | ------------------------------ | ---- | ---- | ------------ |
| T-5.1 | 设计 ReportAnnotation 数据模型 | 后端 | 0.5d | -            |
| T-5.2 | 实现批注 CRUD API              | 后端 | 1d   | T-5.1        |
| T-5.3 | 实现 ReportAnnotations 组件    | 前端 | 1d   | -            |
| T-5.4 | 实现批注高亮交互               | 前端 | 0.5d | T-5.3        |
| T-5.5 | 前后端联调                     | 全栈 | 0.5d | T-5.2, T-5.4 |

---

## 9. 排期计划

### 里程碑

| 里程碑 | 日期   | 内容                           |
| ------ | ------ | ------------------------------ |
| M1     | Week 1 | 完成基础编辑模式 + AI 编辑功能 |
| M2     | Week 2 | 完成继承式更新标识             |
| M3     | Week 3 | 完成版本管理 + 批注系统        |
| M4     | Week 4 | 测试、修复、文档、上线         |

### 甘特图

```
Week 1:  ████████████████████████████████
         Story 1 ████████████
         Story 2         ████████████

Week 2:  ████████████████████████████████
         Story 3 ████████████████████████

Week 3:  ████████████████████████████████
         Story 4 ████████████████
         Story 5         ████████████████

Week 4:  ████████████████████████████████
         测试修复 ████████████████
         文档上线         ████████████████
```

---

## 10. 风险和依赖

### 风险

| 风险               | 影响 | 概率 | 缓解措施                   |
| ------------------ | ---- | ---- | -------------------------- |
| AI 编辑质量不稳定  | 中   | 中   | 提供多次重试、用户反馈机制 |
| 变更检测算法准确性 | 高   | 低   | 使用成熟 diff 库，充分测试 |
| 大报告编辑性能问题 | 中   | 中   | 虚拟滚动、分段加载         |
| 版本历史数据量过大 | 低   | 低   | 限制存储版本数量，定期清理 |

### 依赖

| 依赖项              | 状态   | 说明                                 |
| ------------------- | ------ | ------------------------------------ |
| 现有报告 API        | 已完成 | 可复用现有接口                       |
| AI 编辑能力         | 已完成 | 后端已有 report-editing.prompt.ts    |
| Diff 库选型         | 待定   | 建议使用 diff-match-patch 或 jsdiff  |
| Markdown 编辑器选型 | 待定   | 建议使用 CodeMirror 或 Monaco Editor |

---

## 11. 附录

### A. 参考资料

- [AI Writing 编辑功能实现](../frontend/components/ai-writing/ChapterEditPanel.tsx)
- [现有 Topic Research API](../backend/src/modules/ai-app/research/topic-research/)
- [Google Docs 协作编辑设计](https://www.google.com/docs)
- [Notion Block Editor](https://www.notion.so)

### B. 术语表

| 术语       | 定义                                   |
| ---------- | -------------------------------------- |
| Checkin    | 确认变更内容为正式内容的操作           |
| 继承式更新 | 新一次洞察基于上一次内容，标识变更部分 |
| 修订版本   | 报告的历史快照，包含完整内容           |
| 批注       | 对报告特定内容的评论、建议或问题标记   |
| Diff       | 两个版本之间的差异对比                 |

### C. 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2026-01-13 | 初始版本 | PM Agent |

---

**文档结束**

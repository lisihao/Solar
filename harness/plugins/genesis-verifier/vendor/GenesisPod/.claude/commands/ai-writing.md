# AI Writing

AI 写作模块开发专家。

**任务**: $ARGUMENTS

## 模块概述

AI Writing 是 GenesisPod 的智能写作功能，支持：

1. **长文写作** - 小说、论文、报告
2. **大纲生成** - 结构化写作规划
3. **续写扩展** - 基于上下文续写
4. **风格控制** - 文风、语气、视角

## 架构

```
Frontend                          Backend
┌──────────────────┐             ┌─────────────────────┐
│ WritingEditor    │◄───────────►│ WritingMission      │
│ OutlinePanel     │   Stream    │ WritingTask         │
│ WorldSettings    │◄───────────►│ ChapterGenerator    │
└──────────────────┘             └─────────────────────┘
```

## 关键文件

```
frontend/app/ai-writing/
├── page.tsx                    # 主页面
├── components/
│   ├── WritingEditor.tsx       # 编辑器
│   ├── OutlinePanel.tsx        # 大纲面板
│   └── WorldSettingsModal.tsx  # 世界设定

backend/src/modules/ai/ai-writing/
├── ai-writing.service.ts       # 主服务
├── writing-mission.service.ts  # Mission 管理
├── chapter-generator.service.ts # 章节生成
└── dto/
```

## 数据模型

```typescript
interface WritingMission {
  id: string;
  title: string;
  outline: OutlineNode[]; // 大纲结构
  worldSettings: WorldSettings; // 世界设定
  chapters: Chapter[]; // 已生成章节
  status: MissionStatus;
}

interface OutlineNode {
  id: string;
  title: string;
  summary: string;
  children?: OutlineNode[];
  generatedContent?: string;
}

interface WorldSettings {
  genre: string; // 类型
  tone: string; // 基调
  perspective: string; // 视角
  characters: Character[]; // 角色
  settings: Setting[]; // 场景
}
```

## 生成流程

```
1. 用户输入主题/大纲
2. AI 生成/优化大纲结构
3. 用户确认大纲
4. AI 按章节顺序生成内容
5. 流式输出到编辑器
6. 用户可随时修改/续写
```

## 关键功能

### 大纲生成

- 根据主题生成结构化大纲
- 支持多级嵌套
- 可手动调整节点

### 章节生成

- 基于大纲和世界设定
- 保持上下文一致性
- 流式输出支持

### 世界设定

- 角色库管理
- 场景设定
- 风格参数

## 我会帮助你

- 实现写作功能
- 优化大纲算法
- 改进内容质量
- 处理流式输出
- 维护上下文一致性

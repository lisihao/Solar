# EnhancedDependencyService 使用指南

## 概述

`EnhancedDependencyService` 是一个强大的依赖分析服务，用于分析章节间的依赖关系、检测循环依赖、生成最优执行计划。

## 核心功能

### 1. 循环依赖检测

使用 DFS 算法检测章节间的循环依赖：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: ["ch2"],
    estimatedTime: 1800, // 30分钟
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: ["ch1"], // 循环依赖
    estimatedTime: 1800,
  },
];

const circularDeps =
  enhancedDependencyService.detectCircularDependencies(chapters);
// [{ path: ['ch1', 'ch2', 'ch1'], type: 'CIRCULAR' }]
```

### 2. 拓扑排序

按依赖关系排序章节：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch3",
    title: "第三章",
    orderIndex: 3,
    dependencies: ["ch1", "ch2"],
    estimatedTime: 2400,
  },
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: [],
    estimatedTime: 1800,
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: ["ch1"],
    estimatedTime: 2000,
  },
];

const sorted = enhancedDependencyService.topologicalSort(chapters);
// ['ch1', 'ch2', 'ch3']
```

### 3. 关键路径分析

找出影响总时间的关键路径：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: [],
    estimatedTime: 1000,
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: ["ch1"],
    estimatedTime: 2000,
  },
  {
    id: "ch3",
    title: "第三章",
    orderIndex: 3,
    dependencies: ["ch2"],
    estimatedTime: 1500,
  },
  {
    id: "ch4",
    title: "第四章",
    orderIndex: 4,
    dependencies: ["ch1"],
    estimatedTime: 800,
  },
];

const criticalPath = enhancedDependencyService.findCriticalPath(chapters);
// ['ch1', 'ch2', 'ch3'] - 总时间 4500s，最长路径
```

### 4. 生成最优执行计划

根据依赖关系生成并行执行计划：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: [],
    estimatedTime: 1800,
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: [],
    estimatedTime: 1800,
  },
  {
    id: "ch3",
    title: "第三章",
    orderIndex: 3,
    dependencies: ["ch1", "ch2"],
    estimatedTime: 2400,
  },
];

const plan = enhancedDependencyService.generateOptimalPlan(chapters, 2);

console.log(plan);
// {
//   rounds: [
//     { roundNumber: 1, chapters: ['ch1', 'ch2'], estimatedTime: 1800 },
//     { roundNumber: 2, chapters: ['ch3'], estimatedTime: 2400 }
//   ],
//   totalRounds: 2,
//   criticalPath: ['ch1', 'ch3'],
//   parallelizationRate: 1.5,  // 3章节 / 2轮次
//   estimatedTotalTime: 4200   // 1800 + 2400
// }
```

### 5. 依赖关系验证

全面验证依赖关系的有效性：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: ["ch999"],
    estimatedTime: 1800,
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: ["ch1"],
    estimatedTime: 2000,
  },
];

const validation = enhancedDependencyService.validateDependencies(chapters);

console.log(validation);
// {
//   isValid: false,
//   circularDependencies: [],
//   invalidReferences: [
//     'Chapter "第一章" (ch1) references non-existent chapter ch999'
//   ],
//   warnings: []
// }
```

### 6. 自动推断依赖

基于章节顺序自动推断依赖关系：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: [],
    estimatedTime: 1800,
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: [],
    estimatedTime: 2000,
  },
  {
    id: "ch3",
    title: "第三章",
    orderIndex: 3,
    dependencies: [],
    estimatedTime: 2200,
  },
];

// 顺序依赖：每章依赖前一章
const deps1 = enhancedDependencyService.inferDependencies(chapters, {
  sequentialDependency: true,
});
// Map { 'ch1' => [], 'ch2' => ['ch1'], 'ch3' => ['ch2'] }

// 跳过序言
const deps2 = enhancedDependencyService.inferDependencies(chapters, {
  sequentialDependency: true,
  skipIntroduction: true,
});

// 分组依赖（每2章一组）
const deps3 = enhancedDependencyService.inferDependencies(chapters, {
  groupSize: 2,
});
```

### 7. 可视化导出（Mermaid）

导出为 Mermaid 图表格式：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: [],
    estimatedTime: 1800,
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: ["ch1"],
    estimatedTime: 2000,
  },
];

const mermaid = enhancedDependencyService.exportToMermaid(chapters);

console.log(mermaid);
// graph TD
//   ch1["第一章 (1800s)"]
//   ch2["第二章 (2000s)"]
//   ch1 --> ch2
```

将输出粘贴到 Mermaid 编辑器即可查看可视化图表。

### 8. 深度计算

计算每个章节从根节点开始的深度：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: [],
    estimatedTime: 1800,
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: ["ch1"],
    estimatedTime: 2000,
  },
  {
    id: "ch3",
    title: "第三章",
    orderIndex: 3,
    dependencies: ["ch2"],
    estimatedTime: 2200,
  },
];

const depth = enhancedDependencyService.calculateDepth(chapters);
// Map { 'ch1' => 0, 'ch2' => 1, 'ch3' => 2 }
```

### 9. 获取就绪章节

动态获取所有依赖已完成的章节：

```typescript
const chapters: ChapterNode[] = [
  {
    id: "ch1",
    title: "第一章",
    orderIndex: 1,
    dependencies: [],
    estimatedTime: 1800,
  },
  {
    id: "ch2",
    title: "第二章",
    orderIndex: 2,
    dependencies: ["ch1"],
    estimatedTime: 2000,
  },
  {
    id: "ch3",
    title: "第三章",
    orderIndex: 3,
    dependencies: ["ch1"],
    estimatedTime: 2200,
  },
  {
    id: "ch4",
    title: "第四章",
    orderIndex: 4,
    dependencies: ["ch2", "ch3"],
    estimatedTime: 2400,
  },
];

// 初始状态
const ready1 = enhancedDependencyService.getReadyChapters(chapters, new Set());
// ['ch1']

// ch1 完成后
const ready2 = enhancedDependencyService.getReadyChapters(
  chapters,
  new Set(["ch1"]),
);
// ['ch2', 'ch3']

// ch1, ch2, ch3 都完成后
const ready3 = enhancedDependencyService.getReadyChapters(
  chapters,
  new Set(["ch1", "ch2", "ch3"]),
);
// ['ch4']
```

## 实际应用场景

### 场景 1: 并行写作调度

```typescript
// 1. 验证依赖关系
const validation = enhancedDependencyService.validateDependencies(chapters);
if (!validation.isValid) {
  throw new Error(`依赖关系无效: ${validation.invalidReferences.join(", ")}`);
}

// 2. 生成执行计划
const maxParallelWriters = 3;
const plan = enhancedDependencyService.generateOptimalPlan(
  chapters,
  maxParallelWriters,
);

// 3. 按轮次执行
for (const round of plan.rounds) {
  console.log(`第 ${round.roundNumber} 轮 (预计 ${round.estimatedTime}s):`);
  console.log(`  可并行写作: ${round.chapters.join(", ")}`);

  // 并行调度 Writer Agent
  await Promise.all(
    round.chapters.map((chapterId) => writerPool.executeChapter(chapterId)),
  );
}

console.log(`关键路径: ${plan.criticalPath.join(" → ")}`);
console.log(`并行化率: ${plan.parallelizationRate.toFixed(2)}`);
console.log(`总预估时间: ${plan.estimatedTotalTime}s`);
```

### 场景 2: 动态依赖跟踪

```typescript
const completed = new Set<string>();
const failed = new Set<string>();

while (completed.size + failed.size < chapters.length) {
  // 获取当前可执行的章节
  const ready = enhancedDependencyService.getReadyChapters(chapters, completed);

  if (ready.length === 0) {
    console.log("所有可执行章节已完成或失败");
    break;
  }

  // 并行执行就绪的章节
  const results = await Promise.allSettled(
    ready.map((chapterId) => executeChapter(chapterId)),
  );

  // 更新完成/失败集合
  results.forEach((result, index) => {
    const chapterId = ready[index];
    if (result.status === "fulfilled") {
      completed.add(chapterId);
    } else {
      failed.add(chapterId);
    }
  });
}
```

### 场景 3: 依赖可视化

```typescript
// 生成 Mermaid 图表
const mermaid = enhancedDependencyService.exportToMermaid(chapters);

// 保存到文件或返回给前端
await fs.writeFile("chapter-dependencies.mmd", mermaid);

// 或者在前端使用 mermaid.js 渲染
return {
  mermaidCode: mermaid,
  criticalPath: enhancedDependencyService.findCriticalPath(chapters),
};
```

## 类型定义

```typescript
interface ChapterNode {
  id: string;
  title: string;
  orderIndex: number;
  dependencies: string[];
  estimatedTime: number; // 秒
}

interface CircularDependency {
  path: string[];
  type: "CIRCULAR" | "SELF_REFERENCE";
}

interface ExecutionRound {
  roundNumber: number;
  chapters: string[];
  estimatedTime: number;
}

interface ExecutionPlan {
  rounds: ExecutionRound[];
  totalRounds: number;
  criticalPath: string[];
  parallelizationRate: number;
  estimatedTotalTime: number;
}

interface DependencyValidationResult {
  isValid: boolean;
  circularDependencies: CircularDependency[];
  invalidReferences: string[];
  warnings: string[];
}
```

## 性能考虑

- **拓扑排序**: O(V + E) - 节点数 + 边数
- **循环检测**: O(V + E) - DFS 遍历
- **关键路径**: O(V + E) - 动态规划
- **执行计划**: O(V \* log V) - 排序 + 分组

对于常见规模（几十到几百章节），性能完全足够。

## 注意事项

1. **循环依赖**: 必须在生成执行计划前检测并修复
2. **时间估算**: `estimatedTime` 应尽可能准确，影响关键路径分析
3. **并行度**: `maxParallel` 应根据实际资源（API限制、Writer数量）设置
4. **依赖更新**: 章节依赖变化时需重新验证和生成计划

## 集成示例

在 `ParallelOrchestratorService` 中使用：

```typescript
@Injectable()
export class ParallelOrchestratorService {
  constructor(
    private readonly enhancedDependency: EnhancedDependencyService,
    private readonly writerPool: WriterPoolService,
  ) {}

  async executeParallelWriting(volumeId: string, maxParallel: number) {
    // 1. 获取章节
    const chapters = await this.getChapters(volumeId);

    // 2. 转换为 ChapterNode
    const nodes: ChapterNode[] = chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      orderIndex: ch.chapterNumber,
      dependencies: ch.dependsOn || [],
      estimatedTime: this.estimateWritingTime(ch),
    }));

    // 3. 验证依赖
    const validation = this.enhancedDependency.validateDependencies(nodes);
    if (!validation.isValid) {
      throw new Error(`依赖关系无效`);
    }

    // 4. 生成计划
    const plan = this.enhancedDependency.generateOptimalPlan(
      nodes,
      maxParallel,
    );

    // 5. 执行
    for (const round of plan.rounds) {
      await this.writerPool.executeRound(round.chapters);
    }

    return {
      totalRounds: plan.totalRounds,
      totalTime: plan.estimatedTotalTime,
      parallelizationRate: plan.parallelizationRate,
    };
  }
}
```

## 总结

`EnhancedDependencyService` 提供了一套完整的依赖分析工具，适用于：

- ✅ 章节并行写作调度
- ✅ 任务依赖管理
- ✅ 关键路径分析
- ✅ 依赖可视化
- ✅ 动态执行追踪

通过合理使用这些工具，可以显著提高写作效率和资源利用率。

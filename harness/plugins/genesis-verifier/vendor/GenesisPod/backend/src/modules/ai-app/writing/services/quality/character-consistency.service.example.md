# CharacterConsistencyService 使用示例

> 角色一致性服务 - 追踪角色状态、检测 OOC 行为、生成行为约束

---

## 核心功能

### 1. 角色状态追踪

追踪角色的物理、情感、关系、知识状态，并维护时间线。

```typescript
// 获取角色当前状态
const characterState =
  await characterConsistency.getCharacterState(characterId);

console.log(characterState);
// {
//   characterId: "char-001",
//   name: "苏清婉",
//   physicalState: {
//     health: "healthy",
//     location: "长秋宫",
//     injuries: []
//   },
//   emotionalState: {
//     mood: "警惕",
//     moodHistory: [
//       { chapterNumber: 4, mood: "紧张", trigger: "铅粉事件" }
//     ]
//   },
//   relationships: {
//     "李贵人": {
//       characterName: "李贵人",
//       relationType: "enemy",
//       trustLevel: 10,
//       affinity: -50
//     }
//   },
//   knownSecrets: ["皇后背后有人支持"],
//   hiddenSecrets: ["她的真实身份"],
//   goals: [
//     {
//       description: "在宫中生存下去",
//       priority: "primary",
//       status: "active"
//     }
//   ]
// }
```

### 2. 更新角色状态（章节写完后）

```typescript
// 第 5 章写完后更新状态
await characterConsistency.updateCharacterState(
  characterId,
  5, // 章节号
  {
    physicalState: {
      health: "healthy",
      location: "御花园",
    },
    emotionalState: {
      mood: "放松",
    },
    relationships: {
      太子: {
        characterName: "太子",
        relationType: "neutral",
        trustLevel: 50,
        affinity: 30,
        lastInteraction: {
          chapterNumber: 5,
          summary: "在御花园偶遇，有短暂对话",
          outcome: "positive",
        },
      },
    },
    knownSecrets: [...existingSecrets, "太子对皇后有戒心"],
  },
);
```

### 3. OOC 检测

检测角色行为是否违背性格设定。

```typescript
// 检测提议的行为是否 OOC
const oocResult = await characterConsistency.detectOOC(
  character, // WritingCharacterEntity
  "苏清婉冲上去与李贵人大打出手", // 提议的行为
  "李贵人言语羞辱苏清婉", // 上下文
);

if (oocResult.isOOC) {
  console.log(`OOC 警告: ${oocResult.reason}`);
  console.log(`建议: ${oocResult.suggestion}`);
  // OOC 警告: 苏清婉是谨慎型性格，不会做出如此冲动的决定
  // 建议: 让苏清婉先观察、思考，再做决定
}
```

**检测类型：**

- `personality_conflict`: 性格冲突（善良角色做残忍事）
- `impulsive_decision`: 冲动决策（谨慎角色突然冲动）
- `relationship_violation`: 关系违反（对敌人太友好）
- `unmotivated_change`: 无动机变化

### 4. 角色成长验证

验证角色性格/信念变化是否合理。

```typescript
// 验证角色成长
const growthResult = await characterConsistency.validateCharacterGrowth(
  characterId,
  {
    traitChange: "从胆小变为勇敢",
    beliefChange: "开始相信爱情",
  },
  "亲眼目睹太子为救她受伤", // 触发事件
);

if (!growthResult.isValid) {
  growthResult.issues.forEach((issue) => {
    console.log(`问题: ${issue.description}`);
    console.log(`建议: ${issue.suggestion}`);
  });
}
```

### 5. 生成行为约束（供 Writer Agent 使用）

为每个角色生成行为约束提示词。

```typescript
// 生成行为约束
const constraints =
  await characterConsistency.generateCharacterBehaviorConstraints(character, {
    chapterNumber: 5,
    involvedCharacters: ["太子", "李贵人"],
  });

// 转换为提示词
const promptFragment =
  characterConsistency.formatBehaviorConstraintsAsPrompt(constraints);

console.log(promptFragment);
```

**生成的提示词示例：**

```markdown
## 角色行为约束：苏清婉

### 核心性格特征

- 聪慧、隐忍、善于观察

### 性格决定的行为模式

- 危险面前会先评估再行动
- 不会轻易信任他人
- 会通过观察和推理获取信息
- 决策前会权衡利弊

### 当前状态约束

- 当前位置：御花园
- 当前情绪：放松

### 人际关系约束

- 对 李贵人 保持警惕和敌意
- 对 李贵人 信任度很低，保持防备
- 对 太子 保持信任和合作

### 行为禁止

- ❌ 不会主动攻击无辜者
- ❌ 不会向不信任的人吐露心声
- ❌ 不会做出冲动决定
- ❌ 不会在不了解情况时贸然行动

### 行为鼓励

- ✅ 通过观察收集信息
- ✅ 用策略达成目的
- ✅ 保持表面的温顺恭敬
- ✅ 用委婉方式表达意见
```

---

## 在 Writer Agent 中集成

### 在 `buildQualityConstraints` 方法中

```typescript
// writer.agent.ts

private async buildQualityConstraints(
  contextPackage: WritingContextPackage,
  chapterContext: ChapterWritingContext,
): Promise<string> {
  const parts: string[] = [];
  const projectId = contextPackage.extensions.storyBible.projectId;

  // 1. 角色行为约束（使用 CharacterConsistencyService）
  if (chapterContext.involvedCharacters.length > 0) {
    parts.push("# 角色行为约束\n");

    for (const character of chapterContext.involvedCharacters) {
      const constraints = await this.characterConsistency.generateCharacterBehaviorConstraints(
        character,
        {
          chapterNumber: chapterContext.chapter.chapterNumber,
          involvedCharacters: chapterContext.involvedCharacters.map(c => c.name),
        },
      );

      const prompt = this.characterConsistency.formatBehaviorConstraintsAsPrompt(constraints);
      parts.push(prompt);
    }

    parts.push("");
  }

  // 2. 其他质量约束...
  // - 角色人格约束（CharacterPersonalityService - 语言风格）
  // - 表达记忆（ExpressionMemoryService - 避免重复）
  // - 历史知识约束（HistoricalKnowledgeService）
  // ...

  return parts.join("\n");
}
```

### 章节写完后更新状态

```typescript
// writing-mission.service.ts 或 chapter-writing.service.ts

async function onChapterCompleted(
  chapterId: string,
  chapterNumber: number,
  content: string,
  involvedCharacterIds: string[],
) {
  // 1. 从章节内容中提取状态变化（可用 LLM 辅助）
  const stateUpdates = await extractCharacterStateUpdates(content);

  // 2. 更新每个角色的状态
  for (const characterId of involvedCharacterIds) {
    const updates = stateUpdates[characterId];
    if (updates) {
      await characterConsistency.updateCharacterState(
        characterId,
        chapterNumber,
        updates,
      );
    }
  }

  // 3. 如果有重大状态转变，记录转变
  const transitions = await detectStateTransitions(content);
  for (const transition of transitions) {
    await characterConsistency.recordStateTransition(transition.characterId, {
      fromState: transition.fromState,
      toState: transition.toState,
      transitionType: transition.type,
      chapterNumber,
      justification: transition.reason,
      isExplicitInText: true,
    });
  }
}
```

---

## 与其他服务的协作

### CharacterPersonalityService (语言风格)

- `CharacterPersonalityService`: 管理角色的**语言风格**（说话方式、常用词汇）
- `CharacterConsistencyService`: 管理角色的**状态和行为**（物理状态、情绪、关系）

两者协作：

```typescript
// 生成完整的角色约束
const personalityConstraints =
  await characterPersonality.generatePersonalityConstraintPrompt([characterId]);
const behaviorConstraints =
  await characterConsistency.generateCharacterBehaviorConstraints(
    character,
    chapterContext,
  );

const fullConstraints = `
${personalityConstraints}

${characterConsistency.formatBehaviorConstraintsAsPrompt(behaviorConstraints)}
`;
```

### StoryBible (数据源)

`CharacterConsistencyService` 从 `WritingCharacter` 表读写数据：

- `currentState` (JSON): 当前状态
- `stateTimeline` (JSON[]): 状态时间线
- `personality` (JSON): 性格设定（用于 OOC 检测）

---

## 数据库结构

角色状态存储在 `WritingCharacter` 表的 JSON 字段中：

```prisma
model WritingCharacter {
  id            String @id @default(uuid())
  name          String
  personality   Json   @default("{}") // { traits: [], strengths: [], weaknesses: [] }
  currentState  Json   @default("{}") // CharacterState 结构
  stateTimeline Json[] @default([])   // CharacterStateSnapshot[]
  // ...
}
```

**currentState 示例：**

```json
{
  "physicalState": {
    "health": "healthy",
    "location": "长秋宫",
    "injuries": []
  },
  "emotionalState": {
    "mood": "警惕",
    "moodHistory": [{ "chapterNumber": 4, "mood": "紧张" }]
  },
  "relationships": {
    "李贵人": {
      "characterName": "李贵人",
      "relationType": "enemy",
      "trustLevel": 10,
      "affinity": -50
    }
  },
  "knownSecrets": ["皇后背后有人支持"],
  "goals": [
    {
      "description": "在宫中生存下去",
      "priority": "primary",
      "status": "active"
    }
  ]
}
```

---

## 最佳实践

### 1. 状态更新频率

- **每章写完后必须更新**：物理位置、情绪、关系变化
- **重大事件发生时记录转变**：身份揭露、立场改变、死亡等

### 2. OOC 检测时机

- **大纲生成时**：检测大纲中的角色行为是否 OOC
- **内容生成前**：在 Writer Agent 提示词中加入约束
- **内容生成后**：在 Editor Agent 中检测并修正

### 3. 状态追踪粒度

- **必须追踪**：物理位置、健康状态、核心关系
- **选择性追踪**：情绪细节、次要关系
- **避免过度追踪**：每个细节都记录会导致数据冗余

### 4. 与 Story Bible 的一致性

- 角色的**静态属性**（外貌、性格特征）在 Story Bible 中维护
- 角色的**动态状态**（位置、情绪、关系）在 CharacterState 中维护
- 定期同步确保一致

---

## 未来增强

### 自动状态提取

使用 LLM 从章节内容中自动提取状态变化：

```typescript
async function autoExtractStateUpdates(
  chapterId: string,
  content: string,
  involvedCharacters: WritingCharacterEntity[],
): Promise<Record<string, Partial<CharacterState>>> {
  const prompt = `
请从以下章节内容中提取角色状态变化：

${content}

涉及角色：${involvedCharacters.map((c) => c.name).join("、")}

输出格式（JSON）：
{
  "角色名": {
    "physicalState": { "location": "新位置", "health": "状态" },
    "emotionalState": { "mood": "情绪" },
    "relationships": { "另一角色": { "relationType": "类型", "trustLevel": 50 } }
  }
}
  `;

  const response = await aiChatService.chat({
    messages: [{ role: "user", content: prompt }],
    modelType: AIModelType.CHAT,
    taskProfile: { creativity: "deterministic", outputLength: "short" },
    responseFormat: { type: "json_object" },
  });

  return JSON.parse(response.content);
}
```

### 关系网络图

可视化角色关系网络，追踪关系随时间的变化。

### 预测 OOC

在大纲阶段就预测可能的 OOC 问题，提前调整剧情。

---

## 总结

`CharacterConsistencyService` 提供：

1. ✅ **状态追踪**：物理、情感、关系、知识
2. ✅ **OOC 检测**：防止角色行为违背性格
3. ✅ **成长验证**：确保角色变化有铺垫
4. ✅ **行为约束生成**：为 Writer Agent 提供约束提示词
5. ✅ **时间线管理**：追踪角色状态随时间的变化

与 `CharacterPersonalityService` 协作，共同确保角色的**语言一致性**和**行为一致性**。

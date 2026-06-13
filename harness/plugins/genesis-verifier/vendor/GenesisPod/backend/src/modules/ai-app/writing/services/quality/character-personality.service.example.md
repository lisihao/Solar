# CharacterPersonalityService 使用示例

## 概述

`CharacterPersonalityService` 提供完整的角色性格约束服务，用于确保 AI 生成的对话符合角色设定。

## 核心功能

### 1. 通过角色名查询角色信息

支持主名和别名匹配：

```typescript
const character = await characterPersonalityService.getCharacterByName(
  projectId,
  "林黛玉",
);

console.log(character.name); // "林黛玉"
console.log(character.aliases); // ["林妹妹", "潇湘妃子"]
```

### 2. 获取角色性格约束

批量获取多个角色的性格约束信息：

```typescript
const constraints = await characterPersonalityService.getPersonalityConstraints(
  projectId,
  ["林黛玉", "贾宝玉"],
);

// 返回结构化约束
console.log(constraints[0]);
// {
//   characterId: "uuid",
//   characterName: "林黛玉",
//   speechPatterns: ["岂能", "想来", "倒也"],
//   vocabularyLevel: "formal",
//   emotionalTendency: ["内敛含蓄，少有外露"],
//   tabooWords: ["哎呀", "天哪", "我去"],
//   catchphrases: ["岂能", "想来", "倒也", "不妨", "确实"],
//   dialogueExamples: []
// }
```

### 3. 生成角色约束提示词

将约束转换为易于 LLM 理解的提示词：

```typescript
const constraints = await characterPersonalityService.getPersonalityConstraints(
  projectId,
  ["林黛玉", "贾宝玉"],
);

const prompt =
  characterPersonalityService.generateConstraintPrompt(constraints);

console.log(prompt);
// ## 角色人格约束
//
// ### 林黛玉
// **常用表达**: 岂能、想来、倒也、不妨、确实
// **用词风格**: 正式、文雅
// **情绪倾向**: 内敛含蓄，少有外露
// **禁用词汇**: ❌ 哎呀、天哪、我去、卧槽、靠
// **口头禅**: 岂能、想来、倒也、不妨、确实
//
// ### 贾宝玉
// ...
```

### 4. 验证对话是否符合角色性格

自动检测对话中的性格不一致问题：

```typescript
const result = await characterPersonalityService.validateDialogue(projectId, [
  { characterName: "林黛玉", dialogue: "哎呀，这可怎么办啊！" },
  { characterName: "贾宝玉", dialogue: "妹妹不必担心，我来处理。" },
]);

console.log(result.isValid); // false

console.log(result.issues);
// [
//   {
//     characterName: "林黛玉",
//     dialogue: "哎呀，这可怎么办啊！",
//     issue: "使用了禁用词汇 \"哎呀\"",
//     suggestion: "林黛玉 不会使用 \"哎呀\"，请替换为更符合其性格的表达"
//   }
// ]
```

### 5. 添加对话样本

从优质对话中学习角色特征：

```typescript
await characterPersonalityService.addDialogueSample(
  projectId,
  "林黛玉",
  "想来此事倒也不难，只是需要细细斟酌。",
  "第五章：宝玉请黛玉出谋划策",
);

// 系统会自动提取高频短语并更新角色的 commonPhrases
```

### 6. 获取对话示例

查看角色的历史对话样本：

```typescript
const examples = await characterPersonalityService.getDialogueExamples(
  characterId,
  10, // 限制返回数量
);

console.log(examples);
// [
//   {
//     id: "uuid-0",
//     characterId: "uuid",
//     dialogue: "想来",
//     context: "历史对话样本",
//     chapterId: undefined
//   },
//   ...
// ]
```

## 在 Writer Agent 中的应用

`writer.agent.ts` 已经集成了角色性格约束：

```typescript
// 在 buildQualityConstraints 方法中
const characterNames = chapterContext.involvedCharacters.map((c) => c.name);

if (characterNames.length > 0) {
  const constraints = await this.characterPersonality.getPersonalityConstraints(
    projectId,
    characterNames,
  );

  if (constraints.length > 0) {
    const constraintPrompt =
      this.characterPersonality.generateConstraintPrompt(constraints);
    if (constraintPrompt) {
      parts.push(constraintPrompt);
    }
  }
}
```

这样生成的提示词会自动包含角色性格约束，确保 LLM 生成的对话符合角色设定。

## 预设人格模板

服务内置了常见角色类型的预设模板：

- `noble_lady` - 大家闺秀（正式、含蓄、书卷气）
- `maid_servant` - 丫鬟（活泼、直接、口语化）
- `scheming_villain` - 反派（圆滑、暗藏机锋）
- `righteous_hero` - 正派主角（直率、正气）
- `wise_elder` - 长者（温和、睿智）

使用方法：

```typescript
await characterPersonalityService.initializeFromTemplate(
  characterId,
  "noble_lady",
);
```

## 性格一致性检测

服务还提供了内容级别的性格一致性检测：

```typescript
const result = await characterPersonalityService.checkPersonalityConsistency(
  projectId,
  chapterContent,
);

console.log(result.score); // 0.0 - 1.0
console.log(result.violations);
// [
//   {
//     type: "forbidden_phrase",
//     description: "角色 林黛玉 使用了禁用词汇 \"哎呀\"",
//     location: "哎呀，这可怎么办...",
//     suggestion: "林黛玉 不会说 \"哎呀\"，请使用更符合其人格的表达"
//   }
// ]
```

## 注意事项

1. **角色必须先存在**: 调用 `getCharacterByName` 前，确保角色已在 Story Bible 中创建
2. **性格档案可选**: 如果角色没有设置人格档案，会返回默认值
3. **对话样本**: 目前对话样本存储在 `commonPhrases` 中，未来可扩展为独立表
4. **验证粒度**: 验证功能基于简单的规则匹配，未来可集成 LLM 进行更深度的检测

## 完整工作流示例

```typescript
// 1. 创建角色并设置人格
const character = await characterService.create(projectId, {
  name: "林黛玉",
  aliases: ["林妹妹", "潇湘妃子"],
  role: "PROTAGONIST",
});

// 2. 从模板初始化人格
await characterPersonalityService.initializeFromTemplate(
  character.id,
  "noble_lady",
);

// 3. 在写作时获取约束
const constraints = await characterPersonalityService.getPersonalityConstraints(
  projectId,
  ["林黛玉"],
);

const prompt =
  characterPersonalityService.generateConstraintPrompt(constraints);

// 4. 将约束提示词传递给 LLM
const systemPrompt = `${basePrompt}\n\n${prompt}`;

// 5. 验证生成的内容
const validationResult = await characterPersonalityService.validateDialogue(
  projectId,
  extractedDialogues,
);

if (!validationResult.isValid) {
  console.log("检测到性格不一致，需要修正：", validationResult.issues);
}

// 6. 从优质内容中学习
await characterPersonalityService.addDialogueSample(
  projectId,
  "林黛玉",
  approvedDialogue,
  context,
);
```

## 未来扩展

- [ ] 支持独立的 DialogueExample 表
- [ ] 集成 LLM 进行更深度的对话验证
- [ ] 从历史章节自动提取对话样本
- [ ] 支持角色性格随剧情发展的动态变化
- [ ] 提供角色对话风格的统计分析

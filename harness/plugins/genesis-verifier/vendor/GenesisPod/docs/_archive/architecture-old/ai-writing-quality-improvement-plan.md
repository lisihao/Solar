# AI Writing System - 系统性质量提升方案

> 基于 汉宫妆影对比分析 + 起点头部作品学习 + 晋江文学城类型研究

---

## 一、核心质量差距诊断

### 1.1 对比分析结果（汉宫妆影 vs 当前系统输出）

| 维度         | 当前系统         | 优秀作品          | 差距等级 |
| ------------ | ---------------- | ----------------- | -------- |
| **开篇钩子** | 抽象背景描述     | 感官冲击/冲突对话 | 严重     |
| **专业知识** | 直接说明"她是XX" | 思维方式自然流露  | 严重     |
| **五感描写** | 视觉为主         | 五感立体沉浸      | 中等     |
| **人物声音** | 统一叙事腔调     | 职业特征思维      | 中等     |
| **伏笔铺设** | 线性叙事         | 多线交织回收      | 中等     |
| **节奏控制** | 均匀推进         | 张弛有度          | 中等     |

### 1.2 从头部作品学到的技巧

**起点男频技巧：**

- 《斗破苍穹》: 冲突对话开篇（"斗之力，三段！"）、落魄天才反转
- 《高门庶子》: 身份反差、生存危机、幽默自嘲
- 《捞尸人》: 冷门题材切入、氛围渲染、恐怖与温情交织
- 《诡秘之主》: 200章伏笔一章回收、节奏控制大师

**晋江女频特点：**

- 言情/纯爱: 情感细腻、关系驱动
- 宫斗权谋: 话中藏刀、微表情叙事、势力博弈
- 角色塑造: 内心戏丰富、成长弧线清晰

---

## 二、现有系统架构分析

### 2.1 Writer Agent 架构（writer.agent.ts）

```
6层Prompt层级结构：
├── Level 1: 基础写作原则
├── Level 2: 风格参数 (styleParams)
├── Level 3: 风格预设 (stylePresets)
├── Level 4: 写作技巧 (techniques)
├── Level 5: 质量约束 (qualityConstraints)
└── Level 6: 章节上下文 (chapterContext)
```

### 2.2 质量控制服务（12个）

| 服务                    | 功能       | 状态   |
| ----------------------- | ---------- | ------ |
| character-consistency   | 角色一致性 | 存在   |
| plot-logic              | 情节逻辑   | 存在   |
| style-consistency       | 风格一致性 | 存在   |
| semantic-consistency    | 语义一致性 | 存在   |
| expression-alternatives | 表达替换   | 存在   |
| **professional-voice**  | 专业声音   | 已创建 |
| **sensory-immersion**   | 五感沉浸   | 已创建 |
| **opening-hook**        | 开篇钩子   | 已创建 |

### 2.3 风格预设（8个）

- jin_yong, gu_long, liang_yusheng (武侠三大家)
- web_xuanhuan, web_gongdou (网文风格)
- western_fantasy, mystery_suspense, modern_realistic

---

## 三、系统性改进方案

### Phase 1: 完成新服务集成（优先级：高）

**目标：将已创建的3个服务集成到Writer Agent**

#### 1.1 注册服务到 WritingModule

```typescript
// writing.module.ts
providers: [
  // 新增
  ProfessionalVoiceService,
  SensoryImmersionService,
  OpeningHookService,
];
```

#### 1.2 增强 WriterAgent.buildQualityConstraints()

```typescript
// 在 buildQualityConstraints 方法中集成:
// 1. 调用 openingHookService.generateOpeningConstraints()
// 2. 调用 sensoryImmersionService.generateImmersionConstraints()
// 3. 调用 professionalVoiceService.generateProfessionalVoicePrompt()
```

**关键文件：**

- `backend/src/modules/ai-app/writing/writing.module.ts`
- `backend/src/modules/ai-engine/agents/implementations/writer/writer.agent.ts`

---

### Phase 2: 开篇钩子强化（优先级：高）

**问题：** 当前开篇偏抽象，缺乏感官冲击

**解决方案：**

1. **章节类型识别**
   - first_chapter: 强制使用高冲击力钩子
   - climax: 冲突对话/危机情境
   - revelation: 悬念揭示
   - transition: 感官过渡

2. **5种钩子模板**（已在 opening-hook.service.ts 实现）
   - conflict_dialogue: "斗之力，三段！" 式冲突对话
   - crisis_situation: 生死危机开场
   - mystery_question: 悬念提问
   - sensory_immersion: 五感冲击
   - contrast_reveal: 身份反差

3. **开篇质量评分**
   - 自动评估生成的开篇（0-100分）
   - 低于70分触发重写

---

### Phase 3: 专业声音系统（优先级：高）

**问题：** 角色职业只是标签，未转化为思维方式

**解决方案：**（已在 professional-voice.service.ts 实现）

1. **职业思维映射**

   ```
   化妆品配方工程师 → 看到植物想到活性成分
   医者 → 望闻问切的观察习惯
   将军 → 地形/兵力/后勤的评估
   谋士 → 利益关系/人心揣摩
   ```

2. **Show Don't Tell 原则**
   - 不说"她是配方工程师"
   - 而是让她在看到花朵时自然想到"皂苷含量"

3. **专业知识注入点**
   - 日常观察描写
   - 解决问题时的思路
   - 与他人对话时的专业视角

---

### Phase 4: 五感沉浸增强（优先级：中）

**问题：** 描写以视觉为主，缺乏立体感

**解决方案：**（已在 sensory-immersion.service.ts 实现）

1. **场景类型模板**

   ```
   cold_dark (阴冷场景): 刺骨寒意、霉味、粗糙触感
   confrontation (对峙): 金属锐响、血腥气、紧绷感
   luxurious (华贵): 香料气息、丝绸触感、美味
   illness (病态): 药苦、虚弱、呼吸困难
   crafting (制作): 研磨声、药材气味、粉末触感
   ```

2. **强制五感覆盖**
   - 每个重要场景至少3种感官
   - 避免连续段落只有视觉描写

---

### Phase 5: 伏笔与节奏系统（优先级：中）

**问题：** 线性叙事，缺乏悬念和节奏变化

**解决方案：**

1. **伏笔追踪服务** (新建 foreshadowing.service.ts)

   ```typescript
   interface Foreshadow {
     id: string;
     hint: string; // 埋设的暗示
     chapter_planted: number; // 埋设章节
     chapter_revealed?: number; // 揭示章节
     importance: "major" | "minor";
   }
   ```

2. **节奏控制服务** (新建 pacing-control.service.ts)
   - 章节节奏类型: fast/medium/slow
   - 连续3章快节奏后强制插入慢节奏
   - 高潮前的铺垫节奏控制

3. **学习诡秘之主的技巧**
   - 长线伏笔（10+章后回收）
   - 中线伏笔（3-5章回收）
   - 短线悬念（本章末尾抛出，下章开头解决）

---

### Phase 6: 风格预设增强（优先级：低）

**基于晋江研究，增加女频风格预设：**

1. **jinjiang_yanqing** (晋江言情)
   - 情感细腻、内心戏丰富
   - 感情线与主线交织
   - 甜虐平衡

2. **jinjiang_gongdou** (晋江宫斗)
   - 话中藏刀
   - 微表情叙事
   - 女性视角权谋

---

## 四、实施顺序

```
Phase 1: 服务集成 + Phase 2: 开篇钩子
        ↓
Phase 3: 专业声音 + Phase 4: 五感沉浸
        ↓
Phase 5: 伏笔节奏
        ↓
Phase 6: 风格预设 + 端到端测试
```

---

## 五、关键文件清单

| 文件                            | 操作   | 说明           |
| ------------------------------- | ------ | -------------- |
| `writing.module.ts`             | 修改   | 注册新服务     |
| `writer.agent.ts`               | 修改   | 集成新约束生成 |
| `professional-voice.service.ts` | 已创建 | 专业声音服务   |
| `sensory-immersion.service.ts`  | 已创建 | 五感沉浸服务   |
| `opening-hook.service.ts`       | 已创建 | 开篇钩子服务   |
| `foreshadowing.service.ts`      | 新建   | 伏笔追踪服务   |
| `pacing-control.service.ts`     | 新建   | 节奏控制服务   |
| `writing-style-presets.ts`      | 修改   | 增加晋江风格   |

---

## 六、验证方案

### 6.1 单元测试

```bash
npm run test -- --grep "writing"
```

### 6.2 端到端验证

1. 使用相同的穿越剧需求重新生成
2. 对比新输出与汉宫妆影的差距
3. 检查开篇是否有感官冲击
4. 检查角色是否有专业思维流露
5. 检查五感描写覆盖率

### 6.3 质量评分

- 使用 openingHookService.analyzeOpeningQuality() 评估开篇
- 目标：开篇评分 > 70

---

## 七、风险与缓解

| 风险                     | 缓解措施                                |
| ------------------------ | --------------------------------------- |
| Prompt过长导致上下文超限 | 动态裁剪，只注入当前章节相关约束        |
| 新约束与现有系统冲突     | 渐进式集成，先注入后调优                |
| 过度约束导致创意受限     | 保持creativity=high，约束作为引导非强制 |

---

**最后更新**: 2026-01-10
**作者**: Claude Code

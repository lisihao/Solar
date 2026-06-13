# 大模型演进：后训练时代

## 概述

大模型发展已进入"下半场"——从预训练为主转向后训练(Post-training)为核心竞争力。后训练技术决定了模型的实际能力、对齐程度和用户体验。

## 预训练 vs 后训练

### 1. 阶段对比

```
┌─────────────────────────────────────────────────────────────┐
│                大模型训练阶段演进                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  预训练 (Pre-training)           后训练 (Post-training)     │
│  ━━━━━━━━━━━━━━━━━━━━           ━━━━━━━━━━━━━━━━━━━━        │
│                                                              │
│  目标: 学习语言知识              目标: 学习任务和对齐        │
│  数据: 海量网络文本              数据: 高质量标注数据        │
│  计算: 万卡级别                  计算: 百卡级别              │
│  时间: 数月                      时间: 数天-数周             │
│  成本: 数千万美元                成本: 数十万美元            │
│                                                              │
│  ┌─────────────┐                ┌─────────────────────────┐ │
│  │             │                │  SFT → RLHF → DPO →    │ │
│  │  Next Token │     →          │  Constitutional AI →    │ │
│  │  Prediction │                │  RLAIF → ...            │ │
│  │             │                │                         │ │
│  └─────────────┘                └─────────────────────────┘ │
│                                                              │
│  "知识习得"                      "能力激活 + 价值对齐"       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. 重要性转变

| 时期      | 预训练占比 | 后训练占比 | 关键因素         |
| --------- | ---------- | ---------- | ---------------- |
| 2020-2022 | 90%        | 10%        | 模型规模 Scaling |
| 2023      | 70%        | 30%        | RLHF 对齐        |
| 2024      | 50%        | 50%        | 后训练技术       |
| 2025+     | 40%        | 60%        | 能力定制化       |

## 后训练技术栈

### 1. 监督微调 (SFT)

```python
# SFT 数据格式
sft_data = {
    "instruction": "请解释什么是机器学习",
    "input": "",  # 可选的额外上下文
    "output": "机器学习是人工智能的一个分支，它使计算机能够..."
}

# 高质量 SFT 数据特点
quality_criteria = {
    "diversity": "覆盖多种任务类型",
    "complexity": "包含简单到复杂的梯度",
    "accuracy": "答案准确无误",
    "format": "格式清晰规范",
    "length": "适当的详细程度",
}
```

### 2. RLHF (人类反馈强化学习)

```
┌─────────────────────────────────────────────────────────────┐
│                     RLHF 训练流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: 收集人类偏好数据                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Prompt: "解释相对论"                               │    │
│  │  Response A: [详细解释...]  ← 人类选择更好           │    │
│  │  Response B: [简略解释...]                          │    │
│  └────────────────────────────────────────────────────┘    │
│                           │                                  │
│                           ▼                                  │
│  Step 2: 训练奖励模型 (Reward Model)                        │
│  ┌────────────────────────────────────────────────────┐    │
│  │  RM(prompt, response) → score                       │    │
│  │  学习人类偏好的评分函数                              │    │
│  └────────────────────────────────────────────────────┘    │
│                           │                                  │
│                           ▼                                  │
│  Step 3: PPO 强化学习优化                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │  最大化: RM(prompt, policy(prompt))                 │    │
│  │  约束: KL散度不能偏离原始模型太远                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3. DPO (直接偏好优化)

```python
# DPO 损失函数
def dpo_loss(policy, reference, chosen, rejected, beta=0.1):
    """
    DPO 直接优化策略，无需训练奖励模型

    优点:
    - 更稳定的训练
    - 更少的超参数
    - 不需要 RM
    """
    # 计算 log 概率比
    chosen_logprob = policy.log_prob(chosen) - reference.log_prob(chosen)
    rejected_logprob = policy.log_prob(rejected) - reference.log_prob(rejected)

    # DPO 损失
    loss = -log_sigmoid(beta * (chosen_logprob - rejected_logprob))
    return loss.mean()
```

### 4. Constitutional AI

```
┌─────────────────────────────────────────────────────────────┐
│               Constitutional AI (Anthropic)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  宪法原则示例:                                              │
│  ─────────────                                              │
│  1. "请选择最不可能造成伤害的回复"                          │
│  2. "请选择最诚实、最有帮助的回复"                          │
│  3. "请选择尊重用户自主权的回复"                            │
│                                                              │
│  流程:                                                       │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐               │
│  │ 生成    │ →  │ 自我    │ →  │ 修订    │               │
│  │ 初始回复│    │ 批评    │    │ 回复    │               │
│  └─────────┘    └─────────┘    └─────────┘               │
│                                                              │
│  优势:                                                       │
│  - 减少人类标注需求                                         │
│  - 可解释的对齐标准                                         │
│  - 可扩展到新领域                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5. RLAIF (AI 反馈强化学习)

```python
# RLAIF: 使用 AI 代替人类提供反馈
class RLAIF:
    def __init__(self, judge_model, policy_model):
        self.judge = judge_model  # 评判模型 (通常更大)
        self.policy = policy_model  # 被训练模型

    def generate_preference(self, prompt, response_a, response_b):
        """AI 评判哪个回复更好"""
        judge_prompt = f"""
        请评估以下两个回复，选择更好的一个。

        问题: {prompt}

        回复A: {response_a}
        回复B: {response_b}

        哪个回复更好？请只回答 A 或 B。
        """
        return self.judge(judge_prompt)

    def train(self, prompts):
        for prompt in prompts:
            # 生成多个候选回复
            responses = [self.policy(prompt) for _ in range(4)]

            # AI 两两比较，生成偏好数据
            preferences = self.pairwise_compare(prompt, responses)

            # 使用偏好数据训练
            self.policy.train_on_preferences(preferences)
```

## Scaling Post-training

### 1. 数据质量 > 数据数量

```
┌─────────────────────────────────────────────────────────────┐
│                  后训练数据 Scaling Law                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  性能                                                        │
│    ↑                                                        │
│    │                    ╭─────────────── 高质量数据        │
│    │                 ╭──╯                                   │
│    │              ╭──╯                                      │
│    │           ╭──╯                                         │
│    │        ╭──╯                                            │
│    │     ╭──╯     ╭─────────────────── 普通数据             │
│    │  ╭──╯     ╭──╯                                         │
│    │──╯     ╭──╯                                            │
│    │     ╭──╯                                               │
│    └─────────────────────────────────────→ 数据量           │
│                                                              │
│  关键发现:                                                   │
│  - 1000 条高质量数据 > 100000 条普通数据                    │
│  - 数据多样性比数量更重要                                   │
│  - 格式一致性影响学习效率                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. 合成数据

```python
# 使用强模型生成训练数据
class SyntheticDataGenerator:
    def __init__(self, teacher_model):
        self.teacher = teacher_model  # GPT-4, Claude 等

    def generate_instruction_data(self, seed_tasks):
        """Self-Instruct 方法"""
        synthetic_data = []

        for seed in seed_tasks:
            # 让 teacher 生成新任务
            new_task = self.teacher(f"""
            基于以下示例任务，生成一个相似但不同的新任务:
            示例: {seed}

            新任务:
            """)

            # 让 teacher 生成答案
            answer = self.teacher(f"请完成以下任务: {new_task}")

            synthetic_data.append({
                "instruction": new_task,
                "output": answer
            })

        return synthetic_data

    def distill_reasoning(self, problems):
        """蒸馏推理过程"""
        cot_data = []

        for problem in problems:
            # 获取详细推理过程
            reasoning = self.teacher(f"""
            请详细解决以下问题，展示你的推理过程:
            {problem}
            """)

            cot_data.append({
                "problem": problem,
                "reasoning": reasoning
            })

        return cot_data
```

### 3. 课程学习

```
┌─────────────────────────────────────────────────────────────┐
│                  后训练课程设计                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  阶段 1: 基础能力                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  - 指令遵循                                          │   │
│  │  - 格式规范                                          │   │
│  │  - 基础问答                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  阶段 2: 复杂任务                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  - 多轮对话                                          │   │
│  │  - 长文本处理                                        │   │
│  │  - 代码生成                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  阶段 3: 高级推理                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  - 数学推理                                          │   │
│  │  - 逻辑分析                                          │   │
│  │  - 创意写作                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  阶段 4: 对齐与安全                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  - 拒绝有害请求                                      │   │
│  │  - 价值观对齐                                        │   │
│  │  - 边界情况处理                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 前沿技术

### 1. Process Reward Models (PRM)

```python
# 过程奖励模型：评估每个推理步骤
class ProcessRewardModel:
    """
    与传统 ORM (Outcome RM) 的区别:
    - ORM: 只评估最终答案
    - PRM: 评估每个中间步骤
    """

    def score_solution(self, problem, solution_steps):
        scores = []
        for i, step in enumerate(solution_steps):
            # 评估当前步骤的正确性
            step_score = self.evaluate_step(
                problem=problem,
                previous_steps=solution_steps[:i],
                current_step=step
            )
            scores.append(step_score)

        return scores

    def best_of_n_sampling(self, problem, n=64):
        """使用 PRM 进行 Best-of-N 采样"""
        solutions = [self.generate(problem) for _ in range(n)]

        # 使用 PRM 分数选择最佳解
        best_solution = max(
            solutions,
            key=lambda s: min(self.score_solution(problem, s))
        )

        return best_solution
```

### 2. Iterative DPO

```
┌─────────────────────────────────────────────────────────────┐
│                    Iterative DPO                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Round 1:                                                   │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐              │
│  │ Base    │ DPO │ Model   │ Gen │ New     │              │
│  │ Model   │ ──→ │ v1      │ ──→ │ Prefs   │              │
│  └─────────┘     └─────────┘     └─────────┘              │
│                                       │                     │
│                       ┌───────────────┘                     │
│                       ▼                                     │
│  Round 2:                                                   │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐              │
│  │ Model   │ DPO │ Model   │ Gen │ New     │              │
│  │ v1      │ ──→ │ v2      │ ──→ │ Prefs   │              │
│  └─────────┘     └─────────┘     └─────────┘              │
│                                       │                     │
│                       ┌───────────────┘                     │
│                       ▼                                     │
│  Round N: ...                                               │
│                                                              │
│  优势: 模型持续自我改进                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3. Test-Time Compute

```python
# 推理时计算 Scaling
class TestTimeCompute:
    """
    o1 模型的核心思想：
    在推理时投入更多计算来提升效果
    """

    def solve_with_extended_thinking(self, problem, compute_budget):
        thoughts = []

        while compute_budget > 0:
            # 生成思考步骤
            thought = self.model.generate_thought(problem, thoughts)
            thoughts.append(thought)

            # 验证当前思路
            if self.verify_reasoning(thoughts):
                break

            # 如果错误，回溯尝试其他路径
            if self.detect_error(thoughts):
                thoughts = self.backtrack(thoughts)

            compute_budget -= 1

        return self.synthesize_answer(thoughts)
```

## 行业实践

### 1. 各厂商后训练特点

| 公司          | 后训练特点                  | 代表技术         |
| ------------- | --------------------------- | ---------------- |
| **OpenAI**    | RLHF 标准化，o1 推理时计算  | InstructGPT, o1  |
| **Anthropic** | Constitutional AI, 高安全性 | Claude, RLAIF    |
| **Google**    | 多模态对齐，长上下文        | Gemini           |
| **Meta**      | 开源生态，社区协作          | Llama, Open RLHF |

### 2. 开源工具

```bash
# 常用后训练框架
- trl           # Hugging Face 的 RLHF 库
- OpenRLHF     # 分布式 RLHF 训练
- LLaMA-Factory # 一站式微调平台
- Axolotl      # 简化的微调流程
```

## 未来趋势

1. **Scaling Test-Time Compute**: 推理时计算将越来越重要
2. **自动化对齐**: 减少人类标注依赖
3. **持续学习**: 部署后持续改进
4. **个性化后训练**: 针对特定用户/场景定制
5. **多模态后训练**: 统一的多模态对齐

## 参考资源

- [InstructGPT 论文](https://arxiv.org/abs/2203.02155)
- [Constitutional AI](https://arxiv.org/abs/2212.08073)
- [DPO 论文](https://arxiv.org/abs/2305.18290)
- [Let's Verify Step by Step (PRM)](https://arxiv.org/abs/2305.20050)
- [TRL 文档](https://huggingface.co/docs/trl/)

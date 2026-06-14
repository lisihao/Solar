# 高效推理模型

## 概述

高效推理是大模型落地的关键技术，旨在降低推理成本、减少延迟、提高吞吐量，使 AI 能够在各种硬件上高效运行。

## 推理优化全景

```
┌─────────────────────────────────────────────────────────────┐
│                   高效推理技术栈                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    模型层                             │   │
│  │  量化 | 蒸馏 | 剪枝 | 稀疏化 | 低秩分解              │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    算法层                             │   │
│  │  KV Cache | Speculative Decoding | Batching         │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    系统层                             │   │
│  │  vLLM | TensorRT-LLM | FlashAttention | PagedAttn   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    硬件层                             │   │
│  │  GPU | TPU | NPU | 专用 AI 芯片                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 模型压缩技术

### 1. 量化 (Quantization)

```
┌─────────────────────────────────────────────────────────────┐
│                      量化技术对比                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  精度类型        位数    内存占比    性能影响                │
│  ─────────────────────────────────────────────────          │
│  FP32           32-bit   100%      基准                     │
│  FP16/BF16      16-bit   50%       几乎无损                 │
│  INT8           8-bit    25%       轻微损失                 │
│  INT4/NF4       4-bit    12.5%     可接受损失               │
│  INT2           2-bit    6.25%     明显损失                 │
│                                                              │
│  量化方法:                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ PTQ         │  │ QAT         │  │ GPTQ/AWQ    │        │
│  │ 训练后量化  │  │ 感知量化训练│  │ 权重量化    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**常用量化方法:**

```python
# GPTQ 量化示例
from transformers import AutoModelForCausalLM, GPTQConfig

quantization_config = GPTQConfig(
    bits=4,                    # 4-bit 量化
    dataset="c4",              # 校准数据集
    group_size=128,            # 量化组大小
    desc_act=True,             # 激活降序
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-70b-hf",
    quantization_config=quantization_config,
    device_map="auto"
)

# AWQ 量化
from awq import AutoAWQForCausalLM

model = AutoAWQForCausalLM.from_pretrained(model_path)
model.quantize(
    tokenizer,
    quant_config={
        "w_bit": 4,
        "q_group_size": 128,
    }
)
```

### 2. 知识蒸馏

```
┌─────────────────────────────────────────────────────────────┐
│                    知识蒸馏流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │   Teacher Model │         │  Student Model  │           │
│  │   (70B params)  │         │   (7B params)   │           │
│  └────────┬────────┘         └────────┬────────┘           │
│           │                           │                     │
│           │    Soft Labels            │                     │
│           │   ┌─────────┐            │                     │
│           └──►│ P(y|x)  │◄───────────┘                     │
│               │ T=2-10  │   Learn from                     │
│               └─────────┘   soft targets                   │
│                                                              │
│  蒸馏损失:                                                   │
│  L = α * L_CE(y, p_student) + (1-α) * L_KL(p_teacher, p_student)
│                                                              │
│  技术要点:                                                   │
│  - 温度参数 T: 软化概率分布                                  │
│  - 中间层蒸馏: 不只学输出，也学特征                         │
│  - 在线蒸馏: 实时从大模型学习                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3. 模型剪枝

```python
# 结构化剪枝示例
class StructuredPruning:
    def prune_attention_heads(self, model, heads_to_prune):
        """剪掉不重要的注意力头"""
        for layer_idx, head_indices in heads_to_prune.items():
            # 计算头的重要性分数
            importance = self.compute_head_importance(model, layer_idx)

            # 移除低重要性的头
            self.remove_heads(model, layer_idx, head_indices)

    def prune_layers(self, model, layers_to_remove):
        """剪掉整个层 (层剪枝)"""
        # 识别冗余层
        layer_similarity = self.compute_layer_similarity(model)

        # 移除相似度高的层
        model.layers = [
            layer for i, layer in enumerate(model.layers)
            if i not in layers_to_remove
        ]
```

## 推理算法优化

### 1. KV Cache 优化

```
┌─────────────────────────────────────────────────────────────┐
│                    KV Cache 机制                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  无 Cache (每次重新计算):                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Token 1:  计算 Q1, K1, V1, Attention               │    │
│  │ Token 2:  计算 Q2, K1,K2, V1,V2, Attention         │    │
│  │ Token 3:  计算 Q3, K1,K2,K3, V1,V2,V3, Attention   │    │
│  │ ...       (重复计算之前所有 K, V)                   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  有 KV Cache:                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Token 1:  计算 Q1, K1, V1, 存入 Cache               │    │
│  │ Token 2:  计算 Q2, K2, V2, 存入 Cache, 复用 K1,V1  │    │
│  │ Token 3:  计算 Q3, K3, V3, 存入 Cache, 复用 K1-2   │    │
│  │ ...       (只计算新 token 的 K, V)                  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  内存占用: O(batch * seq_len * n_layers * d_model * 2)     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**PagedAttention (vLLM):**

```python
# PagedAttention 核心思想：类似操作系统的虚拟内存
class PagedKVCache:
    """
    问题: KV Cache 内存预分配造成碎片
    解决: 将 KV Cache 分页管理，按需分配
    """

    def __init__(self, block_size=16, num_blocks=1000):
        self.block_size = block_size  # 每个块存储的 token 数
        self.blocks = [None] * num_blocks  # 物理块
        self.block_table = {}  # 逻辑到物理映射

    def allocate(self, seq_id, num_tokens):
        """按需分配内存块"""
        num_blocks_needed = math.ceil(num_tokens / self.block_size)

        # 找到空闲块
        free_blocks = self.find_free_blocks(num_blocks_needed)

        # 建立映射
        self.block_table[seq_id] = free_blocks

    def get_kv(self, seq_id, layer_idx, position):
        """获取指定位置的 KV"""
        block_idx = position // self.block_size
        offset = position % self.block_size

        physical_block = self.block_table[seq_id][block_idx]
        return self.blocks[physical_block][layer_idx][offset]
```

### 2. Speculative Decoding

```
┌─────────────────────────────────────────────────────────────┐
│                  Speculative Decoding                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  核心思想: 用小模型"猜测"，大模型"验证"                     │
│                                                              │
│  Step 1: 小模型生成 K 个候选 token                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Draft Model (7B): [token1, token2, token3, token4]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  Step 2: 大模型并行验证所有 token                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Target Model (70B): 一次前向传播验证 4 个 token     │   │
│  │  结果: [✓ accept, ✓ accept, ✓ accept, ✗ reject]     │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  Step 3: 接受匹配的 token，从拒绝点继续                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  输出: token1, token2, token3, [大模型生成新token]   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  加速效果: 2-3x (取决于小模型与大模型的一致性)              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

```python
# Speculative Decoding 实现
class SpeculativeDecoder:
    def __init__(self, draft_model, target_model, k=4):
        self.draft = draft_model      # 小模型 (快)
        self.target = target_model    # 大模型 (慢但准)
        self.k = k                    # 猜测长度

    def generate(self, prompt, max_tokens):
        tokens = prompt

        while len(tokens) < max_tokens:
            # Step 1: 小模型生成 k 个候选
            draft_tokens = self.draft.generate(tokens, self.k)

            # Step 2: 大模型并行验证
            # 一次前向传播计算所有 token 的概率
            target_probs = self.target.forward(tokens + draft_tokens)
            draft_probs = self.draft.get_probs(tokens, draft_tokens)

            # Step 3: 决定接受哪些 token
            accepted = 0
            for i in range(self.k):
                # 接受概率
                p_accept = min(1, target_probs[i] / draft_probs[i])

                if random.random() < p_accept:
                    accepted += 1
                else:
                    break

            # 添加接受的 token
            tokens.extend(draft_tokens[:accepted])

            # 从大模型采样一个新 token
            if accepted < self.k:
                new_token = self.target.sample(tokens)
                tokens.append(new_token)

        return tokens
```

### 3. Continuous Batching

```
┌─────────────────────────────────────────────────────────────┐
│                  Continuous Batching                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  静态 Batching (传统):                                      │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Request 1: ████████████████████ (长)                │    │
│  │ Request 2: █████████ (短，等待...)                  │    │
│  │ Request 3: ██████████████ (中，等待...)             │    │
│  │                                                     │    │
│  │ 问题: 短请求必须等待长请求完成                       │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  Continuous Batching:                                       │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Time →                                              │    │
│  │ Slot 1: ████████ (R1) ██████ (R4) ████ (R6)        │    │
│  │ Slot 2: █████ (R2) ████████ (R5) ███████ (R7)      │    │
│  │ Slot 3: ██████████ (R3) █████████ (R8)             │    │
│  │                                                     │    │
│  │ 优点: 请求完成即可插入新请求，GPU 利用率更高        │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 系统级优化

### 1. FlashAttention

```
┌─────────────────────────────────────────────────────────────┐
│                    FlashAttention                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  标准 Attention (内存瓶颈):                                 │
│  ┌────────────────────────────────────────────────────┐    │
│  │  1. 计算 S = QK^T           (O(N²) 内存)           │    │
│  │  2. 计算 P = softmax(S)     (O(N²) 内存)           │    │
│  │  3. 计算 O = PV             (O(N²) 内存)           │    │
│  │                                                     │    │
│  │  问题: 需要物化完整的 N×N 注意力矩阵               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  FlashAttention (分块 + 重计算):                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │  核心思想: 分块计算，避免物化大矩阵                 │    │
│  │                                                     │    │
│  │  for each block of Q:                               │    │
│  │      for each block of K, V:                        │    │
│  │          在 SRAM 中计算部分注意力                   │    │
│  │          累积结果到输出                             │    │
│  │                                                     │    │
│  │  优势:                                              │    │
│  │  - 内存复杂度: O(N²) → O(N)                        │    │
│  │  - 速度提升: 2-4x                                  │    │
│  │  - 支持更长序列                                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. 推理框架对比

| 框架             | 特点                     | 适用场景   |
| ---------------- | ------------------------ | ---------- |
| **vLLM**         | PagedAttention, 高吞吐量 | 在线服务   |
| **TensorRT-LLM** | NVIDIA 优化, 低延迟      | NVIDIA GPU |
| **llama.cpp**    | CPU 友好, 低资源         | 边缘设备   |
| **MLC-LLM**      | 跨平台编译               | 移动端     |
| **DeepSpeed**    | 大规模分布式             | 训练+推理  |

```python
# vLLM 使用示例
from vllm import LLM, SamplingParams

# 加载模型
llm = LLM(
    model="meta-llama/Llama-2-70b-chat-hf",
    tensor_parallel_size=4,  # 4 卡张量并行
    gpu_memory_utilization=0.9,
)

# 批量推理
sampling_params = SamplingParams(
    temperature=0.8,
    top_p=0.95,
    max_tokens=512,
)

outputs = llm.generate(prompts, sampling_params)
```

## NeurIPS 2024 前沿

### 1. 混合专家 (MoE) 推理优化

```
┌─────────────────────────────────────────────────────────────┐
│                    MoE 推理优化                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  MoE 架构:                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Router                            │   │
│  │                      │                               │   │
│  │     ┌────────────────┼────────────────┐             │   │
│  │     ▼                ▼                ▼             │   │
│  │  ┌──────┐        ┌──────┐        ┌──────┐          │   │
│  │  │Expert│        │Expert│        │Expert│ ... (N个) │   │
│  │  │  1   │        │  2   │        │  3   │          │   │
│  │  └──────┘        └──────┘        └──────┘          │   │
│  │     │                │                │             │   │
│  │     └────────────────┼────────────────┘             │   │
│  │                      ▼                               │   │
│  │                   输出                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  推理优化技术:                                              │
│  1. Expert Parallelism: 专家分布在不同 GPU                 │
│  2. Expert Caching: 缓存热门专家                           │
│  3. Load Balancing: 动态负载均衡                           │
│  4. Sparse Activation: 只激活 Top-K 专家                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. 稀疏注意力

```python
# 各种稀疏注意力模式
class SparseAttention:
    def sliding_window(self, seq_len, window_size):
        """滑动窗口注意力 (Mistral)"""
        # 每个 token 只看最近 window_size 个 token
        return create_mask(seq_len, window_size)

    def dilated(self, seq_len, dilation):
        """扩张注意力"""
        # 跳跃式关注，覆盖更长范围
        return create_dilated_mask(seq_len, dilation)

    def longformer(self, seq_len, local_window, global_positions):
        """Longformer: 局部 + 全局"""
        # 大部分用局部窗口，特殊 token 用全局
        return create_longformer_mask(seq_len, local_window, global_positions)

    def bigbird(self, seq_len, block_size, num_random):
        """BigBird: 局部 + 全局 + 随机"""
        return create_bigbird_mask(seq_len, block_size, num_random)
```

### 3. 动态推理

```python
# 早期退出 (Early Exit)
class EarlyExitModel:
    """
    核心思想: 简单输入不需要经过所有层
    """

    def forward(self, x, confidence_threshold=0.95):
        for i, layer in enumerate(self.layers):
            x = layer(x)

            # 每隔几层检查一次
            if i % 4 == 0 and i > 0:
                confidence = self.exit_classifier(x)

                if confidence > confidence_threshold:
                    # 提前退出
                    return self.head(x)

        return self.head(x)
```

## 实践建议

### 1. 优化路径选择

```
┌─────────────────────────────────────────────────────────────┐
│                   推理优化决策树                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  需要降低成本?                                              │
│       │                                                     │
│       ├─ Yes ─► 量化 (INT8/INT4)                           │
│       │            │                                        │
│       │            └─► 模型太大? ─► 蒸馏/剪枝              │
│       │                                                     │
│  需要降低延迟?                                              │
│       │                                                     │
│       ├─ Yes ─► Speculative Decoding                       │
│       │            │                                        │
│       │            └─► 还不够? ─► 更小的模型               │
│       │                                                     │
│  需要提高吞吐?                                              │
│       │                                                     │
│       └─ Yes ─► vLLM / Continuous Batching                 │
│                    │                                        │
│                    └─► 还不够? ─► 多卡并行                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. 硬件匹配

| 场景     | 推荐方案         | 硬件要求   |
| -------- | ---------------- | ---------- |
| 在线服务 | vLLM + INT8      | A100/H100  |
| 边缘部署 | llama.cpp + INT4 | CPU/NPU    |
| 批量处理 | TensorRT-LLM     | NVIDIA GPU |
| 研究原型 | Hugging Face     | 任意       |

## 参考资源

- [vLLM 论文](https://arxiv.org/abs/2309.06180)
- [FlashAttention](https://arxiv.org/abs/2205.14135)
- [Speculative Decoding](https://arxiv.org/abs/2211.17192)
- [GPTQ](https://arxiv.org/abs/2210.17323)
- [AWQ](https://arxiv.org/abs/2306.00978)

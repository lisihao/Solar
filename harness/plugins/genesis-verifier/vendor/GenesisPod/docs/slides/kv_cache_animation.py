"""
KV Cache 动态增长演示 GIF
精简版：只展示 token 与 KV Cache 的动态增长关系
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np
from PIL import Image

plt.rcParams['font.family'] = 'DejaVu Sans'
plt.rcParams['font.size'] = 11

# 颜色
BG = '#0f172a'
TOKEN_NEW = '#f43f5e'       # 当前 token - 玫红
TOKEN_DONE = '#22c55e'      # 已处理 token - 绿
TOKEN_WAIT = '#334155'      # 未处理 token - 暗灰
K_COLOR = '#06b6d4'         # Key cache - 青
V_COLOR = '#8b5cf6'         # Value cache - 紫
TEXT = '#e2e8f0'
DIM = '#64748b'
GOLD = '#fbbf24'
ARROW_COLOR = '#facc15'

TOKENS = ['I', 'love', 'deep', 'learn', '-ing', '!']
N = len(TOKENS)

def rounded_rect(ax, x, y, w, h, color, alpha=1.0, ec='none', lw=0, radius=0.3):
    rect = patches.FancyBboxPatch(
        (x, y), w, h, boxstyle=f"round,pad={radius}",
        facecolor=color, alpha=alpha, edgecolor=ec, linewidth=lw
    )
    ax.add_patch(rect)
    return rect

def render_frame(step):
    """step 0..N-1: 逐个 token 生成，KV Cache 同步增长"""
    fig, ax = plt.subplots(figsize=(12, 5.5))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 240)
    ax.set_ylim(0, 110)
    ax.set_aspect('equal')
    ax.axis('off')

    # ---- 标题 ----
    ax.text(120, 104, f'KV Cache Growth  |  Step {step + 1}/{N}',
           ha='center', fontsize=16, color=GOLD, fontweight='bold')

    # ---- Token 序列 (顶部) ----
    tok_y = 88
    tok_w, tok_h = 22, 12
    gap = 4
    total_w = N * tok_w + (N - 1) * gap
    tok_x0 = (240 - total_w) / 2

    ax.text(tok_x0 - 2, tok_y + tok_h / 2, 'Tokens', ha='right', va='center',
           fontsize=10, color=DIM)

    for i in range(N):
        x = tok_x0 + i * (tok_w + gap)
        if i < step:
            c = TOKEN_DONE
        elif i == step:
            c = TOKEN_NEW
        else:
            c = TOKEN_WAIT
        a = 1.0 if i <= step else 0.35
        rounded_rect(ax, x, tok_y, tok_w, tok_h, c, alpha=a, ec='white' if i == step else 'none', lw=2 if i == step else 0)
        ax.text(x + tok_w / 2, tok_y + tok_h / 2, TOKENS[i],
               ha='center', va='center', fontsize=9, color='white' if i <= step else DIM,
               fontweight='bold' if i == step else 'normal')

    # ---- 新 token 指示箭头 ----
    cur_x = tok_x0 + step * (tok_w + gap) + tok_w / 2
    ax.annotate('new', xy=(cur_x, tok_y - 1), xytext=(cur_x, tok_y - 8),
               ha='center', fontsize=8, color=TOKEN_NEW, fontweight='bold',
               arrowprops=dict(arrowstyle='->', color=TOKEN_NEW, lw=1.5))

    # ---- KV Cache 区域 ----
    cache_top = 70
    row_h = 9
    col_w = 8
    n_cols = 4  # d_model 简化
    n_rows = step + 1  # 已缓存行数

    # K Cache
    k_x0 = 40
    ax.text(k_x0 + n_cols * col_w / 2, cache_top + 5, 'K Cache',
           ha='center', fontsize=12, color=K_COLOR, fontweight='bold')

    for r in range(n_rows):
        y = cache_top - (r + 1) * row_h
        is_new = (r == step)
        for c in range(n_cols):
            x = k_x0 + c * col_w
            alpha = 1.0 if is_new else 0.55
            rounded_rect(ax, x + 0.5, y + 0.5, col_w - 1, row_h - 1,
                        K_COLOR, alpha=alpha, ec='white' if is_new else 'none',
                        lw=1.5 if is_new else 0, radius=0.2)
        # token label
        ax.text(k_x0 - 3, y + row_h / 2, TOKENS[r], ha='right', va='center',
               fontsize=7, color=TOKEN_NEW if is_new else TOKEN_DONE, fontweight='bold' if is_new else 'normal')

    # V Cache
    v_x0 = 130
    ax.text(v_x0 + n_cols * col_w / 2, cache_top + 5, 'V Cache',
           ha='center', fontsize=12, color=V_COLOR, fontweight='bold')

    for r in range(n_rows):
        y = cache_top - (r + 1) * row_h
        is_new = (r == step)
        for c in range(n_cols):
            x = v_x0 + c * col_w
            alpha = 1.0 if is_new else 0.55
            rounded_rect(ax, x + 0.5, y + 0.5, col_w - 1, row_h - 1,
                        V_COLOR, alpha=alpha, ec='white' if is_new else 'none',
                        lw=1.5 if is_new else 0, radius=0.2)
        ax.text(v_x0 - 3, y + row_h / 2, TOKENS[r], ha='right', va='center',
               fontsize=7, color=TOKEN_NEW if is_new else TOKEN_DONE, fontweight='bold' if is_new else 'normal')

    # ---- 增长指示器（右侧） ----
    info_x = 195
    # Cache 大小
    ax.text(info_x, cache_top - 2, 'Cache Size', ha='left', fontsize=10, color=TEXT, fontweight='bold')

    # 进度条
    bar_y = cache_top - 14
    bar_w = 40
    bar_h = 8
    rounded_rect(ax, info_x, bar_y, bar_w, bar_h, '#1e293b', ec=DIM, lw=1, radius=0.15)
    fill_w = bar_w * n_rows / N
    fill_color = TOKEN_NEW if step == N - 1 else GOLD
    rounded_rect(ax, info_x, bar_y, fill_w, bar_h, fill_color, alpha=0.8, radius=0.15)
    ax.text(info_x + bar_w / 2, bar_y + bar_h / 2, f'{n_rows}/{N}',
           ha='center', va='center', fontsize=9, color='white', fontweight='bold')

    # 内存占用
    mem = n_rows * n_cols * 2  # K + V
    ax.text(info_x, bar_y - 10, f'Memory: 2 x {n_rows} x {n_cols} = {mem}',
           ha='left', fontsize=9, color=DIM)

    # ---- 底部公式 ----
    bottom_y = 8
    if step == 0:
        note = 'Step 1: No cache yet, compute K and V for the first token'
    else:
        note = f'Step {step+1}: Reuse {step} cached rows, only compute new K, V for "{TOKENS[step]}"'
    ax.text(120, bottom_y, note, ha='center', fontsize=10, color=TEXT,
           bbox=dict(boxstyle='round,pad=0.5', facecolor='#1e293b', edgecolor=DIM, lw=1))

    plt.tight_layout(pad=0.5)
    return fig


# ============================================================
# 生成 GIF
# ============================================================

print(f"Generating {N} frames...")

frames = []
for i in range(N):
    fig = render_frame(i)
    fig.canvas.draw()
    buf = np.asarray(fig.canvas.buffer_rgba())[:, :, :3].copy()
    frames.append(Image.fromarray(buf))
    plt.close(fig)
    print(f"  Frame {i+1}/{N} done")

durations = [1800] * N  # 每帧 1.8 秒
durations[-1] = 3000     # 最后一帧停留久一点

output_path = 'docs/slides/kv_cache_animation.gif'
frames[0].save(
    output_path,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    optimize=True
)

print(f"\nGIF saved to: {output_path}")
print(f"Total frames: {N}, Duration: {sum(durations)/1000:.1f}s")

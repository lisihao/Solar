"""
KV Cache Scale-Up / Scale-Out 搬迁演示 GIF
固定全景布局，完整 Prefill - Decode - ScaleUp - Decode - ScaleOut - Decode
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np
from PIL import Image

plt.rcParams['font.family'] = 'DejaVu Sans'
plt.rcParams['font.size'] = 11

# ---- 颜色 ----
BG      = '#0f172a'
PANEL   = '#1e293b'
GPU0_C  = '#0ea5e9'
GPU1_C  = '#a78bfa'
NODEC_C = '#f97316'
K_COL   = '#06b6d4'
V_COL   = '#8b5cf6'
GOLD    = '#fbbf24'
GREEN   = '#22c55e'
RED     = '#ef4444'
TEXT    = '#e2e8f0'
DIM     = '#475569'
DARK    = '#0f172a'
PINK    = '#f472b6'

# ---- 布局 ----
W, H = 320, 155

def box(ax, x, y, w, h, fc, alpha=1.0, ec='none', lw=0, r=0.3):
    p = patches.FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad={r}",
        facecolor=fc, alpha=alpha, edgecolor=ec, linewidth=lw)
    ax.add_patch(p)

def draw_kv_row(ax, x, y, alpha=1.0, glow=False, decode=False):
    """一对 KV 块"""
    ec = 'white' if glow else 'none'
    lw = 1.5 if glow else 0
    kc = '#0891b2' if decode else K_COL
    vc = '#7c3aed' if decode else V_COL
    bw, bh = 7, 5.5
    box(ax, x, y, bw, bh, kc, alpha=alpha, ec=ec, lw=lw, r=0.12)
    ax.text(x + bw/2, y + bh/2, 'K', ha='center', va='center',
           fontsize=6, color='white', alpha=alpha, fontweight='bold')
    box(ax, x + bw + 1, y, bw, bh, vc, alpha=alpha, ec=ec, lw=lw, r=0.12)
    ax.text(x + bw + 1 + bw/2, y + bh/2, 'V', ha='center', va='center',
           fontsize=6, color='white', alpha=alpha, fontweight='bold')

def draw_pipe(ax, x1, x2, y, progress=0, label='', active=False):
    ax.plot([x1, x2], [y, y], color=DIM, lw=5, alpha=0.12, solid_capstyle='round')
    if active and progress > 0:
        mx = x1 + (x2 - x1) * min(progress, 1.0)
        ax.plot([x1, mx], [y, y], color=GOLD, lw=5, alpha=0.4, solid_capstyle='round')
        for i in range(max(2, int(progress * 5))):
            t = i / max(1, int(progress * 5) - 1) * progress
            px = x1 + (x2 - x1) * t
            ax.plot(px, y, 's', color=GOLD, markersize=3.5, alpha=0.8)
    ax.text((x1+x2)/2, y - 5, label, ha='center', fontsize=7,
           color=GOLD if active else DIM, fontweight='bold' if active else 'normal')

def draw_mem_bar(ax, x, y, pct, color, warn=False):
    bw, bh = 8, 40
    box(ax, x, y, bw, bh, DARK, ec=RED if warn else DIM, lw=1.5 if warn else 0.8, r=0.12)
    fh = bh * min(pct, 1.0)
    if fh > 0:
        box(ax, x, y, bw, fh, RED if pct > 0.85 else color, alpha=0.4, r=0.12)
    pct_str = f'{int(pct*100)}%'
    ax.text(x + bw/2, y + bh + 3, pct_str, ha='center', fontsize=7,
           color=RED if pct > 0.85 else DIM, fontweight='bold' if pct > 0.85 else 'normal')

# ============================================================
# 布局坐标
# ============================================================

# Node A 外框
NA_X, NA_Y = 8, 18
NA_W, NA_H = 148, 108

# GPU-0
G0_X, G0_Y, G0_W, G0_H = 15, 24, 65, 95
KV0_X, KV0_TOP = 28, 105
MEM0_X = 55

# GPU-1
G1_X, G1_Y, G1_W, G1_H = 85, 24, 65, 95
KV1_X, KV1_TOP = 98, 105
MEM1_X = 125

# Node C
NC_X, NC_Y, NC_W, NC_H = 200, 18, 112, 108
GC_X, GC_Y, GC_W, GC_H = 207, 24, 98, 95
KVC_X, KVC_TOP = 225, 105
MEMC_X = 280

# 管道
NVL_X1, NVL_X2, NVL_Y = 62, 85, 65
NET_X1, NET_X2, NET_Y = 156, 200, 65

# KV 行间距
ROW_STEP = 6.8
PROMPT_N = 6
DECODE_PER_PHASE = 4
MAX_CAP = 16

# ============================================================
# 时间线: 40 帧
#
# 0-5:   Prefill on GPU-0 (6 prompt tokens)
# 6-9:   Decode on GPU-0 (4 tokens generated, KV grows)
# 10:    GPU-0 memory full
# 11-20: Scale-Up: KV migrates GPU-0 -> GPU-1 via NVLink
# 21-24: Decode on GPU-1 (4 more tokens, KV grows)
# 25:    Node A full
# 26-35: Scale-Out: KV migrates GPU-1 -> Node C via RDMA
# 36-39: Decode on Node C (4 more tokens)
# ============================================================

TOTAL = 40
OUTPUT_WORDS = ['The', 'cat', 'is', 'on', 'the', 'mat', 'now', '.', 'It', 'sat', 'down', '!']

def state(f):
    """返回每帧的状态: gpu0/gpu1/gpuc 上各有多少 KV 行, 哪个在 decode"""
    if f <= 5:
        n = f + 1
        return dict(gpu0=n, gpu1=0, gpuc=0,
                    decode_gpu=None, output_n=0,
                    nvl=0, net=0, phase='prefill',
                    warn=False, node_full=False,
                    caption=f'Prefill: caching prompt token {n}/{PROMPT_N} on GPU-0')
    elif f <= 9:
        d = f - 5
        return dict(gpu0=PROMPT_N + d, gpu1=0, gpuc=0,
                    decode_gpu='gpu0', output_n=d,
                    nvl=0, net=0, phase='decode0',
                    warn=False, node_full=False,
                    caption=f'Decode on GPU-0: output "{OUTPUT_WORDS[d-1]}", new KV row appended')
    elif f == 10:
        return dict(gpu0=PROMPT_N + DECODE_PER_PHASE, gpu1=0, gpuc=0,
                    decode_gpu='gpu0', output_n=DECODE_PER_PHASE,
                    nvl=0, net=0, phase='oom',
                    warn=True, node_full=False,
                    caption='GPU-0 memory full! Must migrate KV Cache to continue decode')
    elif f <= 20:
        t = f - 11
        total = PROMPT_N + DECODE_PER_PHASE
        moved = min(t + 1, total)
        return dict(gpu0=total - moved, gpu1=moved, gpuc=0,
                    decode_gpu=None, output_n=DECODE_PER_PHASE,
                    nvl=moved/total, net=0, phase='scaleup',
                    warn=False, node_full=False,
                    caption=f'Scale-Up: NVLink transfer {moved}/{total} KV rows to GPU-1')
    elif f <= 24:
        d = f - 20
        base = PROMPT_N + DECODE_PER_PHASE
        return dict(gpu0=0, gpu1=base + d, gpuc=0,
                    decode_gpu='gpu1', output_n=DECODE_PER_PHASE + d,
                    nvl=0, net=0, phase='decode1',
                    warn=False, node_full=False,
                    caption=f'Decode on GPU-1: output "{OUTPUT_WORDS[DECODE_PER_PHASE+d-1]}", KV grows')
    elif f == 25:
        base = PROMPT_N + DECODE_PER_PHASE * 2
        return dict(gpu0=0, gpu1=base, gpuc=0,
                    decode_gpu='gpu1', output_n=DECODE_PER_PHASE * 2,
                    nvl=0, net=0, phase='nodefull',
                    warn=False, node_full=True,
                    caption='Node A all GPUs full! Must scale out to Node C')
    elif f <= 35:
        t = f - 26
        total = PROMPT_N + DECODE_PER_PHASE * 2
        moved = min(t + 1, total)
        return dict(gpu0=0, gpu1=total - moved, gpuc=moved,
                    decode_gpu=None, output_n=DECODE_PER_PHASE * 2,
                    nvl=0, net=moved/total, phase='scaleout',
                    warn=False, node_full=False,
                    caption=f'Scale-Out: RDMA transfer {moved}/{total} KV rows to Node C')
    else:
        d = f - 35
        base = PROMPT_N + DECODE_PER_PHASE * 2
        return dict(gpu0=0, gpu1=0, gpuc=base + d,
                    decode_gpu='gpuc', output_n=DECODE_PER_PHASE * 2 + d,
                    nvl=0, net=0, phase='decodec',
                    warn=False, node_full=False,
                    caption=f'Decode on Node C: output "{OUTPUT_WORDS[min(DECODE_PER_PHASE*2+d-1, len(OUTPUT_WORDS)-1)]}", KV grows remotely')


def render(f):
    fig, ax = plt.subplots(figsize=(15, 7.2))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, W)
    ax.set_ylim(0, H)
    ax.set_aspect('equal')
    ax.axis('off')

    s = state(f)

    # ---- 标题颜色 ----
    phase_color = {
        'prefill': GPU0_C, 'decode0': GREEN, 'oom': RED,
        'scaleup': GPU1_C, 'decode1': GREEN,
        'nodefull': RED, 'scaleout': NODEC_C, 'decodec': GREEN,
    }
    phase_label = {
        'prefill': 'Prefill', 'decode0': 'Decode (GPU-0)', 'oom': 'Memory Full!',
        'scaleup': 'Scale-Up (NVLink)', 'decode1': 'Decode (GPU-1)',
        'nodefull': 'Node A Full!', 'scaleout': 'Scale-Out (RDMA)', 'decodec': 'Decode (Node C)',
    }

    ax.text(W/2, H - 4, f'KV Cache Migration  --  {phase_label[s["phase"]]}',
           ha='center', fontsize=15, color=phase_color[s['phase']], fontweight='bold')
    ax.text(W/2, H - 12, s['caption'], ha='center', fontsize=9, color=TEXT)

    # ---- Node A ----
    na_has = s['gpu0'] + s['gpu1'] > 0
    box(ax, NA_X, NA_Y, NA_W, NA_H, PANEL,
        ec=RED if s['node_full'] else (GPU0_C if na_has else DIM),
        lw=2.5 if na_has else 1, r=0.5)
    ax.text(NA_X + NA_W/2, NA_Y + NA_H - 4, 'Node A', ha='center', fontsize=12,
           color=RED if s['node_full'] else (GPU0_C if na_has else DIM), fontweight='bold')

    # GPU-0
    g0_on = s['gpu0'] > 0 or s['decode_gpu'] == 'gpu0'
    box(ax, G0_X, G0_Y, G0_W, G0_H, DARK, alpha=0.5,
        ec=RED if s['warn'] else (GPU0_C if g0_on else DIM),
        lw=1.5 if g0_on else 0.6, r=0.25)
    ax.text(G0_X + G0_W/2, G0_Y + G0_H - 4, 'GPU-0', ha='center', fontsize=9,
           color=GPU0_C if g0_on else DIM, fontweight='bold')
    if s['decode_gpu'] == 'gpu0':
        ax.text(G0_X + G0_W/2, G0_Y + G0_H - 12, 'decoding...', ha='center',
               fontsize=8, color=GREEN, fontweight='bold')

    # GPU-1
    g1_on = s['gpu1'] > 0 or s['decode_gpu'] == 'gpu1'
    box(ax, G1_X, G1_Y, G1_W, G1_H, DARK, alpha=0.5,
        ec=GPU1_C if g1_on else DIM, lw=1.5 if g1_on else 0.6, r=0.25)
    ax.text(G1_X + G1_W/2, G1_Y + G1_H - 4, 'GPU-1', ha='center', fontsize=9,
           color=GPU1_C if g1_on else DIM, fontweight='bold')
    if s['decode_gpu'] == 'gpu1':
        ax.text(G1_X + G1_W/2, G1_Y + G1_H - 12, 'decoding...', ha='center',
               fontsize=8, color=GREEN, fontweight='bold')

    # ---- Node C ----
    gc_on = s['gpuc'] > 0 or s['decode_gpu'] == 'gpuc'
    box(ax, NC_X, NC_Y, NC_W, NC_H, PANEL,
        ec=NODEC_C if gc_on else DIM, lw=2.5 if gc_on else 1, r=0.5)
    ax.text(NC_X + NC_W/2, NC_Y + NC_H - 4, 'Node C', ha='center', fontsize=12,
           color=NODEC_C if gc_on else DIM, fontweight='bold')
    box(ax, GC_X, GC_Y, GC_W, GC_H, DARK, alpha=0.5,
        ec=NODEC_C if gc_on else DIM, lw=1.5 if gc_on else 0.6, r=0.25)
    ax.text(GC_X + GC_W/2, GC_Y + GC_H - 4, 'GPU-C', ha='center', fontsize=9,
           color=NODEC_C if gc_on else DIM, fontweight='bold')
    if s['decode_gpu'] == 'gpuc':
        ax.text(GC_X + GC_W/2, GC_Y + GC_H - 12, 'decoding...', ha='center',
               fontsize=8, color=GREEN, fontweight='bold')

    # ---- KV 块 ----
    def draw_stack(x, top, n, active_alpha=1.0, newest_glow=False):
        for i in range(n):
            y = top - i * ROW_STEP
            glow = newest_glow and (i == n - 1)
            is_decode = i >= PROMPT_N  # 超过 prompt 部分的是 decode 行
            draw_kv_row(ax, x, y, alpha=active_alpha, glow=glow, decode=is_decode)

    # GPU-0 上的 KV
    if s['gpu0'] > 0:
        a = 0.4 if s['phase'] == 'scaleup' else 1.0
        newest = s['phase'] in ('prefill', 'decode0')
        draw_stack(KV0_X, KV0_TOP, s['gpu0'], a, newest)

    # GPU-1 上的 KV
    if s['gpu1'] > 0:
        a = 0.4 if s['phase'] == 'scaleout' else 1.0
        newest = s['phase'] in ('decode1', 'scaleup')
        draw_stack(KV1_X, KV1_TOP, s['gpu1'], a, newest)

    # Node C 上的 KV
    if s['gpuc'] > 0:
        newest = s['phase'] in ('decodec', 'scaleout')
        draw_stack(KVC_X, KVC_TOP, s['gpuc'], 1.0, newest)

    # ---- 内存条 ----
    draw_mem_bar(ax, MEM0_X, G0_Y + 2, s['gpu0'] / MAX_CAP, GPU0_C, warn=s['warn'])
    draw_mem_bar(ax, MEM1_X, G1_Y + 2, s['gpu1'] / MAX_CAP, GPU1_C, warn=s['node_full'])
    draw_mem_bar(ax, MEMC_X, GC_Y + 2, s['gpuc'] / MAX_CAP, NODEC_C)

    # ---- 管道 ----
    draw_pipe(ax, NVL_X1, NVL_X2, NVL_Y, s['nvl'], 'NVLink 900GB/s',
             active=(s['phase'] == 'scaleup'))
    draw_pipe(ax, NET_X1, NET_X2, NET_Y, s['net'], 'RDMA 400Gb/s',
             active=(s['phase'] == 'scaleout'))

    # ---- Decode 输出 token ----
    out_n = s['output_n']
    if out_n > 0 and s['decode_gpu'] is not None:
        # 输出区域放在对应 GPU 上方
        if s['decode_gpu'] == 'gpu0':
            ox = G0_X + 3
        elif s['decode_gpu'] == 'gpu1':
            ox = G1_X + 3
        else:
            ox = GC_X + 10
        oy = 132
        ax.text(ox, oy + 8, 'Output:', ha='left', fontsize=7, color=PINK)
        shown = OUTPUT_WORDS[:min(out_n, len(OUTPUT_WORDS))]
        # 最多显示最近 4 个
        visible = shown[-4:]
        for ti, tok in enumerate(visible):
            is_last = (ti == len(visible) - 1)
            bx = ox + ti * 16
            box(ax, bx, oy, 14, 7, PINK, alpha=1.0 if is_last else 0.6,
                ec='white' if is_last else 'none', lw=1.2 if is_last else 0, r=0.2)
            ax.text(bx + 7, oy + 3.5, tok, ha='center', va='center',
                   fontsize=7, color='white', fontweight='bold')
        if len(shown) > 4:
            ax.text(ox - 3, oy + 3.5, '...', ha='right', fontsize=8, color=DIM)

    # ---- 底部时间线 ----
    tl_y = 6
    tl_x0 = 20
    tl_w = 280
    segs = [
        (0, 5, 'Prefill', GPU0_C),
        (6, 10, 'Decode', GREEN),
        (11, 20, 'Scale-Up', GPU1_C),
        (21, 25, 'Decode', GREEN),
        (26, 35, 'Scale-Out', NODEC_C),
        (36, 39, 'Decode', GREEN),
    ]
    for (f0, f1, lbl, c) in segs:
        px0 = tl_x0 + f0 / TOTAL * tl_w
        px1 = tl_x0 + (f1 + 1) / TOTAL * tl_w
        pw = px1 - px0
        box(ax, px0, tl_y, pw, 5, PANEL, ec=DIM, lw=0.5, r=0.1)
        if f >= f0:
            fill = min((f - f0 + 1) / (f1 - f0 + 1), 1.0)
            box(ax, px0, tl_y, pw * fill, 5, c, alpha=0.5, r=0.1)
        ax.text(px0 + pw/2, tl_y + 2.5, lbl, ha='center', va='center',
               fontsize=6.5, color='white' if f0 <= f <= f1 else DIM, fontweight='bold')
    # 指针
    cx = tl_x0 + (f + 0.5) / TOTAL * tl_w
    ax.plot(cx, tl_y + 6.5, 'v', color=GOLD, markersize=5)

    plt.tight_layout(pad=0.3)
    return fig


# ============================================================
print(f"Generating {TOTAL} frames...")

imgs = []
for i in range(TOTAL):
    fig = render(i)
    fig.canvas.draw()
    buf = np.asarray(fig.canvas.buffer_rgba())[:, :, :3].copy()
    imgs.append(Image.fromarray(buf))
    plt.close(fig)
    if (i + 1) % 10 == 0:
        print(f"  {i+1}/{TOTAL}")

durations = [700] * TOTAL
durations[5] = 1200
durations[9] = 1000
durations[10] = 1500
durations[20] = 1200
durations[24] = 1000
durations[25] = 1500
durations[35] = 1200
durations[39] = 2500

out = 'docs/slides/kv_cache_migration.gif'
imgs[0].save(out, save_all=True, append_images=imgs[1:],
             duration=durations, loop=0, optimize=True)

print(f"\nSaved: {out}")
print(f"Frames: {TOTAL}, Duration: {sum(durations)/1000:.1f}s")

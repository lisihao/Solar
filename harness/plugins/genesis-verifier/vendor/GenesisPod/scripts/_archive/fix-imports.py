#!/usr/bin/env python3
"""批量更新 ai-engine 目录重构后的 import 路径"""
import os, re, sys

root = os.path.join(os.path.dirname(__file__), '..', 'backend', 'src')
root = os.path.normpath(root)

# 参数: phase 名称
phase = sys.argv[1] if len(sys.argv) > 1 else 'safety'

# 定义各 phase 的替换规则: (旧目录段, 新目录段, 跳过前缀)
PHASES = {
    'safety': [
        ('guardrails', 'safety/guardrails', 'ai-engine/safety'),
        ('constraint', 'safety/constraint', 'ai-engine/safety'),
        ('quality',    'safety/quality',    'ai-engine/safety'),
    ],
    'infra': [
        ('observability', 'infra/observability', 'ai-engine/infra'),
        ('realtime',      'infra/realtime',      'ai-engine/infra'),
        ('a2a',           'infra/a2a',           'ai-engine/infra'),
    ],
    'knowledge': [
        ('rag',      'knowledge/rag',      'ai-engine/knowledge'),
        ('memory',   'knowledge/memory',   'ai-engine/knowledge'),
        ('search',   'knowledge/search',   'ai-engine/knowledge'),
        ('evidence', 'knowledge/evidence', 'ai-engine/knowledge'),
    ],
    'content': [
        ('image',            'content/image',    'ai-engine/content'),
        ('long-content',     'content/long-form','ai-engine/content'),
        ('content-analysis', 'content/analysis', 'ai-engine/content'),
        ('content-fetch',    'content/fetch',    'ai-engine/content'),
        ('synthesis',        'content/synthesis','ai-engine/content'),
    ],
    'core': [
        ('common',     'core/utils',      'ai-engine/core'),
        ('interfaces', 'core/interfaces', 'ai-engine/core'),
        ('prompts',    'llm/prompts',     'ai-engine/llm/prompts'),
        ('capabilities','orchestration/capabilities','ai-engine/orchestration'),
    ],
    'agents': [
        ('collaboration', 'agents/collaboration', 'ai-engine/agents'),
    ],
}

rules = PHASES.get(phase, [])
if not rules:
    print(f"Unknown phase: {phase}. Available: {list(PHASES.keys())}")
    sys.exit(1)

# 找所有 .ts 文件
ts_files = []
for dirpath, dirnames, filenames in os.walk(root):
    for f in filenames:
        if f.endswith('.ts'):
            ts_files.append(os.path.join(dirpath, f))

def fix_imports(content, rules):
    new = content
    for old_dir, new_dir, skip_prefix in rules:
        # 只替换 ai-engine 路径中的目录段
        # 方案1: 路径中含有 ai-engine 字段
        # 方案2: 路径以 ../../ 开头（跨模块相对路径）且目录正好是 OLD_DIR
        #
        # 精准匹配：
        # - from '...ai-engine/OLD_DIR/...'  → 绝对路径别名(@/)
        # - from '......./ai-engine/OLD_DIR' → 多层相对路径
        # 不匹配：
        # - from '../services/OLD_DIR/...'   → 同模块本地路径（前面没有ai-engine）
        patterns = [
            # @/ 别名路径: from '@/modules/ai-engine/quality/...'
            (r"(from\s+['\"]@/[^'\"]*?/ai-engine/)(" + re.escape(old_dir) + r")/",
             r"\1" + new_dir + r"/"),
            # 相对路径中含有 ai-engine 段: from '../../ai-engine/quality/...'
            (r"(from\s+['\"](?:\.\./)+[^'\"]*?/ai-engine/)(" + re.escape(old_dir) + r")/",
             r"\1" + new_dir + r"/"),
        ]
        for pat, repl in patterns:
            new = re.sub(pat, repl, new)
    return new

changes = []
for fpath in ts_files:
    norm = fpath.replace('\\', '/')
    # 跳过目标目录自身（其内部相对路径不变）
    skip = False
    for old_dir, new_dir, skip_prefix in rules:
        if skip_prefix in norm:
            skip = True
            break
    if skip:
        continue

    with open(fpath, 'r', encoding='utf-8') as f:
        orig = f.read()
    fixed = fix_imports(orig, rules)
    if fixed != orig:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(fixed)
        changes.append(fpath.replace(root, '').lstrip('/\\'))

print(f"Phase [{phase}]: 已更新 {len(changes)} 个文件")
for c in changes:
    print(f"  {c}")

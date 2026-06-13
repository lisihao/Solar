'use client';

/**
 * AI 前瞻（Foresight）—— 判断资产 / 假设图谱。
 *
 * P0：假设卡 + 加权影响边（衰减传播）+ 信号注入 + 复核工作流（置信度账本）+
 * 决策级结论。设计来源 docs/demos/insight-graph-demo.html v0.4。
 */

import AppShell from '@/components/layout/AppShell';
import { ForesightView } from '@/components/foresight/ForesightView';

export default function ForesightPage() {
  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <ForesightView />
      </main>
    </AppShell>
  );
}

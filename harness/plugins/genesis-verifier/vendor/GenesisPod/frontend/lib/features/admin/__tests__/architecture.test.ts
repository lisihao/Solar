import { beforeEach, describe, expect, it } from 'vitest';

import {
  ARCHITECTURE_LAYERS,
  LAYER_STYLES,
  type ArchitectureCard,
  type ArchitectureLayer,
} from '../architecture';

function getLayer(id: string): ArchitectureLayer {
  const layer = ARCHITECTURE_LAYERS.find((item) => item.id === id);
  expect(layer).toBeDefined();
  return layer as ArchitectureLayer;
}

describe('ARCHITECTURE_LAYERS', () => {
  // 2026-05-12: L4 Open API 已从首页隐藏（prototype 阶段, 不属于运维日常视角）,
  // openApiLayer 定义保留但不导出。
  it('contains the four visible backend-aligned layers', () => {
    expect(ARCHITECTURE_LAYERS).toHaveLength(4);
    expect(ARCHITECTURE_LAYERS.map((layer) => layer.id)).toEqual([
      'aiApps',
      'aiHarness',
      'aiEngine',
      'infrastructure',
    ]);
    expect(ARCHITECTURE_LAYERS.map((layer) => layer.level)).toEqual([
      3, 5, 2, 1,
    ]);
  });

  it('every layer has a non-empty titleKey and id', () => {
    for (const layer of ARCHITECTURE_LAYERS) {
      expect(layer.id).toBeTruthy();
      expect(layer.titleKey).toBeTruthy();
    }
  });
});

describe('AI Harness layer', () => {
  // Wave 5 重构（2026-05-11）：8 卡精简为 4 张实体卡，对齐 AI Infra L1 范式。
  // 4 卡：harnessExecution / harnessMemory / harnessGovernance / harnessInterop
  let layer: ArchitectureLayer;

  beforeEach(() => {
    layer = getLayer('aiHarness');
  });

  it('has four entity cards (execution / memory / governance / interop)', () => {
    expect(layer.level).toBe(5);
    expect(layer.cards).toHaveLength(4);
    expect(layer.groups).toBeUndefined();

    const ids = layer.cards?.map((c) => c.id);
    expect(ids).toEqual([
      'harnessExecution',
      'harnessMemory',
      'harnessGovernance',
      'harnessInterop',
    ]);
  });

  it('makes every harness subsystem card configurable', () => {
    for (const card of layer.cards ?? []) {
      expect(card.clickable).toBe(true);
      expect(card.href).toBeTruthy();
    }
  });

  it('routes 4 harness cards into the /admin/ai/harness hub tabs', () => {
    const expectedCards: Array<{ id: string; href: string }> = [
      { id: 'harnessExecution', href: '/admin/ai/harness?tab=execution' },
      { id: 'harnessMemory', href: '/admin/ai/harness?tab=memory' },
      { id: 'harnessGovernance', href: '/admin/ai/harness?tab=governance' },
      { id: 'harnessInterop', href: '/admin/ai/harness?tab=interop' },
    ];

    for (const { id, href } of expectedCards) {
      const card = layer.cards?.find((item) => item.id === id);
      expect(card?.clickable).toBe(true);
      expect(card?.href).toBe(href);
    }
  });

  it('uses harness-native stats keys', () => {
    const statsByCard = new Map(
      layer.cards?.map((card) => [
        card.id,
        card.stats?.map((stat) => stat.key) ?? [],
      ])
    );

    expect(statsByCard.get('harnessExecution')).toEqual([
      'kernelRunning',
      'agentTraces',
    ]);
    expect(statsByCard.get('harnessMemory')).toEqual(['kernelMemories']);
    expect(statsByCard.get('harnessGovernance')).toEqual([
      'harnessEvalRuns',
      'guardrailRules',
    ]);
    expect(statsByCard.get('harnessInterop')).toEqual(['kernelSubscriptions']);
  });
});

// Open API layer (L4) 已从首页隐藏（2026-05-12），openApiLayer 定义保留但不导出.
// 启用时取消 architecture.ts ARCHITECTURE_LAYERS 中 openApiLayer 注释 + 恢复本 describe.
describe.skip('Open API layer (hidden)', () => {
  it('contains the externally visible API surface', () => {
    const layer = getLayer('openApi');
    expect(layer.cards).toHaveLength(5);
    expect(layer.cards?.find((card) => card.id === 'mcpServer')?.href).toBe(
      '/admin/system?tab=settings'
    );
  });
});

describe('AI Engine layer', () => {
  let layer: ArchitectureLayer;

  beforeEach(() => {
    layer = getLayer('aiEngine');
  });

  // 2026-05-11 Wave: L2 Engine 与 L1 Infra 同模式重构 — 4 张大卡（无 sub-group），
  //   对应 4 实体：模型 / 工具 / 技能 / 知识。原 7 卡 + engineCore group 结构作废，
  //   agents/teams/guardrails 移到 sidebar（架构合规上属 L2.5 Harness）。
  it('has 4 entity cards (models / tools / skills / knowledge) without sub-groups', () => {
    expect(layer.groups).toBeUndefined();
    expect(layer.cards).toHaveLength(4);

    const ids = layer.cards?.map((c) => c.id);
    expect(ids).toEqual(['models', 'tools', 'skills', 'knowledge']);
  });

  it('routes the 4 entity cards to their admin pages', () => {
    const expectedCards: Array<{ id: string; href: string }> = [
      { id: 'models', href: '/admin/ai/models' },
      { id: 'tools', href: '/admin/ai/tools' },
      { id: 'skills', href: '/admin/ai/skills' },
      { id: 'knowledge', href: '/admin/ai/knowledge' },
    ];

    for (const { id, href } of expectedCards) {
      const card = layer.cards?.find((item) => item.id === id);
      expect(card?.clickable).toBe(true);
      expect(card?.href).toBe(href);
    }
  });
});

describe('Infrastructure layer', () => {
  // Wave 4 (2026-05-11): L1 重构为 4 张大卡（无 groups），对应 4 实体
  // 用户 / 密钥 / 数据 / 系统。旧 4-group × 12 卡结构已被替代。
  it('has 4 entity cards (user / secret / data / system) without sub-groups', () => {
    const layer = getLayer('infrastructure');
    expect(layer.groups).toBeUndefined();
    expect(layer.cards).toHaveLength(4);

    const ids = layer.cards?.map((c) => c.id);
    expect(ids).toEqual([
      'userManagement',
      'secretManagement',
      'dataManagement',
      'systemManagement',
    ]);
  });

  it('system management card links to /admin/system with monitoring stats', () => {
    const layer = getLayer('infrastructure');
    const systemCard = layer.cards?.find((c) => c.id === 'systemManagement');
    expect(systemCard?.href).toBe('/admin/system');
    expect(systemCard?.stats?.map((stat) => stat.key)).toEqual([
      'kernelLLMCalls',
      'monitoringErrors',
    ]);
  });

  it('all 4 cards are clickable and point to their merged hubs', () => {
    const layer = getLayer('infrastructure');
    const expected: Record<string, string> = {
      userManagement: '/admin/access/users',
      secretManagement: '/admin/access/secrets',
      dataManagement: '/admin/data',
      systemManagement: '/admin/system',
    };
    for (const card of layer.cards ?? []) {
      expect(card.clickable).toBe(true);
      expect(card.href).toBe(expected[card.id]);
    }
  });
});

describe('LAYER_STYLES', () => {
  it('has style entries for levels 1-5', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(LAYER_STYLES[level]).toBeDefined();
    }
  });

  it('uses distinct layer themes', () => {
    expect(LAYER_STYLES[5].badge).toContain('teal');
    expect(LAYER_STYLES[4].badge).toContain('orange');
    expect(LAYER_STYLES[3].badge).toContain('violet');
    expect(LAYER_STYLES[2].badge).toContain('blue');
    expect(LAYER_STYLES[1].badge).toContain('emerald');
  });
});

describe('card structure invariants', () => {
  function getAllCards(): ArchitectureCard[] {
    const cards: ArchitectureCard[] = [];
    for (const layer of ARCHITECTURE_LAYERS) {
      if (layer.cards) cards.push(...layer.cards);
      if (layer.groups) {
        for (const group of layer.groups) cards.push(...group.cards);
      }
    }
    return cards;
  }

  it('all cards have id, i18nKey, icon, and clickable fields', () => {
    for (const card of getAllCards()) {
      expect(card.id).toBeTruthy();
      expect(card.i18nKey).toBeTruthy();
      expect(card.icon).toBeDefined();
      expect(typeof card.clickable).toBe('boolean');
    }
  });

  it('clickable cards have an href', () => {
    for (const card of getAllCards().filter((item) => item.clickable)) {
      expect(card.href).toBeTruthy();
    }
  });

  it('stats have label and key fields when present', () => {
    for (const card of getAllCards()) {
      for (const stat of card.stats ?? []) {
        expect(stat.label).toBeTruthy();
        expect(stat.key).toBeTruthy();
      }
    }
  });
});

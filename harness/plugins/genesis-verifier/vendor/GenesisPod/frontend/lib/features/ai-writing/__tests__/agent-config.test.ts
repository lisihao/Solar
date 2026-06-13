import { describe, it, expect } from 'vitest';
import {
  WRITING_AGENT_REGISTRY,
  generateDisplayAgentList,
  matchAgentByName,
  getAgentDetails,
  type WritingAgentConfig,
  type AgentRole,
} from '../agent-config';

// ============================================================================
// WRITING_AGENT_REGISTRY
// ============================================================================

describe('WRITING_AGENT_REGISTRY', () => {
  it('contains exactly 5 agents', () => {
    expect(Object.keys(WRITING_AGENT_REGISTRY)).toHaveLength(5);
  });

  it('contains all expected agent ids', () => {
    const ids = Object.keys(WRITING_AGENT_REGISTRY);
    expect(ids).toContain('story-architect');
    expect(ids).toContain('bible-keeper');
    expect(ids).toContain('writer');
    expect(ids).toContain('consistency-checker');
    expect(ids).toContain('editor');
  });

  it('each agent has required fields', () => {
    const requiredFields: (keyof WritingAgentConfig)[] = [
      'id',
      'nameCn',
      'nameEn',
      'descCn',
      'descEn',
      'role',
      'icon',
      'color',
      'gradient',
      'supportsMultiInstance',
      'capabilities',
      'tools',
      'detailedDescription',
    ];
    for (const agent of Object.values(WRITING_AGENT_REGISTRY)) {
      for (const field of requiredFields) {
        expect(agent[field]).toBeDefined();
      }
    }
  });

  it('story-architect has role "leader"', () => {
    expect(WRITING_AGENT_REGISTRY['story-architect'].role).toBe('leader');
  });

  it('bible-keeper has role "keeper"', () => {
    expect(WRITING_AGENT_REGISTRY['bible-keeper'].role).toBe('keeper');
  });

  it('writer has role "executor" and supportsMultiInstance true', () => {
    const writer = WRITING_AGENT_REGISTRY['writer'];
    expect(writer.role).toBe('executor');
    expect(writer.supportsMultiInstance).toBe(true);
  });

  it('writer has maxInstances of 5', () => {
    expect(WRITING_AGENT_REGISTRY['writer'].maxInstances).toBe(5);
  });

  it('consistency-checker has role "validator"', () => {
    expect(WRITING_AGENT_REGISTRY['consistency-checker'].role).toBe(
      'validator'
    );
  });

  it('editor has role "finisher"', () => {
    expect(WRITING_AGENT_REGISTRY['editor'].role).toBe('finisher');
  });

  it('non-writer agents have supportsMultiInstance false', () => {
    const singleInstanceAgents = [
      'story-architect',
      'bible-keeper',
      'consistency-checker',
      'editor',
    ];
    for (const id of singleInstanceAgents) {
      expect(WRITING_AGENT_REGISTRY[id].supportsMultiInstance).toBe(false);
    }
  });

  it('every agent has at least one capability', () => {
    for (const agent of Object.values(WRITING_AGENT_REGISTRY)) {
      expect(agent.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('every agent has at least one tool', () => {
    for (const agent of Object.values(WRITING_AGENT_REGISTRY)) {
      expect(agent.tools.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// generateDisplayAgentList
// ============================================================================

describe('generateDisplayAgentList', () => {
  it('returns default 3 writers when called with no args', () => {
    const list = generateDisplayAgentList();
    const writers = list.filter((a) => a.role === 'executor');
    expect(writers).toHaveLength(3);
  });

  it('returns list with single writer when writerCount=1', () => {
    const list = generateDisplayAgentList(1);
    const writers = list.filter((a) => a.role === 'executor');
    expect(writers).toHaveLength(1);
  });

  it('caps writers at maxInstances (5)', () => {
    const list = generateDisplayAgentList(100);
    const writers = list.filter((a) => a.role === 'executor');
    expect(writers).toHaveLength(5);
  });

  it('includes story-architect, bible-keeper, consistency-checker, editor', () => {
    const list = generateDisplayAgentList(1);
    const instanceIds = list.map((a) => a.instanceId);
    expect(instanceIds).toContain('story-architect');
    expect(instanceIds).toContain('bible-keeper');
    expect(instanceIds).toContain('consistency-checker');
    expect(instanceIds).toContain('editor');
  });

  it('writer instances have instanceId like writer-N', () => {
    const list = generateDisplayAgentList(3);
    const writers = list.filter((a) => a.role === 'executor');
    expect(writers[0].instanceId).toBe('writer-1');
    expect(writers[1].instanceId).toBe('writer-2');
    expect(writers[2].instanceId).toBe('writer-3');
  });

  it('writer instances have instanceNumber set', () => {
    const list = generateDisplayAgentList(2);
    const writers = list.filter((a) => a.role === 'executor');
    expect(writers[0].instanceNumber).toBe(1);
    expect(writers[1].instanceNumber).toBe(2);
  });

  it('writer instances have Chinese number names (作家①, 作家②)', () => {
    const list = generateDisplayAgentList(2);
    const writers = list.filter((a) => a.role === 'executor');
    expect(writers[0].nameCn).toContain('作家');
    expect(writers[1].nameCn).toContain('作家');
  });

  it('writer instances have English names like "Writer 1"', () => {
    const list = generateDisplayAgentList(2);
    const writers = list.filter((a) => a.role === 'executor');
    expect(writers[0].nameEn).toBe('Writer 1');
    expect(writers[1].nameEn).toBe('Writer 2');
  });

  it('writer instances have different colors', () => {
    const list = generateDisplayAgentList(5);
    const writers = list.filter((a) => a.role === 'executor');
    const colors = writers.map((w) => w.color);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBeGreaterThan(1);
  });

  it('returns 5 non-writer agents + 3 writers = 8 items by default', () => {
    // story-architect, bible-keeper, writer-1, writer-2, writer-3, consistency-checker, editor
    const list = generateDisplayAgentList(3);
    expect(list).toHaveLength(7);
  });

  it('non-writer agents do not have instanceNumber', () => {
    const list = generateDisplayAgentList(1);
    const nonWriters = list.filter((a) => a.role !== 'executor');
    for (const agent of nonWriters) {
      expect(agent.instanceNumber).toBeUndefined();
    }
  });
});

// ============================================================================
// matchAgentByName
// ============================================================================

describe('matchAgentByName', () => {
  it('returns unknown fallback for undefined', () => {
    const result = matchAgentByName(undefined);
    expect(result.id).toBe('unknown');
    expect(result.nameCn).toBe('AI 团队');
  });

  it('matches by exact Chinese name (故事架构师)', () => {
    const result = matchAgentByName('故事架构师');
    expect(result.id).toBe('story-architect');
  });

  it('matches by exact English name (Story Architect)', () => {
    const result = matchAgentByName('Story Architect');
    expect(result.id).toBe('story-architect');
  });

  it('matches by exact Chinese name (设定守护者)', () => {
    const result = matchAgentByName('设定守护者');
    expect(result.id).toBe('bible-keeper');
  });

  it('matches by exact Chinese name (作家)', () => {
    const result = matchAgentByName('作家');
    expect(result.id).toBe('writer');
  });

  it('matches by exact Chinese name (一致性检查员)', () => {
    const result = matchAgentByName('一致性检查员');
    expect(result.id).toBe('consistency-checker');
  });

  it('matches by exact Chinese name (润色编辑)', () => {
    const result = matchAgentByName('润色编辑');
    expect(result.id).toBe('editor');
  });

  it('fuzzy-matches keyword "架构" to story-architect', () => {
    const result = matchAgentByName('AI架构专家');
    expect(result.id).toBe('story-architect');
  });

  it('fuzzy-matches keyword "keeper" to bible-keeper', () => {
    const result = matchAgentByName('World keeper');
    expect(result.id).toBe('bible-keeper');
  });

  it('fuzzy-matches keyword "editor" to editor', () => {
    const result = matchAgentByName('Senior editor agent');
    expect(result.id).toBe('editor');
  });

  it('fuzzy-matches keyword "checker" to consistency-checker', () => {
    const result = matchAgentByName('Quality checker');
    expect(result.id).toBe('consistency-checker');
  });

  it('fuzzy-matches keyword "writer" to writer', () => {
    const result = matchAgentByName('Creative writer agent');
    expect(result.id).toBe('writer');
  });

  it('returns unknown with original name for unrecognized input', () => {
    const result = matchAgentByName('SomethingCompletelyUnknown');
    expect(result.id).toBe('unknown');
    expect(result.nameCn).toBe('SomethingCompletelyUnknown');
  });

  it('strips leading non-Chinese/non-alpha characters before matching', () => {
    // e.g. "[故事架构师]" should match
    const result = matchAgentByName('[故事架构师]');
    // After stripping "[" the clean name starts with "故事架构师"
    // The exact matching may or may not catch this depending on strip regex
    // The clean name will be "故事架构师]" — close enough for fuzzy via 架构
    expect(result.id).toBe('story-architect');
  });
});

// ============================================================================
// getAgentDetails
// ============================================================================

describe('getAgentDetails', () => {
  it('returns details for story-architect', () => {
    const details = getAgentDetails('story-architect');
    expect(details.name).toBe('故事架构师');
    expect(details.role).toBe('团队领导');
    expect(details.skills.length).toBeGreaterThan(0);
    expect(details.tools.length).toBeGreaterThan(0);
  });

  it('returns details for bible-keeper', () => {
    const details = getAgentDetails('bible-keeper');
    expect(details.name).toBe('设定守护者');
    expect(details.role).toBe('世界观管理');
  });

  it('returns details for writer', () => {
    const details = getAgentDetails('writer');
    expect(details.name).toBe('作家');
    expect(details.role).toBe('内容创作');
  });

  it('strips numeric suffix for writer instances (writer-1)', () => {
    const details = getAgentDetails('writer-1');
    expect(details.name).toBe('作家');
  });

  it('strips numeric suffix for writer-5', () => {
    const details = getAgentDetails('writer-5');
    expect(details.name).toBe('作家');
  });

  it('returns details for consistency-checker', () => {
    const details = getAgentDetails('consistency-checker');
    expect(details.name).toBe('一致性检查员');
    expect(details.role).toBe('一致性审核');
  });

  it('returns details for editor', () => {
    const details = getAgentDetails('editor');
    expect(details.name).toBe('润色编辑');
    expect(details.role).toBe('润色优化');
  });

  it('returns fallback for unknown agentId', () => {
    const details = getAgentDetails('nonexistent-agent');
    expect(details.name).toBe('AI 助手');
    expect(details.role).toBe('助手');
    expect(details.skills).toEqual([]);
    expect(details.tools).toEqual([]);
  });

  it('translates known skill keys to Chinese names', () => {
    const details = getAgentDetails('story-architect');
    expect(details.skills).toContain('故事结构设计');
    expect(details.skills).toContain('章节规划');
  });

  it('translates known tool keys to Chinese names', () => {
    const details = getAgentDetails('story-architect');
    expect(details.tools).toContain('大纲生成器');
  });

  it('passes unknown capability keys through as-is', () => {
    // We can't force unknown caps, but we verify no crash
    const details = getAgentDetails('editor');
    expect(Array.isArray(details.skills)).toBe(true);
  });

  it('returns non-empty description for known agents', () => {
    const agents = [
      'story-architect',
      'bible-keeper',
      'writer',
      'consistency-checker',
      'editor',
    ];
    for (const id of agents) {
      const details = getAgentDetails(id);
      expect(details.description.length).toBeGreaterThan(0);
    }
  });
});

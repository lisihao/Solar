/**
 * SOTA-gap 接线回归看护 spec
 *
 * 背景：ai-harness vs SOTA 评估的头号系统性问题是「造好却没接线」——能力代码完整
 * 实现，但从无 live 调用点（LLM planner / adaptive replanner / vector store 召回）。
 * 这些已在 G1（T6/T7）/ G2 修复接通。本 spec 锁死它们**不退化**回 disconnected：
 * 任一调用点被删 → CI 拒绝合并。
 *
 * 看护方式：读源码断言关键调用点存在（与 c5-c6-snapshot-contract.spec.ts 同款静态守护）。
 */
import { readFileSync } from "fs";
import { join } from "path";

const HARNESS = join(__dirname, "../../../modules/ai-harness");
const read = (rel: string): string => readFileSync(join(HARNESS, rel), "utf8");

describe("SOTA-gap 接线回归看护（anti「built but disconnected」）", () => {
  describe("G1-T6: LLM 动态分解必须被 plan() 调用", () => {
    const orchestrator = "teams/orchestrator/teams-mission-orchestrator.ts";

    it("orchestrator 从 ./dynamic-planning 导入并调用 tryDynamicDecomposition", () => {
      const src = read(orchestrator);
      expect(src).toMatch(/from\s+["']\.\/dynamic-planning["']/);
      expect(src).toMatch(/await\s+tryDynamicDecomposition\(/);
    });

    it("dynamic-planning 实际调用 leader.decomposeTask（而非空转）", () => {
      const src = read("teams/orchestrator/dynamic-planning.ts");
      expect(src).toMatch(/\.decomposeTask\(/);
      // 必须先 seed availableRoles，否则 LLM 只见 "researcher"
      expect(src).toMatch(/setAvailableRoles\(/);
    });
  });

  describe("G1-T7: 自适应 replan 结果必须被应用到 plan", () => {
    const orchestrator = "teams/orchestrator/teams-mission-orchestrator.ts";

    it("orchestrator 调用 adaptiveReplanner.applyToPlan（不再是 TODO 丢弃）", () => {
      const src = read(orchestrator);
      expect(src).toMatch(/\.applyToPlan\(/);
      // 旧的「算了就扔」TODO 不得复活
      expect(src).not.toMatch(/TODO\(Phase 4\): Apply replanResult/);
    });

    it("replanner 实现了 applyToPlan 且会改写 plan.steps", () => {
      const src = read("teams/orchestrator/adaptive-replanner.service.ts");
      expect(src).toMatch(/applyToPlan\(/);
      expect(src).toMatch(/plan\.steps\s*=/);
    });
  });

  describe("G2: 语义向量召回必须接进 MemoryCoordinator", () => {
    const coordinator = "memory/coordinator/memory-coordinator.service.ts";

    it("coordinator 在召回路径调用 vectorStore.recall（而非仅精确 key）", () => {
      const src = read(coordinator);
      expect(src).toMatch(/this\.vectorStore\.recall\(/);
      expect(src).toMatch(/recallLayer3Semantic\(/);
    });

    it("coordinator 写入路径把长期记忆索引进向量库", () => {
      const src = read(coordinator);
      expect(src).toMatch(/this\.vectorStore\.add\(/);
      expect(src).toMatch(/indexToVector\(/);
    });

    it("embedder 经真实 DI token 注入（接口无法按类型注入，防静默 undefined）", () => {
      const src = read(coordinator);
      expect(src).toMatch(/MEMORY_EMBEDDER/);
      expect(src).toMatch(/@Inject\(MEMORY_EMBEDDER\)/);
    });
  });
});

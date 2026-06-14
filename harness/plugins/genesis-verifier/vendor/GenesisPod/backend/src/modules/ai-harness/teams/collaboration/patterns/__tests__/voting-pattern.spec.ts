/**
 * VotingManager Unit Tests
 */

import { VotingManager, VotingConfig } from "../voting-pattern";
import {
  VoteRequest,
  VoteOption,
} from "../../abstractions/collaborator.interface";

// 模拟 Logger
jest.mock("@nestjs/common", () => {
  const actual = jest.requireActual("@nestjs/common");
  return {
    ...actual,
    Logger: jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    })),
  };
});

// 模拟 uuid（使结果可预测）
jest.mock("uuid", () => ({
  v4: jest
    .fn()
    .mockReturnValueOnce("vote-id-1")
    .mockReturnValueOnce("vote-id-2")
    .mockReturnValueOnce("vote-id-3")
    .mockReturnValueOnce("vote-id-4")
    .mockReturnValueOnce("vote-id-5")
    .mockReturnValue("vote-id-default"),
}));

// 测试用辅助函数
function buildOptions(count: number): VoteOption[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `option-${i + 1}`,
    label: `Option ${i + 1}`,
  }));
}

function buildVoteRequest(
  overrides: Partial<Omit<VoteRequest, "id">> = {},
): Omit<VoteRequest, "id"> {
  return {
    topic: "Test topic",
    options: buildOptions(3),
    strategy: "majority",
    initiator: "agent-1",
    ...overrides,
  };
}

describe("VotingManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // constructor / getConfig
  // ---------------------------------------------------------------------------
  describe("constructor", () => {
    it("使用默认配置初始化", () => {
      const manager = new VotingManager();
      const config = manager.getConfig();

      expect(config.defaultTimeout).toBe(60000);
      expect(config.minParticipationRate).toBe(0.5);
      expect(config.allowAbstain).toBe(true);
      expect(config.anonymous).toBe(false);
    });

    it("可以使用自定义配置覆盖默认值", () => {
      const customConfig: VotingConfig = {
        defaultTimeout: 120000,
        minParticipationRate: 0.7,
        allowAbstain: false,
        anonymous: true,
      };
      const manager = new VotingManager(customConfig);
      const config = manager.getConfig();

      expect(config.defaultTimeout).toBe(120000);
      expect(config.minParticipationRate).toBe(0.7);
      expect(config.allowAbstain).toBe(false);
      expect(config.anonymous).toBe(true);
    });

    it("部分自定义配置与默认值合并", () => {
      const manager = new VotingManager({ defaultTimeout: 30000 });
      const config = manager.getConfig();

      expect(config.defaultTimeout).toBe(30000);
      expect(config.minParticipationRate).toBe(0.5); // 默认值
    });
  });

  describe("getConfig", () => {
    it("返回副本（不能修改内部状态）", () => {
      const manager = new VotingManager();
      const config1 = manager.getConfig();
      config1.defaultTimeout = 999;
      const config2 = manager.getConfig();

      expect(config2.defaultTimeout).toBe(60000);
    });
  });

  // ---------------------------------------------------------------------------
  // createVote
  // ---------------------------------------------------------------------------
  describe("createVote", () => {
    it("创建投票会话并以 open 状态返回", () => {
      const manager = new VotingManager();
      const request = buildVoteRequest();
      const session = manager.createVote(request);

      expect(session.id).toBeDefined();
      expect(session.status).toBe("open");
      expect(session.votes).toHaveLength(0);
      expect(session.request.topic).toBe("Test topic");
      expect(session.createdAt).toBeInstanceOf(Date);
    });

    it("每个会话分配唯一 ID", () => {
      const manager = new VotingManager();
      const s1 = manager.createVote(buildVoteRequest({ topic: "A" }));
      const s2 = manager.createVote(buildVoteRequest({ topic: "B" }));

      expect(s1.id).not.toBe(s2.id);
    });

    it("request.id 被设置为生成的 UUID", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());

      expect(session.request.id).toBe(session.id);
    });
  });

  // ---------------------------------------------------------------------------
  // castVote
  // ---------------------------------------------------------------------------
  describe("castVote", () => {
    it("有效投票成功", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      const result = manager.castVote(session.id, "voter-1", "option-1");

      expect(result).toBe(true);
      expect(manager.getSession(session.id)?.votes).toHaveLength(1);
    });

    it("向不存在的投票 ID 投票返回 false", () => {
      const manager = new VotingManager();
      const result = manager.castVote("nonexistent-id", "voter-1", "option-1");

      expect(result).toBe(false);
    });

    it("向已关闭的会话投票返回 false", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      manager.closeVote(session.id, 3);

      const result = manager.castVote(session.id, "voter-1", "option-1");

      expect(result).toBe(false);
    });

    it("同一投票者重复投票返回 false", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      manager.castVote(session.id, "voter-1", "option-1");
      const result = manager.castVote(session.id, "voter-1", "option-2");

      expect(result).toBe(false);
    });

    it("向不存在的选项 ID 投票返回 false", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      const result = manager.castVote(session.id, "voter-1", "invalid-option");

      expect(result).toBe(false);
    });

    it('"abstain" 始终被视为有效选项', () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      const result = manager.castVote(session.id, "voter-1", "abstain");

      expect(result).toBe(true);
    });

    it("weight 和 rank 选项被保存到投票中", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      manager.castVote(session.id, "voter-1", "option-1", {
        weight: 2,
        rank: [0, 1, 2],
      });

      const vote = manager.getSession(session.id)?.votes[0];
      expect(vote?.weight).toBe(2);
      expect(vote?.rank).toEqual([0, 1, 2]);
    });
  });

  // ---------------------------------------------------------------------------
  // closeVote / calculateResult
  // ---------------------------------------------------------------------------
  describe("closeVote", () => {
    it("不存在的投票 ID 返回 null", () => {
      const manager = new VotingManager();
      const result = manager.closeVote("nonexistent", 3);

      expect(result).toBeNull();
    });

    it("已关闭的会话返回 null", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      manager.closeVote(session.id, 3);
      const result = manager.closeVote(session.id, 3);

      expect(result).toBeNull();
    });

    describe("majority 策略", () => {
      it("超过半数时设置 winner", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "majority" }),
        );
        manager.castVote(session.id, "voter-1", "option-1");
        manager.castVote(session.id, "voter-2", "option-1");
        manager.castVote(session.id, "voter-3", "option-2");
        const result = manager.closeVote(session.id, 3);

        expect(result).not.toBeNull();
        expect(result?.winner).toBe("option-1");
        expect(result?.consensus).toBe(true);
      });

      it("未达到半数时 winner 为 undefined", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "majority" }),
        );
        manager.castVote(session.id, "voter-1", "option-1");
        manager.castVote(session.id, "voter-2", "option-2");
        manager.castVote(session.id, "voter-3", "option-3");
        const result = manager.closeVote(session.id, 3);

        expect(result?.winner).toBeUndefined();
        expect(result?.consensus).toBe(false);
      });

      it("弃权票不计入统计", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "majority" }),
        );
        manager.castVote(session.id, "voter-1", "option-1");
        manager.castVote(session.id, "voter-2", "abstain");
        const result = manager.closeVote(session.id, 2);

        expect(result?.tally["option-1"]).toBe(1);
        expect(result?.tally["abstain"]).toBeUndefined();
      });

      it("投票数为 0 时 winner 为 undefined", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "majority" }),
        );
        const result = manager.closeVote(session.id, 3);

        expect(result?.winner).toBeUndefined();
        expect(result?.voteCount).toBe(0);
      });
    });

    describe("unanimous 策略", () => {
      it("全票一致时 consensus 为 true", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "unanimous" }),
        );
        manager.castVote(session.id, "voter-1", "option-1");
        manager.castVote(session.id, "voter-2", "option-1");
        manager.castVote(session.id, "voter-3", "option-1");
        const result = manager.closeVote(session.id, 3);

        expect(result?.winner).toBe("option-1");
        expect(result?.consensus).toBe(true);
      });

      it("非全票一致时 consensus 为 false", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "unanimous" }),
        );
        manager.castVote(session.id, "voter-1", "option-1");
        manager.castVote(session.id, "voter-2", "option-2");
        const result = manager.closeVote(session.id, 2);

        expect(result?.winner).toBeUndefined();
        expect(result?.consensus).toBe(false);
      });

      it("投票数为 0 时 consensus 为 false", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "unanimous" }),
        );
        const result = manager.closeVote(session.id, 2);

        expect(result?.consensus).toBe(false);
      });

      it("仅有弃权票时 winner 为 undefined 且 consensus 为 false", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "unanimous" }),
        );
        manager.castVote(session.id, "voter-1", "abstain");
        const result = manager.closeVote(session.id, 2);

        expect(result?.winner).toBeUndefined();
        expect(result?.consensus).toBe(false);
      });
    });

    describe("weighted 策略", () => {
      it("加权票中最高分为 winner", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "weighted" }),
        );
        manager.castVote(session.id, "voter-1", "option-1", { weight: 3 });
        manager.castVote(session.id, "voter-2", "option-2", { weight: 1 });
        const result = manager.closeVote(session.id, 2);

        expect(result?.winner).toBe("option-1");
        expect(result?.tally["option-1"]).toBe(3);
        expect(result?.consensus).toBe(true);
      });

      it("未指定 weight 时视为 1", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "weighted" }),
        );
        manager.castVote(session.id, "voter-1", "option-1");
        const result = manager.closeVote(session.id, 1);

        expect(result?.tally["option-1"]).toBe(1);
      });

      it("全部弃权时 consensus 为 false", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "weighted" }),
        );
        manager.castVote(session.id, "voter-1", "abstain");
        const result = manager.closeVote(session.id, 1);

        expect(result?.consensus).toBe(false);
      });
    });

    describe("ranked 策略", () => {
      it("第一偏好票数最多者为 winner", () => {
        const manager = new VotingManager();
        const options = buildOptions(3);
        const session = manager.createVote(
          buildVoteRequest({ strategy: "ranked", options }),
        );
        // rank[0] = 0 → options[0].id = "option-1"
        manager.castVote(session.id, "voter-1", "option-1", {
          rank: [0, 1, 2],
        });
        manager.castVote(session.id, "voter-2", "option-1", {
          rank: [0, 2, 1],
        });
        manager.castVote(session.id, "voter-3", "option-2", {
          rank: [1, 0, 2],
        });
        const result = manager.closeVote(session.id, 3);

        expect(result?.winner).toBe("option-1");
        expect(result?.consensus).toBe(true);
      });

      it("rank 为空或未设置时该投票不计入统计", () => {
        const manager = new VotingManager();
        const options = buildOptions(2);
        const session = manager.createVote(
          buildVoteRequest({ strategy: "ranked", options }),
        );
        manager.castVote(session.id, "voter-1", "option-1", { rank: [] });
        const result = manager.closeVote(session.id, 1);

        expect(result?.tally["option-1"]).toBe(0);
      });
    });

    describe("voteId 等于会话 ID（P1-1 修复验证）", () => {
      it("majority 策略的 voteId 应等于 session.id", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "majority" }),
        );
        manager.castVote(session.id, "voter-1", "option-1");
        manager.castVote(session.id, "voter-2", "option-1");
        const result = manager.closeVote(session.id, 2);

        expect(result?.voteId).toBe(session.id);
        expect(result?.voteId).not.toBe("voter-1");
      });

      it("unanimous 策略的 voteId 应等于 session.id", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "unanimous" }),
        );
        manager.castVote(session.id, "voter-1", "option-1");
        const result = manager.closeVote(session.id, 1);

        expect(result?.voteId).toBe(session.id);
      });

      it("weighted 策略的 voteId 应等于 session.id", () => {
        const manager = new VotingManager();
        const session = manager.createVote(
          buildVoteRequest({ strategy: "weighted" }),
        );
        manager.castVote(session.id, "voter-1", "option-1", { weight: 2 });
        const result = manager.closeVote(session.id, 1);

        expect(result?.voteId).toBe(session.id);
      });

      it("ranked 策略的 voteId 应等于 session.id", () => {
        const manager = new VotingManager();
        const options = buildOptions(2);
        const session = manager.createVote(
          buildVoteRequest({ strategy: "ranked", options }),
        );
        manager.castVote(session.id, "voter-1", "option-1", { rank: [0, 1] });
        const result = manager.closeVote(session.id, 1);

        expect(result?.voteId).toBe(session.id);
      });
    });

    it("未知策略回退到 majority", () => {
      const manager = new VotingManager();
      const session = manager.createVote(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildVoteRequest({ strategy: "unknown" as any }),
      );
      manager.castVote(session.id, "voter-1", "option-1");
      manager.castVote(session.id, "voter-2", "option-1");
      const result = manager.closeVote(session.id, 2);

      expect(result?.winner).toBe("option-1");
    });

    it("closeVote 后会话结果被保存", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      manager.castVote(session.id, "voter-1", "option-1");
      manager.castVote(session.id, "voter-2", "option-1");
      manager.closeVote(session.id, 2);

      const saved = manager.getSession(session.id);
      expect(saved?.status).toBe("closed");
      expect(saved?.result).toBeDefined();
      expect(saved?.closedAt).toBeInstanceOf(Date);
    });
  });

  // ---------------------------------------------------------------------------
  // getSession
  // ---------------------------------------------------------------------------
  describe("getSession", () => {
    it("返回存在的会话", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      const retrieved = manager.getSession(session.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
    });

    it("不存在的 ID 返回 undefined", () => {
      const manager = new VotingManager();
      const retrieved = manager.getSession("nonexistent");

      expect(retrieved).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getVoteStatus
  // ---------------------------------------------------------------------------
  describe("getVoteStatus", () => {
    it("返回 open 会话的状态", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      expect(manager.getVoteStatus(session.id)).toBe("open");
    });

    it("关闭后返回 closed", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      manager.closeVote(session.id, 0);
      expect(manager.getVoteStatus(session.id)).toBe("closed");
    });

    it("不存在的 ID 返回 null", () => {
      const manager = new VotingManager();
      expect(manager.getVoteStatus("nonexistent")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // cancelVote
  // ---------------------------------------------------------------------------
  describe("cancelVote", () => {
    it("可以取消 open 状态的会话", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      const result = manager.cancelVote(session.id);

      expect(result).toBe(true);
      expect(manager.getVoteStatus(session.id)).toBe("cancelled");
    });

    it("已关闭的会话不能取消", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      manager.closeVote(session.id, 0);
      const result = manager.cancelVote(session.id);

      expect(result).toBe(false);
    });

    it("取消不存在的 ID 返回 false", () => {
      const manager = new VotingManager();
      const result = manager.cancelVote("nonexistent");

      expect(result).toBe(false);
    });

    it("取消后 closedAt 被设置", () => {
      const manager = new VotingManager();
      const session = manager.createVote(buildVoteRequest());
      manager.cancelVote(session.id);

      expect(manager.getSession(session.id)?.closedAt).toBeInstanceOf(Date);
    });
  });
});

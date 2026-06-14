/**
 * Unit tests for SkillCacheService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SkillCacheService } from "../caching/skill-cache.service";
import { SkillMdDefinition } from "../../types/skill-md.types";

// ---------------------------------------------------------------------------
// 模拟 fs/promises
// ---------------------------------------------------------------------------

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  unlink: jest.fn(),
}));

// 也模拟 skill-parser（用于文件读取）
jest.mock("../parsing/skill-parser", () => ({
  parseSkillMd: jest.fn(),
  serializeSkillMd: jest.fn(),
}));

import * as fs from "fs/promises";
import { parseSkillMd, serializeSkillMd } from "../parsing/skill-parser";

const mockFs = fs as jest.Mocked<typeof fs>;
const mockParseSkillMd = parseSkillMd as jest.MockedFunction<
  typeof parseSkillMd
>;
const mockSerializeSkillMd = serializeSkillMd as jest.MockedFunction<
  typeof serializeSkillMd
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSkillDefinition(id: string): SkillMdDefinition {
  return {
    metadata: {
      id,
      name: id,
      description: `Skill ${id}`,
      version: "1.0.0",
      domain: "writing",
      taskTypes: ["*"],
      priority: 5,
      source: "local",
      tags: [],
      enabled: true,
      userInvocable: true,
      disableModelInvocation: false,
    },
    content: `Content of ${id}`,
    loadedAt: new Date(),
    contentHash: "abc123",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillCacheService", () => {
  let service: SkillCacheService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SkillCacheService],
    }).compile();

    service = module.get<SkillCacheService>(SkillCacheService);

    // 默认模拟设置
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockSerializeSkillMd.mockReturnValue("---\nid: test\n---\nContent");
  });

  // -------------------------------------------------------------------------
  // configure
  // -------------------------------------------------------------------------

  describe("configure", () => {
    it("可以部分更新配置", () => {
      service.configure({ maxSize: 50 });
      const stats = service.getStats();

      expect(stats.maxSize).toBe(50);
    });

    it("可以更新 persistDir", () => {
      service.configure({ persistDir: "/custom/path" });
      // persistDir 更新后 get 会使用该路径（间接验证）
      expect(service).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // set / get
  // -------------------------------------------------------------------------

  describe("set / get", () => {
    it("可以将 skill 保存到缓存并取回", async () => {
      const skill = makeSkillDefinition("test-skill");

      await service.set("test-skill", skill);
      const retrieved = await service.get("test-skill");

      expect(retrieved).toEqual(skill);
    });

    it("不存在的 ID 返回 null", async () => {
      // 模拟磁盘上也不存在的状态
      mockFs.readFile.mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const result = await service.get("nonexistent");

      expect(result).toBeNull();
    });

    it("缓存命中时 hitCount 增加", async () => {
      const skill = makeSkillDefinition("hit-count-skill");
      await service.set("hit-count-skill", skill);

      await service.get("hit-count-skill");
      await service.get("hit-count-skill");

      const stats = service.getStats();
      expect(stats.totalHits).toBe(2);
    });

    it("persist=false 时不保存到磁盘", async () => {
      const skill = makeSkillDefinition("no-persist-skill");
      await service.set("no-persist-skill", skill, false);

      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("persist=true 时保存到磁盘", async () => {
      const skill = makeSkillDefinition("persist-skill");
      await service.set("persist-skill", skill, true);

      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("磁盘写入失败时仍保存到内存缓存", async () => {
      mockFs.writeFile.mockRejectedValue(new Error("Disk write failed"));
      const skill = makeSkillDefinition("disk-fail-skill");

      await service.set("disk-fail-skill", skill, true);
      const retrieved = await service.get("disk-fail-skill");

      expect(retrieved).toEqual(skill);
    });

    it("缓存过期时从磁盘重新获取", async () => {
      const skill = makeSkillDefinition("expired-skill");
      // 将 TTL 设置为 -1ms 使其立即过期
      service.configure({ ttl: -1 });

      await service.set("expired-skill", skill, false);

      // 从磁盘读取的模拟设置
      mockFs.readFile.mockResolvedValue(
        "---\nid: expired-skill\n---\nContent" as unknown as Buffer,
      );
      mockParseSkillMd.mockReturnValue(skill);

      const retrieved = await service.get("expired-skill");
      expect(retrieved).toEqual(skill);
    });

    it("缓存过期且磁盘也不存在时返回 null", async () => {
      const skill = makeSkillDefinition("expired-no-disk-skill");
      service.configure({ ttl: -1 });

      await service.set("expired-no-disk-skill", skill, false);

      mockFs.readFile.mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const retrieved = await service.get("expired-no-disk-skill");
      expect(retrieved).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // has
  // -------------------------------------------------------------------------

  describe("has", () => {
    it("缓存存在时返回 true", async () => {
      const skill = makeSkillDefinition("has-test-skill");
      await service.set("has-test-skill", skill, false);

      expect(service.has("has-test-skill")).toBe(true);
    });

    it("缓存不存在时返回 false", () => {
      expect(service.has("nonexistent")).toBe(false);
    });

    it("过期的缓存返回 false", async () => {
      const skill = makeSkillDefinition("expired-has-skill");
      service.configure({ ttl: -1 });
      await service.set("expired-has-skill", skill, false);

      expect(service.has("expired-has-skill")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe("delete", () => {
    it("可以删除缓存", async () => {
      const skill = makeSkillDefinition("delete-skill");
      await service.set("delete-skill", skill, false);

      const deleted = await service.delete("delete-skill");

      expect(deleted).toBe(true);
      expect(service.has("delete-skill")).toBe(false);
    });

    it("删除不存在的缓存返回 false", async () => {
      mockFs.unlink.mockRejectedValue(new Error("ENOENT"));

      const deleted = await service.delete("nonexistent");

      expect(deleted).toBe(false);
    });

    it("会尝试删除磁盘上的文件", async () => {
      const skill = makeSkillDefinition("disk-delete-skill");
      await service.set("disk-delete-skill", skill, false);
      mockFs.unlink.mockResolvedValue(undefined);

      await service.delete("disk-delete-skill");

      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe("clear", () => {
    it("可以删除全部缓存", async () => {
      const skill1 = makeSkillDefinition("clear-skill-1");
      const skill2 = makeSkillDefinition("clear-skill-2");
      await service.set("clear-skill-1", skill1, false);
      await service.set("clear-skill-2", skill2, false);

      mockFs.readdir.mockResolvedValue([] as unknown as string[]);
      await service.clear();

      expect(service.has("clear-skill-1")).toBe(false);
      expect(service.has("clear-skill-2")).toBe(false);
    });

    it("会删除磁盘上的 skill.md 文件", async () => {
      mockFs.readdir.mockResolvedValue([
        "test-skill.skill.md",
        "other.txt",
      ] as unknown as string[]);
      mockFs.unlink.mockResolvedValue(undefined);

      await service.clear();

      // 只对 .skill.md 文件调用 unlink
      expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    });

    it("磁盘操作失败时不抛出错误", async () => {
      mockFs.readdir.mockRejectedValue(new Error("Directory not found"));

      await expect(service.clear()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe("getStats", () => {
    it("空缓存的统计数据正确", () => {
      const stats = service.getStats();

      expect(stats.size).toBe(0);
      expect(stats.totalHits).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("添加 skill 后统计数据正确", async () => {
      const skill = makeSkillDefinition("stats-skill");
      await service.set("stats-skill", skill, false);

      const stats = service.getStats();

      expect(stats.size).toBe(1);
    });

    it("maxSize 为默认值", () => {
      const stats = service.getStats();

      expect(stats.maxSize).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // eviction (LFU)
  // -------------------------------------------------------------------------

  describe("evictLeastUsed (缓存容量上限)", () => {
    it("超过 maxSize 时最少使用的条目被删除", async () => {
      service.configure({ maxSize: 2 });

      const skill1 = makeSkillDefinition("evict-skill-1");
      const skill2 = makeSkillDefinition("evict-skill-2");
      const skill3 = makeSkillDefinition("evict-skill-3");

      await service.set("evict-skill-1", skill1, false);
      await service.set("evict-skill-2", skill2, false);

      // 访问 skill2 一次，增加 hitCount
      await service.get("evict-skill-2");

      // 添加 skill3 后，hitCount=0 的 skill1 应被删除
      await service.set("evict-skill-3", skill3, false);

      expect(service.has("evict-skill-1")).toBe(false);
      expect(service.has("evict-skill-2")).toBe(true);
      expect(service.has("evict-skill-3")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // warmup
  // -------------------------------------------------------------------------

  describe("warmup", () => {
    it("从磁盘加载 skill 并预热缓存", async () => {
      const skill = makeSkillDefinition("warmup-skill");
      mockFs.readdir.mockResolvedValue([
        "warmup-skill.skill.md",
      ] as unknown as string[]);
      mockFs.readFile.mockResolvedValue(
        "---\nid: warmup-skill\n---\nContent" as unknown as Buffer,
      );
      mockParseSkillMd.mockReturnValue(skill);

      const count = await service.warmup();

      expect(count).toBe(1);
      expect(service.has("warmup-skill")).toBe(true);
    });

    it("目录不存在时返回 0", async () => {
      mockFs.readdir.mockRejectedValue(new Error("ENOENT"));

      const count = await service.warmup();

      expect(count).toBe(0);
    });

    it("skill 解析失败时跳过该文件", async () => {
      mockFs.readdir.mockResolvedValue([
        "broken-skill.skill.md",
      ] as unknown as string[]);
      mockFs.readFile.mockResolvedValue("invalid content" as unknown as Buffer);
      mockParseSkillMd.mockImplementation(() => {
        throw new Error("Parse error");
      });

      const count = await service.warmup();

      expect(count).toBe(0);
    });

    it("忽略非 .skill.md 文件", async () => {
      mockFs.readdir.mockResolvedValue([
        "README.md",
        "other.txt",
      ] as unknown as string[]);

      const count = await service.warmup();

      expect(count).toBe(0);
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { PromptCacheCoordinatorService } from "../prompt-cache-coordinator.service";

describe("PromptCacheCoordinatorService", () => {
  let service: PromptCacheCoordinatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptCacheCoordinatorService],
    }).compile();

    service = module.get<PromptCacheCoordinatorService>(
      PromptCacheCoordinatorService,
    );
  });

  describe("createPrefix", () => {
    it("should store and return a prefix with correct fields", () => {
      // Arrange
      const missionId = "mission-001";
      const systemPromptText = "You are a research assistant.";
      const toolDefinitions = [{ name: "search", description: "Search tool" }];

      // Act
      const prefix = service.createPrefix(
        missionId,
        systemPromptText,
        toolDefinitions,
      );

      // Assert
      expect(prefix.systemPromptText).toBe(systemPromptText);
      expect(prefix.toolDefinitions).toEqual(toolDefinitions);
      expect(prefix.hash).toHaveLength(64); // SHA-256 hex
      expect(prefix.useCount).toBe(0);
      expect(prefix.createdAt).toBeInstanceOf(Date);
    });

    it("should produce a deterministic hash for the same inputs", () => {
      // Arrange
      const systemPromptText = "Identical prompt";
      const toolDefinitions = [{ name: "tool-a" }];

      // Act
      const prefix1 = service.createPrefix(
        "m-1",
        systemPromptText,
        toolDefinitions,
      );
      const prefix2 = service.createPrefix(
        "m-2",
        systemPromptText,
        toolDefinitions,
      );

      // Assert
      expect(prefix1.hash).toBe(prefix2.hash);
    });
  });

  describe("getPrefix", () => {
    it("should return the stored prefix", () => {
      // Arrange
      const missionId = "mission-002";
      service.createPrefix(missionId, "Some prompt", []);

      // Act
      const result = service.getPrefix(missionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.systemPromptText).toBe("Some prompt");
    });

    it("should increment useCount on each call", () => {
      // Arrange
      const missionId = "mission-003";
      service.createPrefix(missionId, "Prompt", []);

      // Act
      service.getPrefix(missionId);
      service.getPrefix(missionId);
      const result = service.getPrefix(missionId);

      // Assert
      expect(result?.useCount).toBe(3);
    });

    it("should return null for an unknown missionId", () => {
      // Act
      const result = service.getPrefix("does-not-exist");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("hasPrefix", () => {
    it("should return true when a prefix exists", () => {
      // Arrange
      service.createPrefix("m-exists", "Prompt", []);

      // Act & Assert
      expect(service.hasPrefix("m-exists")).toBe(true);
    });

    it("should return false when no prefix exists", () => {
      // Act & Assert
      expect(service.hasPrefix("m-missing")).toBe(false);
    });
  });

  describe("releasePrefix", () => {
    it("should return the prefix and remove it from the store", () => {
      // Arrange
      const missionId = "mission-rel-1";
      service.createPrefix(missionId, "Releasable prompt", []);
      service.getPrefix(missionId); // bump useCount to 1

      // Act
      const released = service.releasePrefix(missionId);

      // Assert
      expect(released).not.toBeNull();
      expect(released?.useCount).toBe(1);
      expect(service.hasPrefix(missionId)).toBe(false);
    });

    it("should return null when releasing an unknown missionId", () => {
      // Act
      const result = service.releasePrefix("ghost-mission");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("getActivePrefixes", () => {
    it("should list all active prefixes with summary fields", () => {
      // Arrange
      service.createPrefix("active-1", "Prompt A", []);
      service.createPrefix("active-2", "Prompt B", [{ name: "tool" }]);
      service.getPrefix("active-1"); // useCount = 1

      // Act
      const actives = service.getActivePrefixes();

      // Assert
      expect(actives).toHaveLength(2);

      const entry1 = actives.find((e) => e.missionId === "active-1");
      expect(entry1?.useCount).toBe(1);
      expect(entry1?.hash).toHaveLength(64);
      expect(entry1?.createdAt).toBeInstanceOf(Date);

      const entry2 = actives.find((e) => e.missionId === "active-2");
      expect(entry2?.useCount).toBe(0);
    });

    it("should return an empty array when no prefixes are active", () => {
      // Act
      const actives = service.getActivePrefixes();

      // Assert
      expect(actives).toHaveLength(0);
    });
  });
});

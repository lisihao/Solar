import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ResearchProjectOutputService } from "../research-project-output.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { GenerateOutputDto } from "../dto";

const mockPrisma = {
  researchProject: {
    findUnique: jest.fn(),
  },
  researchProjectOutput: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockAiFacade = {
  chat: jest.fn(),
};

const makeProject = (overrides = {}) => ({
  id: "project-1",
  userId: "user-1",
  sources: [
    {
      id: "src-1",
      title: "Source 1",
      sourceType: "paper",
      sourceUrl: "https://arxiv.org/abs/1",
      content: "Some content",
      abstract: "An abstract",
      authors: ["Alice"],
      publishedAt: "2024-01-01",
    },
  ],
  ...overrides,
});

const makeOutput = (overrides = {}) => ({
  id: "output-1",
  projectId: "project-1",
  type: "FAQ",
  title: "FAQ",
  status: "PENDING",
  ...overrides,
});

describe("ResearchProjectOutputService", () => {
  let service: ResearchProjectOutputService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectOutputService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<ResearchProjectOutputService>(
      ResearchProjectOutputService,
    );
  });

  // ─── getOutputTypes ──────────────────────────────────────────────────────────

  describe("getOutputTypes", () => {
    it("returns all 12 output types", () => {
      const types = service.getOutputTypes();

      expect(types).toHaveLength(12);
      expect(types.map((t) => t.type)).toContain("FAQ");
      expect(types.map((t) => t.type)).toContain("MIND_MAP");
    });

    it("each type entry has type, title, and icon fields", () => {
      const types = service.getOutputTypes();

      for (const t of types) {
        expect(t.type).toBeDefined();
        expect(t.title).toBeDefined();
        expect(t.icon).toBeDefined();
      }
    });
  });

  // ─── generateOutput ──────────────────────────────────────────────────────────

  describe("generateOutput", () => {
    it("creates a PENDING output record and kicks off async generation", async () => {
      const project = makeProject();
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(project);
      const output = makeOutput();
      mockPrisma.researchProjectOutput.create.mockResolvedValueOnce(output);

      // generateOutputAsync will call these internally (fire-and-forget in tests)
      mockPrisma.researchProjectOutput.update.mockResolvedValue(output);
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({ title: "FAQ Title", categories: [] }),
        tokensUsed: 500,
      });

      const result = await service.generateOutput("user-1", "project-1", {
        type: "FAQ",
      } as GenerateOutputDto);

      expect(result.output.id).toBe("output-1");
      expect(result.sourceCount).toBe(1);
      expect(mockPrisma.researchProjectOutput.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PENDING",
            type: "FAQ",
          }),
        }),
      );
    });

    it("uses custom title when provided", async () => {
      const project = makeProject();
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(project);
      mockPrisma.researchProjectOutput.create.mockResolvedValueOnce(
        makeOutput({ title: "My Custom FAQ" }),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValue(makeOutput());
      mockAiFacade.chat.mockResolvedValue({
        content: "{}",
        tokensUsed: 100,
      });

      await service.generateOutput("user-1", "project-1", {
        type: "FAQ",
        customTitle: "My Custom FAQ",
      } as GenerateOutputDto);

      const createData =
        mockPrisma.researchProjectOutput.create.mock.calls[0][0].data;
      expect(createData.title).toBe("My Custom FAQ");
    });

    it("throws NotFoundException when project does not exist", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.generateOutput("user-1", "missing", {
          type: "FAQ",
        } as GenerateOutputDto),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when user does not own the project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject({ userId: "other-user" }),
      );

      await expect(
        service.generateOutput("user-1", "project-1", {
          type: "FAQ",
        } as GenerateOutputDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when no sources are available", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject({ sources: [] }),
      );

      await expect(
        service.generateOutput("user-1", "project-1", {
          type: "FAQ",
        } as GenerateOutputDto),
      ).rejects.toThrow(NotFoundException);
    });

    it("filters to selectedSourceIds when provided", async () => {
      const project = makeProject({
        sources: [
          {
            id: "src-1",
            title: "Source 1",
            sourceType: "paper",
            content: "c1",
          },
          { id: "src-2", title: "Source 2", sourceType: "blog", content: "c2" },
        ],
      });
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(project);
      mockPrisma.researchProjectOutput.create.mockResolvedValueOnce(
        makeOutput(),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValue(makeOutput());
      mockAiFacade.chat.mockResolvedValue({
        content: "{}",
        tokensUsed: 100,
      });

      await service.generateOutput("user-1", "project-1", {
        type: "FAQ",
        selectedSourceIds: ["src-1"],
      } as GenerateOutputDto);

      // Only 1 source should reach the metadata
      const createData =
        mockPrisma.researchProjectOutput.create.mock.calls[0][0].data;
      const metadata = createData.metadata as { sourceIds: string[] };
      expect(metadata.sourceIds).toEqual(["src-1"]);
    });

    it("throws NotFoundException when selectedSourceIds filters out all sources", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject({
          sources: [{ id: "src-1", title: "Source 1", sourceType: "paper" }],
        }),
      );

      await expect(
        service.generateOutput("user-1", "project-1", {
          type: "FAQ",
          selectedSourceIds: ["non-existent-id"],
        } as GenerateOutputDto),
      ).rejects.toThrow(NotFoundException);
    });

    it("uses empty string for model when dto.model is not provided", async () => {
      const project = makeProject();
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(project);
      mockPrisma.researchProjectOutput.create.mockResolvedValueOnce(
        makeOutput(),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValue(makeOutput());
      mockAiFacade.chat.mockResolvedValue({ content: "{}", tokensUsed: 50 });

      await service.generateOutput("user-1", "project-1", {
        type: "STUDY_GUIDE",
      } as GenerateOutputDto);

      const createData =
        mockPrisma.researchProjectOutput.create.mock.calls[0][0].data;
      expect(createData.modelUsed).toBe("");
    });
  });

  // ─── getOutputs ──────────────────────────────────────────────────────────────

  describe("getOutputs", () => {
    it("returns all outputs for a project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findMany.mockResolvedValueOnce([
        makeOutput(),
        makeOutput({ id: "output-2", type: "STUDY_GUIDE" }),
      ]);

      const result = await service.getOutputs("user-1", "project-1");

      expect(result).toHaveLength(2);
    });

    it("throws NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(null);

      await expect(service.getOutputs("user-1", "missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when user does not own project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject({ userId: "other" }),
      );

      await expect(service.getOutputs("user-1", "project-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── getOutput ───────────────────────────────────────────────────────────────

  describe("getOutput", () => {
    it("returns the specific output", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(
        makeOutput(),
      );

      const result = await service.getOutput("user-1", "project-1", "output-1");

      expect(result.id).toBe("output-1");
    });

    it("throws NotFoundException when output does not belong to the project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(
        makeOutput({ projectId: "other-project" }),
      );

      await expect(
        service.getOutput("user-1", "project-1", "output-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when output does not exist", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getOutput("user-1", "project-1", "output-x"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateOutput ────────────────────────────────────────────────────────────

  describe("updateOutput", () => {
    it("updates status and content", async () => {
      mockPrisma.researchProjectOutput.update.mockResolvedValueOnce(
        makeOutput({ status: "COMPLETED", content: '{"title":"test"}' }),
      );

      await service.updateOutput("output-1", "COMPLETED", '{"title":"test"}');

      expect(mockPrisma.researchProjectOutput.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "COMPLETED",
            content: '{"title":"test"}',
          }),
        }),
      );
    });

    it("sets completedAt when status is COMPLETED", async () => {
      mockPrisma.researchProjectOutput.update.mockResolvedValueOnce(
        makeOutput(),
      );

      await service.updateOutput("output-1", "COMPLETED", "{}");

      const data =
        mockPrisma.researchProjectOutput.update.mock.calls[0][0].data;
      expect(data.completedAt).toBeInstanceOf(Date);
    });

    it("does not set completedAt for GENERATING status", async () => {
      mockPrisma.researchProjectOutput.update.mockResolvedValueOnce(
        makeOutput(),
      );

      await service.updateOutput("output-1", "GENERATING");

      const data =
        mockPrisma.researchProjectOutput.update.mock.calls[0][0].data;
      expect(data.completedAt).toBeUndefined();
    });

    it("includes error message when provided", async () => {
      mockPrisma.researchProjectOutput.update.mockResolvedValueOnce(
        makeOutput(),
      );

      await service.updateOutput("output-1", "FAILED", undefined, "AI error");

      const data =
        mockPrisma.researchProjectOutput.update.mock.calls[0][0].data;
      expect(data.error).toBe("AI error");
    });

    it("includes tokensUsed when provided", async () => {
      mockPrisma.researchProjectOutput.update.mockResolvedValueOnce(
        makeOutput(),
      );

      await service.updateOutput(
        "output-1",
        "COMPLETED",
        "{}",
        undefined,
        1234,
      );

      const data =
        mockPrisma.researchProjectOutput.update.mock.calls[0][0].data;
      expect(data.tokensUsed).toBe(1234);
    });
  });

  // ─── deleteOutput ────────────────────────────────────────────────────────────

  describe("deleteOutput", () => {
    it("deletes the output and returns success", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(
        makeOutput(),
      );
      mockPrisma.researchProjectOutput.delete.mockResolvedValueOnce(
        makeOutput(),
      );

      const result = await service.deleteOutput(
        "user-1",
        "project-1",
        "output-1",
      );

      expect(result).toEqual({ success: true });
      expect(mockPrisma.researchProjectOutput.delete).toHaveBeenCalledWith({
        where: { id: "output-1" },
      });
    });

    it("throws NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.deleteOutput("user-1", "missing", "output-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when user is not the owner", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject({ userId: "other" }),
      );

      await expect(
        service.deleteOutput("user-1", "project-1", "output-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when output does not exist", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.deleteOutput("user-1", "project-1", "output-x"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateOutputProperties ───────────────────────────────────────────────────

  describe("updateOutputProperties", () => {
    it("updates title of the output", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(
        makeOutput(),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValueOnce(
        makeOutput({ title: "Renamed FAQ" }),
      );

      await service.updateOutputProperties("user-1", "project-1", "output-1", {
        title: "Renamed FAQ",
      });

      expect(
        mockPrisma.researchProjectOutput.update.mock.calls[0][0].data.title,
      ).toBe("Renamed FAQ");
    });

    it("throws NotFoundException when output not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateOutputProperties("user-1", "project-1", "output-x", {
          title: "New",
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── regenerateOutput ─────────────────────────────────────────────────────────

  describe("regenerateOutput", () => {
    it("resets output to PENDING status and clears content/error", async () => {
      // getOutput path
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(
        makeOutput({ status: "FAILED", content: null }),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValueOnce(
        makeOutput({ status: "PENDING" }),
      );

      await service.regenerateOutput("user-1", "project-1", "output-1");

      expect(
        mockPrisma.researchProjectOutput.update.mock.calls[0][0].data,
      ).toMatchObject({
        status: "PENDING",
        content: null,
        error: null,
        completedAt: null,
      });
    });

    it("throws NotFoundException when output does not exist", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(
        makeProject(),
      );
      mockPrisma.researchProjectOutput.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.regenerateOutput("user-1", "project-1", "output-x"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── AI generation async path ────────────────────────────────────────────────

  describe("generateOutputAsync (via generateOutput integration)", () => {
    it("marks output as COMPLETED when AI returns valid JSON", async () => {
      const project = makeProject();
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(project);
      mockPrisma.researchProjectOutput.create.mockResolvedValueOnce(
        makeOutput(),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValue(makeOutput());
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({ title: "FAQ: AI", categories: [] }),
        tokensUsed: 800,
      });

      await service.generateOutput("user-1", "project-1", {
        type: "FAQ",
      } as GenerateOutputDto);

      // Allow micro-tasks (fire-and-forget) to flush
      await new Promise((r) => setImmediate(r));

      const updateCalls = mockPrisma.researchProjectOutput.update.mock.calls;
      const completedCall = updateCalls.find(
        (c) => c[0].data.status === "COMPLETED",
      );
      expect(completedCall).toBeDefined();
    });

    it("marks output as FAILED when AI returns invalid JSON", async () => {
      const project = makeProject();
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(project);
      mockPrisma.researchProjectOutput.create.mockResolvedValueOnce(
        makeOutput(),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValue(makeOutput());
      mockAiFacade.chat.mockResolvedValue({
        content: "not json at all ][{",
        tokensUsed: 50,
      });

      await service.generateOutput("user-1", "project-1", {
        type: "FAQ",
      } as GenerateOutputDto);

      await new Promise((r) => setImmediate(r));

      const updateCalls = mockPrisma.researchProjectOutput.update.mock.calls;
      const failedCall = updateCalls.find((c) => c[0].data.status === "FAILED");
      expect(failedCall).toBeDefined();
    });

    it("strips markdown code fences from AI response before JSON parsing", async () => {
      const project = makeProject();
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(project);
      mockPrisma.researchProjectOutput.create.mockResolvedValueOnce(
        makeOutput(),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValue(makeOutput());

      const fencedContent =
        "```json\n" + JSON.stringify({ title: "OK" }) + "\n```";
      mockAiFacade.chat.mockResolvedValue({
        content: fencedContent,
        tokensUsed: 100,
      });

      await service.generateOutput("user-1", "project-1", {
        type: "FAQ",
      } as GenerateOutputDto);

      await new Promise((r) => setImmediate(r));

      const updateCalls = mockPrisma.researchProjectOutput.update.mock.calls;
      const completedCall = updateCalls.find(
        (c) => c[0].data.status === "COMPLETED",
      );
      expect(completedCall).toBeDefined();
    });

    it("marks output as FAILED when the AI service throws", async () => {
      const project = makeProject();
      mockPrisma.researchProject.findUnique.mockResolvedValueOnce(project);
      mockPrisma.researchProjectOutput.create.mockResolvedValueOnce(
        makeOutput(),
      );
      mockPrisma.researchProjectOutput.update.mockResolvedValue(makeOutput());
      mockAiFacade.chat.mockRejectedValue(new Error("AI service unavailable"));

      await service.generateOutput("user-1", "project-1", {
        type: "FAQ",
      } as GenerateOutputDto);

      await new Promise((r) => setImmediate(r));

      const updateCalls = mockPrisma.researchProjectOutput.update.mock.calls;
      const failedCall = updateCalls.find((c) => c[0].data.status === "FAILED");
      expect(failedCall).toBeDefined();
      expect(failedCall![0].data.error).toContain("AI service unavailable");
    });
  });
});

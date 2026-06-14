import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { WorkspaceController } from "../workspace.controller";
import { WorkspaceService } from "../workspace.service";
import { WorkspaceTaskService } from "../workspace-task.service";
import { ReportTemplateService } from "../report-template.service";

describe("WorkspaceController", () => {
  let controller: WorkspaceController;
  let workspaceService: jest.Mocked<WorkspaceService>;
  let workspaceTaskService: jest.Mocked<WorkspaceTaskService>;
  let reportTemplateService: jest.Mocked<ReportTemplateService>;

  const mockWorkspace = {
    id: "ws-1",
    title: "Test Workspace",
    userId: "user-1",
  };

  const mockTask = {
    id: "task-1",
    status: "PENDING",
    workspaceId: "ws-1",
  };

  const mockTemplates = [
    { id: "tpl-1", name: "Research Report", category: "research" },
  ];

  const authenticatedReq = (userId = "user-1") => ({
    user: { id: userId, email: "test@example.com" },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceController],
      providers: [
        {
          provide: WorkspaceService,
          useValue: {
            createWorkspace: jest.fn().mockResolvedValue(mockWorkspace),
            getWorkspace: jest.fn().mockResolvedValue(mockWorkspace),
            updateWorkspaceResources: jest
              .fn()
              .mockResolvedValue(mockWorkspace),
          },
        },
        {
          provide: WorkspaceTaskService,
          useValue: {
            createTask: jest.fn().mockResolvedValue(mockTask),
            getTask: jest.fn().mockResolvedValue(mockTask),
          },
        },
        {
          provide: ReportTemplateService,
          useValue: {
            listTemplates: jest.fn().mockResolvedValue(mockTemplates),
          },
        },
      ],
    }).compile();

    controller = module.get<WorkspaceController>(WorkspaceController);
    workspaceService = module.get(WorkspaceService);
    workspaceTaskService = module.get(WorkspaceTaskService);
    reportTemplateService = module.get(ReportTemplateService);
  });

  describe("createWorkspace", () => {
    it("should create a workspace for authenticated user", async () => {
      const req = authenticatedReq();
      const dto = {
        title: "New Workspace",
      } as unknown as import("../dto").CreateWorkspaceDto;

      const result = await controller.createWorkspace(req, dto);
      expect(workspaceService.createWorkspace).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
      expect(result).toBe(mockWorkspace);
    });

    it("should throw UnauthorizedException when user id is missing", async () => {
      const req = { user: { id: "", email: "test@example.com" } };
      const dto = {} as unknown as import("../dto").CreateWorkspaceDto;

      await expect(controller.createWorkspace(req, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("listTemplates", () => {
    it("should list all templates without category filter", async () => {
      const result = await controller.listTemplates();
      expect(reportTemplateService.listTemplates).toHaveBeenCalledWith(
        undefined,
      );
      expect(result).toBe(mockTemplates);
    });

    it("should pass category filter to service", async () => {
      const result = await controller.listTemplates("research");
      expect(reportTemplateService.listTemplates).toHaveBeenCalledWith(
        "research",
      );
      expect(result).toBe(mockTemplates);
    });
  });

  describe("getWorkspace", () => {
    it("should return workspace for authenticated user", async () => {
      const req = authenticatedReq();
      const result = await controller.getWorkspace("ws-1", req);
      expect(workspaceService.getWorkspace).toHaveBeenCalledWith(
        "ws-1",
        "user-1",
      );
      expect(result).toBe(mockWorkspace);
    });

    it("should throw UnauthorizedException when user id is missing", async () => {
      const req = { user: { id: "", email: "" } };
      await expect(controller.getWorkspace("ws-1", req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("updateWorkspaceResources", () => {
    it("should update workspace resources for authenticated user", async () => {
      const req = authenticatedReq();
      const dto = {
        resourceIds: ["r-1"],
      } as unknown as import("../dto").UpdateWorkspaceResourcesDto;

      const result = await controller.updateWorkspaceResources(
        "ws-1",
        req,
        dto,
      );
      expect(workspaceService.updateWorkspaceResources).toHaveBeenCalledWith(
        "ws-1",
        "user-1",
        dto,
      );
      expect(result).toBe(mockWorkspace);
    });

    it("should throw UnauthorizedException when user id is missing", async () => {
      const req = { user: { id: "", email: "" } };
      const dto = {} as unknown as import("../dto").UpdateWorkspaceResourcesDto;

      await expect(
        controller.updateWorkspaceResources("ws-1", req, dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("createWorkspaceTask", () => {
    it("should create a workspace task for authenticated user", async () => {
      const req = authenticatedReq();
      const dto = {
        type: "RESEARCH",
      } as unknown as import("../dto").CreateWorkspaceTaskDto;

      const result = await controller.createWorkspaceTask("ws-1", req, dto);
      expect(workspaceTaskService.createTask).toHaveBeenCalledWith(
        "user-1",
        "ws-1",
        dto,
      );
      expect(result).toBe(mockTask);
    });

    it("should throw UnauthorizedException when user id is missing", async () => {
      const req = { user: { id: "", email: "" } };
      const dto = {} as unknown as import("../dto").CreateWorkspaceTaskDto;

      await expect(
        controller.createWorkspaceTask("ws-1", req, dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("getWorkspaceTask", () => {
    it("should return task status for authenticated user", async () => {
      const req = authenticatedReq();
      const result = await controller.getWorkspaceTask("ws-1", "task-1", req);
      expect(workspaceTaskService.getTask).toHaveBeenCalledWith(
        "user-1",
        "ws-1",
        "task-1",
      );
      expect(result).toBe(mockTask);
    });

    it("should throw UnauthorizedException when user id is missing", async () => {
      const req = { user: { id: "", email: "" } };
      await expect(
        controller.getWorkspaceTask("ws-1", "task-1", req),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import {
  FeedbackController,
  FEEDBACK_MAX_FILES,
  FEEDBACK_UPLOAD_MULTER_OPTIONS,
} from "../feedback.controller";
import { FeedbackService } from "../feedback.service";
import { EmailService } from "../../../platform/facade";
import { CreateFeedbackDto, FeedbackTypeDto } from "../dto/create-feedback.dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { OptionalJwtAuthGuard } from "../../../../common/guards/optional-jwt-auth.guard";

const mockGuard = { canActivate: () => true };

// ============================================================================
// Mocks
// ============================================================================

function makeFeedbackServiceMock() {
  return {
    createFeedback: jest.fn().mockResolvedValue({ id: "fb-1" }),
    createFromAnnotation: jest.fn().mockResolvedValue({ id: "fb-2" }),
    getUserFeedback: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getAllFeedback: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getFeedbackStats: jest.fn().mockResolvedValue({ total: 0 }),
    getFeedbackById: jest.fn().mockResolvedValue({ id: "fb-1" }),
    updateFeedbackStatus: jest
      .fn()
      .mockResolvedValue({ id: "fb-1", status: "REVIEWED" }),
    updateFeedbackPriority: jest
      .fn()
      .mockResolvedValue({ id: "fb-1", priority: "HIGH" }),
    assignFeedback: jest
      .fn()
      .mockResolvedValue({ id: "fb-1", assignedTo: "admin-1" }),
    batchUpdateStatus: jest.fn().mockResolvedValue({ updated: 3 }),
  };
}

function makeEmailServiceMock(enabled = true) {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    reinitialize: jest.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("FeedbackController", () => {
  let controller: FeedbackController;
  let feedbackService: ReturnType<typeof makeFeedbackServiceMock>;
  let emailService: ReturnType<typeof makeEmailServiceMock>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    feedbackService = makeFeedbackServiceMock();
    emailService = makeEmailServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [
        { provide: FeedbackService, useValue: feedbackService },
        { provide: EmailService, useValue: emailService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(AdminGuard)
      .useValue(mockGuard)
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<FeedbackController>(FeedbackController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- submitFeedback ----------

  describe("submitFeedback", () => {
    const dto: CreateFeedbackDto = {
      type: FeedbackTypeDto.BUG,
      title: "Button is broken",
      description: "Clicking the button causes an error",
    };

    it("delegates to feedbackService.createFeedback and returns the result", async () => {
      const req = { user: { id: "user-42" } };
      const files: Express.Multer.File[] = [];

      const result = await controller.submitFeedback(dto, req, files);

      expect(feedbackService.createFeedback).toHaveBeenCalledWith(
        dto,
        "user-42",
        files,
      );
      expect(result).toEqual({ id: "fb-1" });
    });

    it("passes undefined userId when the request has no authenticated user", async () => {
      const req = { user: undefined };

      await controller.submitFeedback(dto, req, []);

      expect(feedbackService.createFeedback).toHaveBeenCalledWith(
        dto,
        undefined,
        [],
      );
    });

    it("works without uploaded files", async () => {
      const req = { user: { id: "u-1" } };

      await controller.submitFeedback(dto, req, undefined);

      expect(feedbackService.createFeedback).toHaveBeenCalledWith(
        dto,
        "u-1",
        undefined,
      );
    });
  });

  // ---------- upload multer config (de-memoization) ----------

  describe("FEEDBACK_UPLOAD_MULTER_OPTIONS", () => {
    it("uses multer diskStorage, NOT the default memoryStorage", () => {
      const storage = FEEDBACK_UPLOAD_MULTER_OPTIONS.storage as unknown as {
        getDestination?: unknown;
        getFilename?: unknown;
      };
      // diskStorage 实例带 getDestination/getFilename 函数；memoryStorage 没有。
      // 这保证上传文件落磁盘临时文件，而不是整个 Buffer 进内存（避免内存爆）。
      expect(storage).toBeDefined();
      expect(typeof storage.getDestination).toBe("function");
      expect(typeof storage.getFilename).toBe("function");
    });

    it("keeps the 5-file count limit and 10MB per-file size limit", () => {
      expect(FEEDBACK_MAX_FILES).toBe(5);
      expect(FEEDBACK_UPLOAD_MULTER_OPTIONS.limits?.fileSize).toBe(
        10 * 1024 * 1024,
      );
    });

    it("keeps a fileFilter that rejects unsupported mime types", () => {
      const filter = FEEDBACK_UPLOAD_MULTER_OPTIONS.fileFilter;
      expect(typeof filter).toBe("function");

      const accept = jest.fn();
      filter!(
        {} as never,
        { mimetype: "image/png" } as Express.Multer.File,
        accept,
      );
      expect(accept).toHaveBeenCalledWith(null, true);

      const reject = jest.fn();
      filter!(
        {} as never,
        { mimetype: "application/x-msdownload" } as Express.Multer.File,
        reject,
      );
      expect(reject).toHaveBeenCalledWith(null, false);
    });
  });

  // ---------- createFromAnnotation ----------

  describe("createFromAnnotation", () => {
    it("creates feedback from an annotation id", async () => {
      const req = { user: { id: "user-1" } };

      const result = await controller.createFromAnnotation("anno-42", req);

      expect(feedbackService.createFromAnnotation).toHaveBeenCalledWith(
        "user-1",
        "anno-42",
      );
      expect(result).toEqual({ id: "fb-2" });
    });
  });

  // ---------- getMyFeedback ----------

  describe("getMyFeedback", () => {
    const req = { user: { id: "user-1" } };

    it("fetches feedback for the authenticated user with defaults", async () => {
      await controller.getMyFeedback(req, undefined, undefined);

      expect(feedbackService.getUserFeedback).toHaveBeenCalledWith("user-1", {
        limit: undefined,
        offset: undefined,
      });
    });

    it("parses limit and offset query params as integers", async () => {
      await controller.getMyFeedback(req, "20", "40");

      expect(feedbackService.getUserFeedback).toHaveBeenCalledWith("user-1", {
        limit: 20,
        offset: 40,
      });
    });
  });

  // ---------- getAllFeedback ----------

  describe("getAllFeedback", () => {
    it("passes all filters to feedbackService.getAllFeedback", async () => {
      await controller.getAllFeedback("PENDING", "BUG", "HIGH", "10", "0");

      expect(feedbackService.getAllFeedback).toHaveBeenCalledWith({
        status: "PENDING",
        type: "BUG",
        priority: "HIGH",
        limit: 10,
        offset: 0,
      });
    });

    it("passes undefined for missing optional filters", async () => {
      await controller.getAllFeedback(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(feedbackService.getAllFeedback).toHaveBeenCalledWith({
        status: undefined,
        type: undefined,
        priority: undefined,
        limit: undefined,
        offset: undefined,
      });
    });
  });

  // ---------- getFeedbackStats ----------

  describe("getFeedbackStats", () => {
    it("returns stats from feedbackService", async () => {
      const result = await controller.getFeedbackStats();

      expect(feedbackService.getFeedbackStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ total: 0 });
    });
  });

  // ---------- getFeedback ----------

  describe("getFeedback", () => {
    it("returns feedback by id", async () => {
      const result = await controller.getFeedback("fb-1");

      expect(feedbackService.getFeedbackById).toHaveBeenCalledWith("fb-1");
      expect(result).toEqual({ id: "fb-1" });
    });
  });

  // ---------- updateFeedbackStatus ----------

  describe("updateFeedbackStatus", () => {
    it("updates status with optional admin notes", async () => {
      const result = await controller.updateFeedbackStatus(
        "fb-1",
        "REVIEWED",
        "Looks good",
      );

      expect(feedbackService.updateFeedbackStatus).toHaveBeenCalledWith(
        "fb-1",
        "REVIEWED",
        "Looks good",
      );
      expect(result).toEqual({ id: "fb-1", status: "REVIEWED" });
    });

    it("works without admin notes", async () => {
      await controller.updateFeedbackStatus("fb-1", "CLOSED", undefined);

      expect(feedbackService.updateFeedbackStatus).toHaveBeenCalledWith(
        "fb-1",
        "CLOSED",
        undefined,
      );
    });
  });

  // ---------- updateFeedbackPriority ----------

  describe("updateFeedbackPriority", () => {
    it("updates priority and returns updated record", async () => {
      const result = await controller.updateFeedbackPriority("fb-1", "HIGH");

      expect(feedbackService.updateFeedbackPriority).toHaveBeenCalledWith(
        "fb-1",
        "HIGH",
      );
      expect(result).toEqual({ id: "fb-1", priority: "HIGH" });
    });
  });

  // ---------- assignFeedback ----------

  describe("assignFeedback", () => {
    it("assigns feedback to an admin user", async () => {
      const result = await controller.assignFeedback("fb-1", "admin-1");

      expect(feedbackService.assignFeedback).toHaveBeenCalledWith(
        "fb-1",
        "admin-1",
      );
      expect(result).toEqual({ id: "fb-1", assignedTo: "admin-1" });
    });

    it("unassigns feedback when assignedTo is null", async () => {
      feedbackService.assignFeedback.mockResolvedValue({
        id: "fb-1",
        assignedTo: null,
      });

      const result = await controller.assignFeedback("fb-1", null);

      expect(feedbackService.assignFeedback).toHaveBeenCalledWith("fb-1", null);
      expect(result.assignedTo).toBeNull();
    });
  });

  // ---------- batchUpdateStatus ----------

  describe("batchUpdateStatus", () => {
    it("batch updates multiple feedback items", async () => {
      const ids = ["fb-1", "fb-2", "fb-3"];
      const result = await controller.batchUpdateStatus(ids, "RESOLVED");

      expect(feedbackService.batchUpdateStatus).toHaveBeenCalledWith(
        ids,
        "RESOLVED",
      );
      expect(result).toEqual({ updated: 3 });
    });
  });

  // ---------- getEmailStatus ----------

  describe("getEmailStatus", () => {
    it("returns enabled=true with configured message when email is enabled", async () => {
      const result = await controller.getEmailStatus();

      expect(emailService.isEnabled).toHaveBeenCalled();
      expect(result.enabled).toBe(true);
      expect(result.message).toContain("ready");
    });

    it("returns enabled=false with not-configured message when email is disabled", async () => {
      emailService.isEnabled.mockReturnValue(false);

      const result = await controller.getEmailStatus();

      expect(result.enabled).toBe(false);
      expect(result.message).toContain("not configured");
    });
  });

  // ---------- reinitializeEmail ----------

  describe("reinitializeEmail", () => {
    it("triggers reinitialize and returns current status (enabled)", async () => {
      const result = await controller.reinitializeEmail();

      expect(emailService.reinitialize).toHaveBeenCalledTimes(1);
      expect(result.enabled).toBe(true);
      expect(result.message).toContain("reinitialized");
    });

    it("returns not-configured message when email is still disabled after reinitialization", async () => {
      emailService.isEnabled.mockReturnValue(false);

      const result = await controller.reinitializeEmail();

      expect(result.enabled).toBe(false);
      expect(result.message).toContain("not configured");
    });
  });
});

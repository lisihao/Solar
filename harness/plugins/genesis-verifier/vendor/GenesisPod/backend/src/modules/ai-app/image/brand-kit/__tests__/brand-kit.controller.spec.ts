import { Test, TestingModule } from "@nestjs/testing";
import { BrandKitController } from "../brand-kit.controller";
import { BrandKitService } from "../brand-kit.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";

describe("BrandKitController", () => {
  let controller: BrandKitController;
  let service: jest.Mocked<BrandKitService>;

  const mockRequest = { user: { id: "user-123", email: "test@example.com" } };

  const mockBrandKit = {
    id: "kit-1",
    name: "My Brand",
    userId: "user-123",
    colors: [],
    fonts: [],
    logos: {},
    defaultStyle: "consulting" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockBrandKitService = {
    findByUser: jest.fn(),
    getPresetBrandKits: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BrandKitController],
      providers: [{ provide: BrandKitService, useValue: mockBrandKitService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BrandKitController>(BrandKitController);
    service = module.get(BrandKitService);
  });

  describe("findAll", () => {
    it("should return all brand kits for the requesting user", async () => {
      mockBrandKitService.findByUser.mockResolvedValue([mockBrandKit]);

      const result = await controller.findAll(mockRequest);

      expect(result).toEqual([mockBrandKit]);
      expect(service.findByUser).toHaveBeenCalledWith("user-123");
    });

    it("should return empty array when user has no brand kits", async () => {
      mockBrandKitService.findByUser.mockResolvedValue([]);

      const result = await controller.findAll(mockRequest);

      expect(result).toEqual([]);
      expect(service.findByUser).toHaveBeenCalledWith("user-123");
    });
  });

  describe("getPresets", () => {
    it("should return preset brand kits", async () => {
      const presets = [
        { ...mockBrandKit, id: "preset-1", name: "Default Preset" },
      ];
      mockBrandKitService.getPresetBrandKits.mockResolvedValue(presets);

      const result = await controller.getPresets();

      expect(result).toEqual(presets);
      expect(service.getPresetBrandKits).toHaveBeenCalled();
    });

    it("should call getPresetBrandKits without any arguments", async () => {
      mockBrandKitService.getPresetBrandKits.mockResolvedValue([]);

      await controller.getPresets();

      expect(service.getPresetBrandKits).toHaveBeenCalledWith();
    });
  });

  describe("findOne", () => {
    it("should return a brand kit by id for the requesting user", async () => {
      mockBrandKitService.findById.mockResolvedValue(mockBrandKit);

      const result = await controller.findOne("kit-1", mockRequest);

      expect(result).toEqual(mockBrandKit);
      expect(service.findById).toHaveBeenCalledWith("kit-1", "user-123");
    });

    it("should pass the correct id and userId to service", async () => {
      mockBrandKitService.findById.mockResolvedValue(mockBrandKit);

      await controller.findOne("kit-abc", {
        user: { id: "user-456", email: "x@x.com" },
      });

      expect(service.findById).toHaveBeenCalledWith("kit-abc", "user-456");
    });
  });

  describe("create", () => {
    it("should create a brand kit for the requesting user", async () => {
      const dto = {
        name: "New Kit",
        colors: [],
        fonts: [],
        logos: {},
        defaultStyle: "tech" as const,
      };
      mockBrandKitService.create.mockResolvedValue({ ...mockBrandKit, ...dto });

      const result = await controller.create(dto, mockRequest);

      expect(result).toEqual(expect.objectContaining({ name: "New Kit" }));
      expect(service.create).toHaveBeenCalledWith("user-123", dto);
    });

    it("should pass userId from request to service", async () => {
      const dto = {
        name: "Kit",
        colors: [],
        fonts: [],
        logos: {},
        defaultStyle: "minimal" as const,
      };
      mockBrandKitService.create.mockResolvedValue(mockBrandKit);

      await controller.create(dto, {
        user: { id: "user-999", email: "x@x.com" },
      });

      expect(service.create).toHaveBeenCalledWith("user-999", dto);
    });
  });

  describe("update", () => {
    it("should update a brand kit by id for the requesting user", async () => {
      const dto = { name: "Updated Kit" };
      const updated = { ...mockBrandKit, name: "Updated Kit" };
      mockBrandKitService.update.mockResolvedValue(updated);

      const result = await controller.update("kit-1", dto, mockRequest);

      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith("kit-1", "user-123", dto);
    });

    it("should pass correct id, userId and dto to service", async () => {
      const dto = { name: "Renamed" };
      mockBrandKitService.update.mockResolvedValue(mockBrandKit);

      await controller.update("kit-xyz", dto, {
        user: { id: "uid-888", email: "a@b.com" },
      });

      expect(service.update).toHaveBeenCalledWith("kit-xyz", "uid-888", dto);
    });
  });

  describe("delete", () => {
    it("should delete a brand kit and return success message", async () => {
      mockBrandKitService.delete.mockResolvedValue(undefined);

      const result = await controller.delete("kit-1", mockRequest);

      expect(result).toEqual({ message: "Brand kit deleted successfully" });
      expect(service.delete).toHaveBeenCalledWith("kit-1", "user-123");
    });

    it("should pass the correct id and userId to service", async () => {
      mockBrandKitService.delete.mockResolvedValue(undefined);

      await controller.delete("kit-abc", {
        user: { id: "uid-321", email: "c@d.com" },
      });

      expect(service.delete).toHaveBeenCalledWith("kit-abc", "uid-321");
    });
  });
});

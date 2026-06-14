import { Test, TestingModule } from "@nestjs/testing";
import { AppController } from "../app.controller";
import { AppService } from "../app.service";
import { PrismaService } from "../common/prisma/prisma.service";
import { CacheService } from "../common/cache/cache.service";

describe("AppController", () => {
  let controller: AppController;
  const mockAppService = { getHello: jest.fn().mockReturnValue("Hello!") };
  const mockPrisma = {
    healthCheck: jest.fn().mockResolvedValue({ status: "healthy", latency: 5 }),
  };
  const mockCache = {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue("ok"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: mockAppService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    controller = module.get(AppController);
    jest.clearAllMocks();
  });

  it("getHello returns greeting", () => {
    mockAppService.getHello.mockReturnValue("Hello World");
    expect(controller.getHello()).toBe("Hello World");
  });

  it("getHealth returns ok when all services healthy", async () => {
    mockPrisma.healthCheck.mockResolvedValue({ status: "healthy", latency: 3 });
    mockCache.set.mockResolvedValue(undefined);
    mockCache.get.mockResolvedValue("ok");

    const result = await controller.getHealth();

    expect(result.status).toBe("ok");
    expect(result.checks.database.status).toBe("healthy");
    expect(result.checks.cache.status).toBe("healthy");
    expect(result.timestamp).toBeDefined();
  });

  it("getHealth returns degraded when cache is unhealthy", async () => {
    mockPrisma.healthCheck.mockResolvedValue({ status: "healthy", latency: 3 });
    mockCache.set.mockRejectedValue(new Error("Redis down"));

    const result = await controller.getHealth();

    expect(result.status).toBe("degraded");
    expect(result.checks.cache.status).toBe("unhealthy");
    expect(result.checks.cache.message).toBe("Cache unavailable");
  });

  it("getHealth returns degraded when cache returns wrong value", async () => {
    mockPrisma.healthCheck.mockResolvedValue({ status: "healthy", latency: 3 });
    mockCache.set.mockResolvedValue(undefined);
    mockCache.get.mockResolvedValue("wrong");

    const result = await controller.getHealth();

    expect(result.status).toBe("degraded");
    expect(result.checks.cache.status).toBe("unhealthy");
  });

  it("getHealth returns degraded when database unhealthy", async () => {
    mockPrisma.healthCheck.mockResolvedValue({
      status: "unhealthy",
      message: "Connection failed",
    });
    mockCache.set.mockResolvedValue(undefined);
    mockCache.get.mockResolvedValue("ok");

    const result = await controller.getHealth();

    expect(result.status).toBe("degraded");
  });
});

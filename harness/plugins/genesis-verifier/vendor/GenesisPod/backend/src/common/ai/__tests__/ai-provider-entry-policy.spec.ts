import { PrismaService } from "@/common/prisma/prisma.service";
import { AiProviderService } from "@/modules/ai-engine/llm/models/catalog/ai-provider.service";
import { UserProvidersService } from "@/modules/open-api/user/byok/user-providers.service";

const BASE_PROVIDER = {
  slug: "example",
  name: "Example",
  endpoint: "https://api.example.com/v1",
  apiFormat: "openai",
  testModel: "example-chat",
  capabilities: ["CHAT"],
};

describe("AI provider configuration endpoint policy", () => {
  const prisma = {
    aIProvider: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({
        id: "provider-1",
        scope: "user",
        ownerUserId: "user-1",
      }),
    },
  };

  let systemProviders: AiProviderService;
  let userProviders: UserProvidersService;

  beforeEach(() => {
    jest.clearAllMocks();
    systemProviders = new AiProviderService(prisma as unknown as PrismaService);
    userProviders = new UserProvidersService(
      prisma as unknown as PrismaService,
    );
  });

  it("blocks system provider create and update before persistence", () => {
    expect(() =>
      systemProviders.create({
        ...BASE_PROVIDER,
        endpoint: "https://api.thunderomlx.example/v1",
      }),
    ).toThrow("GenesisPod forbids ThunderOMLX/OMLX AI provider endpoints");

    expect(() =>
      systemProviders.update("provider-1", {
        endpoint: "http://127.0.0.1:8002/v1",
      }),
    ).toThrow("GenesisPod forbids ThunderOMLX/OMLX AI provider endpoints");

    expect(prisma.aIProvider.create).not.toHaveBeenCalled();
    expect(prisma.aIProvider.update).not.toHaveBeenCalled();
  });

  it("blocks user provider create and update before persistence", async () => {
    expect(() =>
      userProviders.create("user-1", {
        ...BASE_PROVIDER,
        endpoint: "https://api.omlx.example/v1",
      }),
    ).toThrow("GenesisPod forbids ThunderOMLX/OMLX AI provider endpoints");

    await expect(
      userProviders.update("user-1", "provider-1", {
        endpoint: "http://localhost:8002/v1",
      }),
    ).rejects.toThrow(
      "GenesisPod forbids ThunderOMLX/OMLX AI provider endpoints",
    );

    expect(prisma.aIProvider.create).not.toHaveBeenCalled();
    expect(prisma.aIProvider.update).not.toHaveBeenCalled();
  });
});

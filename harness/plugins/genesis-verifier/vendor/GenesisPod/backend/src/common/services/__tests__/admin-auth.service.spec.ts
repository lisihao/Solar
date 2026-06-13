import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { AdminAuthService } from "../admin-auth.service";

describe("AdminAuthService", () => {
  let service: AdminAuthService;
  // let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === "ADMIN_EMAILS") {
                return "admin@example.com,super@example.com";
              }
              return "";
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AdminAuthService>(AdminAuthService);
    // configService = module.get<ConfigService>(ConfigService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("isAdmin", () => {
    it("should return true for user with ADMIN role", () => {
      const user = { role: "ADMIN", email: "user@example.com" };
      expect(service.isAdmin(user)).toBe(true);
    });

    it("should return true for user in admin email list", () => {
      const user = { role: "USER", email: "admin@example.com" };
      expect(service.isAdmin(user)).toBe(true);
    });

    it("should return true for user in admin email list (case insensitive)", () => {
      const user = { role: "USER", email: "ADMIN@EXAMPLE.COM" };
      expect(service.isAdmin(user)).toBe(true);
    });

    it("should return false for regular user", () => {
      const user = { role: "USER", email: "user@example.com" };
      expect(service.isAdmin(user)).toBe(false);
    });

    it("should return false for null user", () => {
      expect(service.isAdmin(null as any)).toBe(false);
    });

    it("should return false for undefined user", () => {
      expect(service.isAdmin(undefined as any)).toBe(false);
    });

    it("should return false for user without email", () => {
      const user = { role: "USER" };
      expect(service.isAdmin(user)).toBe(false);
    });

    it("should return false for user without role", () => {
      const user = { email: "user@example.com" };
      expect(service.isAdmin(user)).toBe(false);
    });
  });

  describe("getAdminEmails", () => {
    it("should return admin email list", () => {
      const emails = service.getAdminEmails();
      expect(emails).toEqual(["admin@example.com", "super@example.com"]);
    });
  });

  describe("getAdminEmailCount", () => {
    it("should return correct count of admin emails", () => {
      expect(service.getAdminEmailCount()).toBe(2);
    });
  });
});

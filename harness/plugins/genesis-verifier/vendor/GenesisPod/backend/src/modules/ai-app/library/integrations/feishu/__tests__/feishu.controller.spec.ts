jest.mock(
  "@nestjs/cache-manager",
  () => ({
    CACHE_MANAGER: "CACHE_MANAGER",
    CacheModule: {
      registerAsync: jest.fn().mockReturnValue({ module: class {} }),
    },
  }),
  { virtual: true },
);

import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { FeishuController } from "../feishu.controller";
import { FeishuService } from "../feishu.service";
import { FeishuCryptoService } from "../feishu-crypto.service";
import { FeishuAuthService } from "../feishu-auth.service";

describe("FeishuController", () => {
  let controller: FeishuController;
  let feishuService: jest.Mocked<FeishuService>;
  let cryptoService: jest.Mocked<FeishuCryptoService>;
  let authService: jest.Mocked<FeishuAuthService>;

  const mockResponse = () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res;
  };

  const mockRequest = (rawBody?: string) => {
    return {
      rawBody: rawBody ? Buffer.from(rawBody) : undefined,
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeishuController],
      providers: [
        {
          provide: FeishuService,
          useValue: {
            handleEvent: jest.fn().mockResolvedValue(undefined),
            sendMessage: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: FeishuCryptoService,
          useValue: {
            verifySignature: jest.fn().mockReturnValue(true),
            decrypt: jest.fn().mockReturnValue("{}"),
          },
        },
        {
          provide: FeishuAuthService,
          useValue: {
            isConfigured: jest.fn().mockReturnValue(true),
            getMaskedAppId: jest.fn().mockReturnValue("cli123****"),
          },
        },
      ],
    }).compile();

    controller = module.get<FeishuController>(FeishuController);
    feishuService = module.get(FeishuService);
    cryptoService = module.get(FeishuCryptoService);
    authService = module.get(FeishuAuthService);
  });

  describe("handleCallback", () => {
    it("should respond with challenge for url_verification", async () => {
      const res = mockResponse();
      const req = mockRequest();
      const body = {
        type: "url_verification",
        challenge: "test-challenge-token",
      };

      await controller.handleCallback(
        req as unknown as import("express").Request,
        body,
        "",
        "",
        "",
        res as unknown as import("express").Response,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({
        challenge: "test-challenge-token",
      });
    });

    it("should return empty json for normal event without header/event", async () => {
      const res = mockResponse();
      const req = mockRequest();
      const body = { type: "event_callback" };

      await controller.handleCallback(
        req as unknown as import("express").Request,
        body,
        "",
        "",
        "",
        res as unknown as import("express").Response,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({});
    });

    it("should dispatch event when header and event fields present", async () => {
      const res = mockResponse();
      const req = mockRequest();
      const body = {
        schema: "2.0",
        header: {
          event_id: "ev123",
          event_type: "im.message.receive_v1",
          create_time: "1609459200",
          token: "tok",
          app_id: "app_id",
          tenant_key: "tenant",
        },
        event: { message: "hello" },
      };

      await controller.handleCallback(
        req as unknown as import("express").Request,
        body,
        "",
        "",
        "",
        res as unknown as import("express").Response,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({});
    });

    it("should handle encrypted event with valid signature", async () => {
      const res = mockResponse();
      const rawBody = '{"encrypt":"someencryptedcontent"}';
      const req = mockRequest(rawBody);

      cryptoService.verifySignature.mockReturnValue(true);
      cryptoService.decrypt.mockReturnValue(
        '{"schema":"2.0","event":{"msg":"hi"}}',
      );

      const body = { encrypt: "someencryptedcontent" };

      await controller.handleCallback(
        req as unknown as import("express").Request,
        body,
        "1609459200",
        "nonce123",
        "valid-sig",
        res as unknown as import("express").Response,
      );

      expect(cryptoService.verifySignature).toHaveBeenCalled();
      expect(cryptoService.decrypt).toHaveBeenCalledWith(
        "someencryptedcontent",
      );
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    });

    it("should reject encrypted event with invalid signature", async () => {
      const res = mockResponse();
      const req = mockRequest('{"encrypt":"content"}');

      cryptoService.verifySignature.mockReturnValue(false);

      const body = { encrypt: "content" };

      await controller.handleCallback(
        req as unknown as import("express").Request,
        body,
        "timestamp",
        "nonce",
        "bad-sig",
        res as unknown as import("express").Response,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({});
      expect(cryptoService.decrypt).not.toHaveBeenCalled();
    });

    it("should return empty json when decrypt throws", async () => {
      const res = mockResponse();
      const req = mockRequest();

      cryptoService.verifySignature.mockReturnValue(true);
      cryptoService.decrypt.mockImplementation(() => {
        throw new Error("decrypt failed");
      });

      const body = { encrypt: "bad-encrypted-data" };

      await controller.handleCallback(
        req as unknown as import("express").Request,
        body,
        "",
        "",
        "",
        res as unknown as import("express").Response,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({});
    });

    it("should respond with challenge when decrypted content is url_verification", async () => {
      const res = mockResponse();
      const req = mockRequest();

      cryptoService.verifySignature.mockReturnValue(true);
      cryptoService.decrypt.mockReturnValue(
        '{"type":"url_verification","challenge":"encrypted-challenge"}',
      );

      const body = { encrypt: "encrypted-challenge-payload" };

      await controller.handleCallback(
        req as unknown as import("express").Request,
        body,
        "",
        "",
        "",
        res as unknown as import("express").Response,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({
        challenge: "encrypted-challenge",
      });
    });
  });

  describe("healthCheck", () => {
    it("should return ready status when configured", () => {
      authService.isConfigured.mockReturnValue(true);
      authService.getMaskedAppId.mockReturnValue("cli123****");

      const result = controller.healthCheck();

      expect(result.status).toBe("ready");
      expect(result.appId).toBe("cli123****");
      expect(result.timestamp).toBeDefined();
    });

    it("should return not_configured status when not configured", () => {
      authService.isConfigured.mockReturnValue(false);

      const result = controller.healthCheck();

      expect(result.status).toBe("not_configured");
      expect(result.appId).toBeNull();
    });
  });

  describe("sendMessage", () => {
    it("should send message and return result", async () => {
      feishuService.sendMessage.mockResolvedValue({ success: true });

      const body = {
        receiveId: "user123",
        msgType: "text" as const,
        content: "Hello",
      };

      const result = await controller.sendMessage(body);

      expect(feishuService.sendMessage).toHaveBeenCalledWith({
        receiveId: "user123",
        receiveIdType: "open_id",
        msgType: "text",
        content: "Hello",
      });
      expect(result).toEqual({ success: true });
    });

    it("should use provided receiveIdType", async () => {
      feishuService.sendMessage.mockResolvedValue({ success: true });

      const body = {
        receiveId: "chat123",
        receiveIdType: "chat_id" as const,
        msgType: "interactive" as const,
        content: "Card content",
      };

      await controller.sendMessage(body);

      expect(feishuService.sendMessage).toHaveBeenCalledWith({
        receiveId: "chat123",
        receiveIdType: "chat_id",
        msgType: "interactive",
        content: "Card content",
      });
    });

    it("should return error object when sendMessage throws", async () => {
      feishuService.sendMessage.mockRejectedValue(new Error("Network error"));

      const body = {
        receiveId: "user123",
        msgType: "text" as const,
        content: "Hello",
      };

      const result = await controller.sendMessage(body);

      expect(result).toEqual({
        success: false,
        error: "Network error",
      });
    });

    it("should return unknown error string for non-Error throws", async () => {
      feishuService.sendMessage.mockRejectedValue("string error");

      const body = {
        receiveId: "user123",
        msgType: "text" as const,
        content: "Hello",
      };

      const result = await controller.sendMessage(body);

      expect(result).toEqual({
        success: false,
        error: "Unknown error",
      });
    });
  });
});

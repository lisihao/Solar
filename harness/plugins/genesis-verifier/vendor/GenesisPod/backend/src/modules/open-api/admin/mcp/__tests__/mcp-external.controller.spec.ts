/**
 * Unit Tests - MCPExternalController
 */

import { NotFoundException } from "@nestjs/common";
import { MCPExternalController } from "../external-servers.controller";
import { MCPClientRegistryService } from "../../../ai-engine/tools/adapters/mcp/registry/mcp-client-registry.service";
import {
  CreateExternalServerDto,
  UpdateExternalServerDto,
} from "../mcp-external-admin.dto";

function makeRegistryService(): jest.Mocked<MCPClientRegistryService> {
  return {
    getConnectionStatuses: jest.fn(),
    addServer: jest.fn(),
    updateServer: jest.fn(),
    removeServer: jest.fn(),
    findById: jest.fn(),
    connectServer: jest.fn(),
    disconnectServer: jest.fn(),
    discoverTools: jest.fn(),
  } as unknown as jest.Mocked<MCPClientRegistryService>;
}

describe("MCPExternalController", () => {
  let controller: MCPExternalController;
  let registryService: jest.Mocked<MCPClientRegistryService>;

  beforeEach(() => {
    registryService = makeRegistryService();
    controller = new MCPExternalController(registryService);
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe("findAll", () => {
    it("should return all connection statuses", async () => {
      const statuses = [
        { id: "1", name: "Server A", connected: true },
        { id: "2", name: "Server B", connected: false },
      ];
      registryService.getConnectionStatuses.mockResolvedValue(
        statuses as never,
      );

      const result = await controller.findAll();
      expect(result).toEqual(statuses);
      expect(registryService.getConnectionStatuses).toHaveBeenCalledTimes(1);
    });

    it("should propagate errors from registry service", async () => {
      registryService.getConnectionStatuses.mockRejectedValue(
        new Error("DB error"),
      );
      await expect(controller.findAll()).rejects.toThrow("DB error");
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe("create", () => {
    it("should call addServer with DTO fields", async () => {
      const dto: CreateExternalServerDto = {
        serverId: "my-server",
        name: "My Server",
        transport: "http",
        url: "http://localhost:4000",
      };

      const created = { id: "db-1", ...dto };
      registryService.addServer.mockResolvedValue(created as never);

      const result = await controller.create(dto);
      expect(result).toEqual(created);
      expect(registryService.addServer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: "my-server",
          name: "My Server",
          transport: "http",
          url: "http://localhost:4000",
        }),
      );
    });

    it("should pass optional metadata to addServer", async () => {
      const dto: CreateExternalServerDto = {
        serverId: "s1",
        name: "S1",
        transport: "sse",
        url: "http://sse.host/sse",
        metadata: { category: "data" },
      };

      registryService.addServer.mockResolvedValue({
        id: "db-2",
        ...dto,
      } as never);

      await controller.create(dto);
      expect(registryService.addServer).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { category: "data" } }),
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe("update", () => {
    it("should call updateServer with correct id and DTO", async () => {
      const dto: UpdateExternalServerDto = {
        name: "Updated Name",
        enabled: true,
      };
      const updated = { id: "db-1", serverId: "s1", name: "Updated Name" };
      registryService.updateServer.mockResolvedValue(updated as never);

      const result = await controller.update("db-1", dto);
      expect(result).toEqual(updated);
      expect(registryService.updateServer).toHaveBeenCalledWith(
        "db-1",
        expect.objectContaining({ name: "Updated Name", enabled: true }),
      );
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe("remove", () => {
    it("should call removeServer with the id", async () => {
      registryService.removeServer.mockResolvedValue({ id: "db-1" } as never);

      const result = await controller.remove("db-1");
      expect(result).toEqual({ id: "db-1" });
      expect(registryService.removeServer).toHaveBeenCalledWith("db-1");
    });
  });

  // ─── connect ──────────────────────────────────────────────────────────────

  describe("connect", () => {
    it("should throw NotFoundException when server not found", async () => {
      registryService.findById.mockResolvedValue(null as never);

      await expect(controller.connect("db-999")).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.connect("db-999")).rejects.toThrow(
        "External MCP server not found: db-999",
      );
    });

    it("should connect and return status", async () => {
      const server = { id: "db-1", serverId: "s1", name: "Server 1" };
      registryService.findById.mockResolvedValue(server as never);
      registryService.connectServer.mockResolvedValue(undefined as never);

      const result = await controller.connect("db-1");
      expect(result).toEqual({ status: "connected", serverId: "s1" });
      expect(registryService.connectServer).toHaveBeenCalledWith("s1");
    });

    it("should propagate error from connectServer", async () => {
      const server = { id: "db-1", serverId: "s1", name: "Server 1" };
      registryService.findById.mockResolvedValue(server as never);
      registryService.connectServer.mockRejectedValue(
        new Error("Connection failed"),
      );

      await expect(controller.connect("db-1")).rejects.toThrow(
        "Connection failed",
      );
    });
  });

  // ─── disconnect ───────────────────────────────────────────────────────────

  describe("disconnect", () => {
    it("should throw NotFoundException when server not found", async () => {
      registryService.findById.mockResolvedValue(null as never);

      await expect(controller.disconnect("db-999")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should disconnect and return status", async () => {
      const server = { id: "db-1", serverId: "s1", name: "Server 1" };
      registryService.findById.mockResolvedValue(server as never);
      registryService.disconnectServer.mockResolvedValue(undefined as never);

      const result = await controller.disconnect("db-1");
      expect(result).toEqual({ status: "disconnected", serverId: "s1" });
      expect(registryService.disconnectServer).toHaveBeenCalledWith("s1");
    });
  });

  // ─── listTools ────────────────────────────────────────────────────────────

  describe("listTools", () => {
    it("should throw NotFoundException when server not found", async () => {
      registryService.findById.mockResolvedValue(null as never);

      await expect(controller.listTools("db-999")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return discovered tools", async () => {
      const server = { id: "db-1", serverId: "s1", name: "Server 1" };
      const tools = [{ name: "tool1", description: "A tool", inputSchema: {} }];
      registryService.findById.mockResolvedValue(server as never);
      registryService.discoverTools.mockResolvedValue(tools as never);

      const result = await controller.listTools("db-1");
      expect(result).toEqual(tools);
      expect(registryService.discoverTools).toHaveBeenCalledWith("s1");
    });

    it("should propagate error from discoverTools", async () => {
      const server = { id: "db-1", serverId: "s1", name: "Server 1" };
      registryService.findById.mockResolvedValue(server as never);
      registryService.discoverTools.mockRejectedValue(
        new Error("Discovery failed"),
      );

      await expect(controller.listTools("db-1")).rejects.toThrow(
        "Discovery failed",
      );
    });
  });
});

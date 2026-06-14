/**
 * MCPRelay — 把远端 MCP server 的 tool 注册到本地 ToolRegistry
 *
 * AI App 友好用法：
 *   await mcpRelay.registerServer({
 *     id: "linear",
 *     transport: { kind: "http", url: "https://linear-mcp.example.com/mcp" },
 *   });
 *   // 现在 ToolRegistry 多了 mcp:linear/list_issues, mcp:linear/create_issue, ...
 *   // AI App 在 spec.tools 直接 ['mcp:linear/list_issues'] 即可使用
 *
 * 实现要点：
 *   - MCP SDK 是 ESM；本服务用 dynamic import 懒加载，避免 CJS 项目启动报错
 *   - listTools 后 batch 注册；每个 tool 包成 MCPToolAdapter
 *   - 重复 registerServer 同 id 会先 unregister 旧 tools 再加新的
 *   - 服务关闭时 disconnect 全部 client
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ToolRegistry } from "../../registry/tool.registry";
import {
  MCPRelayToolAdapter,
  type MCPClientLike,
  type MCPToolDescriptor,
} from "./mcp-relay-tool-adapter";

export interface MCPHttpTransport {
  readonly kind: "http";
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export interface MCPStdioTransport {
  readonly kind: "stdio";
  readonly command: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
}

export type MCPTransportConfig = MCPHttpTransport | MCPStdioTransport;

export interface MCPServerConfig {
  /** 唯一 server id —— 注册后 tool id 形如 mcp:<id>/<toolName> */
  readonly id: string;
  readonly transport: MCPTransportConfig;
  /** 拒绝注册的 tool name（黑名单；正则 / 精确匹配） */
  readonly excludeTools?: readonly (string | RegExp)[];
}

interface ConnectedServer {
  config: MCPServerConfig;
  client: MCPClientLike & { close?: () => Promise<void> };
  toolIds: string[];
}

@Injectable()
export class MCPRelay implements OnModuleDestroy {
  private readonly log = new Logger(MCPRelay.name);
  private readonly servers = new Map<string, ConnectedServer>();
  private mcpModule:
    | typeof import("@modelcontextprotocol/sdk/client/index.js")
    | null = null;

  constructor(private readonly toolRegistry: ToolRegistry) {}

  /**
   * 注册一个 MCP server。listTools → 全部包成 MCPToolAdapter 注册到 ToolRegistry。
   */
  async registerServer(config: MCPServerConfig): Promise<{
    registered: string[];
    skipped: string[];
  }> {
    if (this.servers.has(config.id)) {
      await this.unregisterServer(config.id);
    }

    const client = await this.connect(config);

    let toolList: { tools?: MCPToolDescriptor[] };
    try {
      toolList = await (
        client as unknown as {
          listTools: () => Promise<{ tools?: MCPToolDescriptor[] }>;
        }
      ).listTools();
    } catch (err) {
      this.log.warn(
        `[${config.id}] listTools failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const registered: string[] = [];
    const skipped: string[] = [];
    for (const tool of toolList.tools ?? []) {
      if (this.isExcluded(tool.name, config.excludeTools)) {
        skipped.push(tool.name);
        continue;
      }
      const adapter = new MCPRelayToolAdapter(config.id, tool, client);
      this.toolRegistry.register(adapter);
      registered.push(adapter.id);
    }

    this.servers.set(config.id, {
      config,
      client,
      toolIds: registered,
    });
    this.log.log(
      `[${config.id}] MCP server registered: ${registered.length} tools (skipped ${skipped.length})`,
    );
    return { registered, skipped };
  }

  /**
   * 卸载一个 server：从 ToolRegistry 移除其所有 tool；关闭 client。
   */
  async unregisterServer(serverId: string): Promise<void> {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    for (const id of entry.toolIds) {
      this.toolRegistry.unregister(id);
    }
    await entry.client.close?.().catch(() => {
      /* ignore */
    });
    this.servers.delete(serverId);
    this.log.log(
      `[${serverId}] MCP server unregistered (removed ${entry.toolIds.length} tools)`,
    );
  }

  /** 列出所有已注册 server */
  listServers(): readonly { id: string; toolCount: number }[] {
    return [...this.servers.values()].map((s) => ({
      id: s.config.id,
      toolCount: s.toolIds.length,
    }));
  }

  /**
   * 测试 hook：注入一个伪 MCP client（避开真实网络）。
   * 仅 NODE_ENV !== "production" 才允许。
   */
  registerMockServer(config: MCPServerConfig, client: MCPClientLike): void {
    if (process.env.NODE_ENV === "production") {
      throw new Error("registerMockServer is forbidden in production");
    }
    if (this.servers.has(config.id)) {
      // sync unregister — the mock has no real close()
      const old = this.servers.get(config.id)!;
      for (const id of old.toolIds) this.toolRegistry.unregister(id);
      this.servers.delete(config.id);
    }
    this.servers.set(config.id, { config, client, toolIds: [] });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.servers.keys()].map((id) =>
        this.unregisterServer(id).catch(() => {
          /* */
        }),
      ),
    );
  }

  // ── private ──

  private async connect(
    config: MCPServerConfig,
  ): Promise<MCPClientLike & { close?: () => Promise<void> }> {
    const mod = await this.loadSdk();
    if (config.transport.kind === "http") {
      // Streamable HTTP transport (MCP 1.x).
      const sse = await import("@modelcontextprotocol/sdk/client/sse.js");
      const transport = new sse.SSEClientTransport(
        new URL(config.transport.url),
        {
          requestInit: { headers: config.transport.headers },
        },
      );
      const client = new mod.Client(
        { name: "genesis-harness", version: "1.0" },
        { capabilities: {} },
      );
      await client.connect(transport);
      return client as unknown as MCPClientLike & {
        close?: () => Promise<void>;
      };
    }
    // stdio transport
    const stdio =
      await import("@modelcontextprotocol/sdk/client/stdio.js").catch(
        () => null,
      );
    if (!stdio) {
      throw new Error(
        "MCP stdio transport not available — install @modelcontextprotocol/sdk with stdio support",
      );
    }
    const transport = new (
      stdio as unknown as {
        StdioClientTransport: new (params: {
          command: string;
          args?: string[];
          env?: Record<string, string>;
        }) => unknown;
      }
    ).StdioClientTransport({
      command: config.transport.command,
      args: config.transport.args,
      env: config.transport.env,
    });
    const client = new mod.Client(
      { name: "genesis-harness", version: "1.0" },
      { capabilities: {} },
    );
    await client.connect(transport as never);
    return client as unknown as MCPClientLike & { close?: () => Promise<void> };
  }

  private async loadSdk(): Promise<
    typeof import("@modelcontextprotocol/sdk/client/index.js")
  > {
    if (!this.mcpModule) {
      this.mcpModule =
        await import("@modelcontextprotocol/sdk/client/index.js");
    }
    return this.mcpModule;
  }

  private isExcluded(
    name: string,
    list?: readonly (string | RegExp)[],
  ): boolean {
    if (!list || list.length === 0) return false;
    return list.some((p) =>
      typeof p === "string" ? p === name : p.test(name),
    );
  }
}


/**
 * ENG-002 MCP SSRF 闸门证明 —— 用**真实** SsrfGuard（不 mock），证明 streamable-http
 * MCP client 连接前会拦截云元数据 / 私网 / loopback URL（防把用户配置的 MCP server URL
 * 当 SSRF 跳板打内网）。端口放行（MCP 跑任意端口），但目的 IP 私网/元数据仍拦。
 */
import { StreamableHttpMCPClient } from "../streamable-http-mcp-client";
import { MCPServerConfig } from "../../abstractions/mcp.interface";

function cfg(url: string): MCPServerConfig {
  return {
    id: "ssrf-test",
    name: "ssrf",
    transport: "http",
    url,
    timeout: 5000,
  } as MCPServerConfig;
}

describe("ENG-002 MCP SSRF guard (streamable-http, real guard)", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data", // 云元数据（最高危）
    "http://10.0.0.1:8080/mcp", // 私网（端口放行但 IP 拦）
    "http://127.0.0.1:3001", // loopback
  ])(
    "blocks connect to %s",
    async (url) => {
      const client = new StreamableHttpMCPClient(cfg(url));
      await expect(client.connect()).rejects.toThrow();
    },
    15000,
  );
});

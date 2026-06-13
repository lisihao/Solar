# 001. MCP Transport Layer Extension

**Date**: 2026-02-05
**Status**: Proposed

## Background

GenesisPod currently implements MCP (Model Context Protocol) with stdio transport only (`StdioMCPClient`), limited to local child processes. The MCP 2025-11 specification introduced Streamable HTTP as the primary transport mechanism, enabling remote server connectivity. With 13,000+ MCP servers in the ecosystem, GenesisPod needs multi-transport support to access them.

## Decision

Extend the MCP client architecture with three transport modes:

1. **Streamable HTTP** (primary): Bidirectional communication via HTTP POST + SSE, supporting session management and long-running operations
2. **SSE** (fallback): Server-push only, for legacy MCP servers
3. **Stdio** (local): Existing implementation for local process communication

Implement a transport factory that auto-selects the appropriate transport based on server configuration and capability negotiation.

## Rationale

- Streamable HTTP is the recommended transport in MCP 2025-11 spec
- SSE fallback ensures compatibility with older servers
- Transport factory pattern keeps client code transport-agnostic
- Aligns with `BaseMCPClient` abstract pattern already in codebase

## Impact

- **Positive**: Access to entire MCP server ecosystem, remote server support
- **Positive**: Non-breaking change, extends existing architecture
- **Negative**: Added complexity in connection management
- **Risk**: Remote server reliability, latency considerations

## Alternatives Considered

1. **WebSocket transport**: Not in MCP spec, would require custom protocol
2. **gRPC transport**: Mentioned in A2A but not standard in MCP
3. **HTTP-only (no SSE)**: Would lose streaming capabilities

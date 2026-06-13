# 002. Expose GenesisPod Capabilities as MCP Server

**Date**: 2026-02-05
**Status**: Proposed

## Background

MCP has become the universal standard for AI tool integration. Claude Code, Cursor, ChatGPT Desktop, and other AI tools can connect to any MCP server to extend their capabilities. By exposing GenesisPod's unique capabilities (deep research, multi-agent teams, content generation) as an MCP server, GenesisPod can serve as a backend capability provider for the entire AI tool ecosystem.

## Decision

Implement a standalone MCP Server module in GenesisPod that:

1. Exposes 5 core tools: `genesis/research`, `genesis/write`, `genesis/teams/debate`, `genesis/teams/analyze`, `genesis/slides`
2. Uses Streamable HTTP transport for external access
3. Authenticates via API key (reusing existing BYOK infrastructure)
4. Supports streaming responses via SSE for long-running operations
5. Implements rate limiting and usage tracking per API key

## Rationale

- Turns GenesisPod from a consumer-only platform into a capability provider
- Enables integration with developer workflows (Claude Code, Cursor)
- Creates a new distribution channel for GenesisPod's core AI capabilities
- API key model aligns with existing BYOK system
- Low implementation cost: wraps existing services, no new AI logic

## Impact

- **Positive**: New market reach (developer tools), platform network effects
- **Positive**: Forces clean API design for core capabilities
- **Negative**: Must maintain backward compatibility once external tools depend on it
- **Risk**: Performance under external load, cost management for hosted research

## Alternatives Considered

1. **REST API only**: Simpler but not compatible with MCP ecosystem
2. **GraphQL endpoint**: Better for complex queries but no MCP tool auto-discovery
3. **OpenAPI + MCP adapter**: Extra layer, more maintenance

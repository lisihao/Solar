# Architecture Skills

> System design and architectural patterns for GenesisPod.

## Skills Overview

| Skill                                                       | Description                        | Trigger Keywords                  |
| ----------------------------------------------------------- | ---------------------------------- | --------------------------------- |
| [document-processor](document-processor/SKILL.md)           | Document parsing and generation    | document, parser, export          |
| [mcp-builder](mcp-builder/SKILL.md)                         | MCP server development             | mcp, tool, server                 |
| [schema-architect](schema-architect/SKILL.md)               | Database schema design             | schema, prisma, migration         |
| [secret-tool-integration](secret-tool-integration/SKILL.md) | Secret + Tool + binding full-stack | secret, tool, api key, credential |
| [security-specialist](security-specialist/SKILL.md)         | Authentication and authorization   | auth, jwt, rbac, security         |

## Quick Reference

### Architecture Decision Flow

```
1. Schema changes? → schema-architect
2. Auth/Security? → security-specialist
3. Document handling? → document-processor
4. MCP integration? → mcp-builder
5. Add secret/tool/API key? → secret-tool-integration
```

### Key Patterns

- **Database**: Prisma ORM with PostgreSQL
- **Auth**: JWT + RBAC with NestJS Guards
- **Documents**: Template-based generation with multiple formats

## Related Categories

- [AI](../ai/README.md) - AI architecture layering
- [Development](../development/README.md) - Implementation patterns

---
name: Schema Architect
description: |
  System architecture, data modeling, ADRs, and cross-module interfaces.
  Trigger keywords: schema, architecture, adr, data model, migration, prisma
  Not for: API endpoints (-> api-developer), Security (-> security-specialist)
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash]
tags: [architecture, schema, adr, design, data-modeling]
boundaries:
  includes:
    - System architecture design
    - Data model and schema design
    - ADR creation and maintenance
    - Cross-module interface definition
    - Migration strategy planning
  excludes:
    - API endpoint implementation
    - Security implementation
  handoff:
    - skill: api-developer
      when: API implementation needed
    - skill: security-specialist
      when: Security design needed
---

# Schema Architect

> Detailed docs: `references/`

## Architecture Lifecycle

```
Requirements → Design → Document → Review → Implement → Evolve
     ↓           ↓         ↓         ↓          ↓         ↓
    PRD      Schema      ADR      Meeting    Code      ADR
            Design                          Review    Update
```

## Key Files

```
docs/architecture/
├── decisions/           # ADRs
├── diagrams/            # Mermaid diagrams
└── standards/           # Design standards

backend/prisma/
└── schema.prisma        # PostgreSQL schema

backend/src/common/
├── interfaces/          # Cross-module interfaces
└── types/               # Shared types
```

## Schema Design Principles

1. **Single Source of Truth**: One authoritative location per entity
2. **Explicit Relationships**: No implicit foreign keys
3. **Versioning**: Support schema evolution
4. **Audit Trail**: Track who/when/what changed
5. **Soft Deletes**: Never hard delete important data

## Entity Pattern

```typescript
interface BaseEntity {
  id: string; // UUID
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date; // Soft delete
  createdBy?: string;
  version: number; // Optimistic locking
}
```

## Module Dependency Rules

```
App Module
    ↓
AI │ Content │ Data │ Export
    ↓
Common Module (ai-orchestration, prisma, utils)

✓ Upper → Lower
✓ Same level → Same level
✗ Lower → Upper
✗ Circular dependencies
```

## Commands

```bash
npx prisma format          # Format schema
npx prisma validate        # Validate schema
npx prisma migrate dev     # Create and apply migration
npx prisma studio          # Visual database browser
```

## Related Docs

- [Schema Design Guide](references/schema-design.md)
- [Migration Strategy](references/migration.md)
- [ADR Guidelines](references/adr-guidelines.md)

---
name: Secret-Tool Integration
description: |
  Adding new secrets, tools, and secret-tool bindings across the full stack.
  Trigger keywords: secret, tool, api key, credential, secret mapping, tool config
  Not for: Secret encryption internals (-> security-specialist), Schema migration (-> schema-architect)
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash]
tags: [secret, tool, api-key, configuration, admin]
boundaries:
  includes:
    - Adding new SecretCategory enum values
    - Adding new tool entries (frontend + backend)
    - Adding secret name mappings
    - Wiring tool-to-secret references
    - Frontend ConfigureModal secret selection
  excludes:
    - Encryption algorithm changes
    - Auth/RBAC changes
    - Tool execution logic (business logic inside the tool)
  handoff:
    - skill: schema-architect
      when: Need new Prisma model or migration SQL
    - skill: security-specialist
      when: Changing encryption or access control
    - skill: api-developer
      when: Adding new API endpoints beyond tool config
---

# Secret-Tool Integration

> Detailed checklist: `references/checklist.md`

## Overview

Adding a new secret field + tool + tool-secret binding touches **7 files across 4 layers**. Missing any one causes runtime failures or UI bugs. This skill exists because multiple sessions suffered from partial implementations.

## The 7 Touchpoints (Mandatory)

```
Layer          File                                              What to add
─────          ────                                              ───────────
1. DB Schema   prisma/schema/models.prisma                      SecretCategory enum value (if new category)
2. DB Migrate  prisma/migrations/YYYYMMDD_xxx/migration.sql     ALTER TYPE ADD VALUE
3. Backend Map secret-name-mapping.ts                           EXTERNAL_TOOL_SECRET_MAPPING + SECRET_NAMES
4. Backend Def ai-admin.service.ts                              EXTERNAL_TOOL_DEFINITIONS entry
5. Frontend Def ToolsManagement.tsx                             EXTERNAL_TOOL_DEFINITIONS entry
6. Frontend Map ConfigureModal.tsx                              CATEGORY_TO_SECRET_CATEGORY mapping
7. Prisma Gen  npx prisma generate                              Update Prisma Client types
```

## Decision Tree

```
Adding a new tool?
├── Does an existing SecretCategory fit? (SEARCH, EXTRACTION, TTS, etc.)
│   ├── YES → Skip steps 1-2, go to step 3
│   └── NO  → Do all 7 steps
│
├── Does the tool need an API key?
│   ├── YES → All steps apply
│   └── NO  → Set noKeyRequired: true in frontend def, skip secret mapping
│
└── Is it just adding a new secret to an existing category?
    └── Only steps 3 + 7 (mapping + prisma generate)
```

## File Locations (Quick Reference)

```
backend/prisma/schema/models.prisma:7559          → enum SecretCategory
backend/src/modules/platform/credentials/secrets/
  secret-name-mapping.ts                           → EXTERNAL_TOOL_SECRET_MAPPING, SECRET_NAMES
  secrets.service.ts                               → SecretsService (encryption/CRUD)
backend/src/modules/open-api/admin/
  ai-admin.service.ts:43                           → EXTERNAL_TOOL_DEFINITIONS (backend)
frontend/components/admin/
  ToolsManagement.tsx:42                           → EXTERNAL_TOOL_DEFINITIONS (frontend)
  tools/ConfigureModal.tsx:30                      → CATEGORY_TO_SECRET_CATEGORY
```

## Common Mistakes (from real incidents)

| Mistake                                                     | Consequence                                   | Prevention                                  |
| ----------------------------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| Added tool in frontend but not backend                      | Tool shows in UI, configure fails silently    | Always add to BOTH definitions              |
| Added secret mapping but forgot CATEGORY_TO_SECRET_CATEGORY | ConfigureModal shows no secrets to select     | Check mapping exists for tool.category      |
| New category in Prisma but no migration SQL                 | `prisma generate` works locally, deploy fails | Always write migration SQL for enum changes |
| Hardcoded secret name instead of using SECRET_NAMES         | Name drift between mapping and usage          | Import from secret-name-mapping.ts          |
| Forgot `npx prisma generate` after schema change            | TypeScript types stale, errors at runtime     | Always run after schema changes             |
| Tool category mismatch between frontend/backend             | Secret filtering broken in ConfigureModal     | Use exact same category string              |
| Added to EXTERNAL_TOOL_SECRET_MAPPING but not SECRET_NAMES  | Services can't use convenience constant       | Always add both entries                     |

## Naming Conventions

| Item                     | Format                 | Example            |
| ------------------------ | ---------------------- | ------------------ |
| Secret name              | kebab-case             | `new-tool-api-key` |
| Tool ID                  | kebab-case             | `new-tool`         |
| SecretCategory           | SCREAMING_SNAKE        | `NEW_CATEGORY`     |
| SECRET_NAMES key         | SCREAMING_SNAKE        | `NEW_TOOL`         |
| Tool category (frontend) | kebab-case with prefix | `external-newtool` |

## Runtime Flow

```
Frontend ConfigureModal
  → filter secrets by CATEGORY_TO_SECRET_CATEGORY[tool.category]
  → user selects secret name (e.g., "new-tool-api-key")
  → PATCH /admin/ai/tools/:toolId { secretKey: "new-tool-api-key" }

Backend ai-admin.service.ts
  → validates secret exists via SecretsService.exists()
  → saves secretKey to ToolConfig.secretKey (reference, not value!)

Runtime tool execution
  → reads ToolConfig.secretKey → "new-tool-api-key"
  → calls SecretsService.getValueInternal("new-tool-api-key")
  → decrypts AES-256-CBC → returns plaintext API key
```

## Related Docs

- [Full Checklist with Code Templates](references/checklist.md)

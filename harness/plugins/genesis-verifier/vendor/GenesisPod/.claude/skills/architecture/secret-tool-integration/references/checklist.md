# Secret-Tool Integration: Full Checklist with Code Templates

> Execute steps in order. Each step includes the exact code to add and the file location.

## Pre-flight: Determine Scope

```
Q1: Is this a new category or existing?
    → New category: Do ALL 7 steps
    → Existing category (e.g., SEARCH): Skip steps 1-2

Q2: Does the tool need an API key?
    → No: Set noKeyRequired: true, skip secret mapping steps (3, 6)
    → Yes: Continue all steps
```

---

## Step 1: Add SecretCategory Enum (if new category)

**File**: `backend/prisma/schema/models.prisma` (line ~7559)

```prisma
enum SecretCategory {
  // ... existing values ...
  NEW_CATEGORY // Description of the new category
  OTHER
}
```

**Rules**:

- SCREAMING_SNAKE_CASE
- Add BEFORE `OTHER` (keep OTHER last)
- Add a comment describing the category

---

## Step 2: Write Migration SQL (if new category)

**File**: `backend/prisma/migrations/YYYYMMDD_add_new_category/migration.sql`

```sql
-- Add NEW_CATEGORY to SecretCategory enum
-- IMPORTANT: Do NOT wrap in DO $$ EXCEPTION block (creates subtransaction, breaks prisma migrate deploy)
ALTER TYPE "SecretCategory" ADD VALUE IF NOT EXISTS 'NEW_CATEGORY';
```

**Rules**:

- Directory name: `YYYYMMDD_descriptive_name/`
- Use `IF NOT EXISTS` for idempotency
- NEVER use `DO $$ BEGIN ... EXCEPTION ... END $$` to wrap ALTER TYPE (PostgreSQL subtransaction limitation)
- NEVER use `npx prisma migrate dev` (project uses hand-written SQL)

---

## Step 3: Add Secret Name Mapping

**File**: `backend/src/modules/platform/credentials/secrets/secret-name-mapping.ts`

### 3a. Add to EXTERNAL_TOOL_SECRET_MAPPING

```typescript
export const EXTERNAL_TOOL_SECRET_MAPPING: Record<string, string> = {
  // ... existing ...

  // ==================== New Category ====================
  "new-tool": "new-tool-api-key",
};
```

### 3b. Add to SECRET_NAMES

```typescript
export const SECRET_NAMES = {
  // ... existing ...

  // New Category
  NEW_TOOL: EXTERNAL_TOOL_SECRET_MAPPING["new-tool"],
} as const;
```

### 3c. (Optional) Add to SYSTEM_SETTING_TO_SECRET_MAPPING

Only if migrating from old SystemSetting-based storage:

```typescript
export const SYSTEM_SETTING_TO_SECRET_MAPPING = [
  // ... existing ...
  {
    key: "newcategory.newtool.apiKey",
    name: SECRET_NAMES.NEW_TOOL,
    displayName: "New Tool API Key",
    category: "NEW_CATEGORY",
    provider: "NewTool",
  },
];
```

**Naming rules**:

- Secret name: kebab-case, suffix `-api-key` (e.g., `new-tool-api-key`)
- SECRET_NAMES key: SCREAMING_SNAKE (e.g., `NEW_TOOL`)
- Must add to BOTH mappings, not just one

---

## Step 4: Add Backend Tool Definition

**File**: `backend/src/modules/open-api/admin/ai-admin.service.ts` (line ~43)

```typescript
const EXTERNAL_TOOL_DEFINITIONS: ExternalToolDefinition[] = [
  // ... existing ...
  {
    id: "new-tool",
    name: "New Tool Name",
    category: "New Category",
    url: "https://newtool.com",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING["new-tool"],
  },
];
```

**Also check**: If the tool has a different provider ID vs registry tool ID, add to `PROVIDER_TO_TOOL_ID`:

```typescript
private static readonly PROVIDER_TO_TOOL_ID: Record<string, string> = {
  // ... existing ...
  'new-tool': 'new-tool-search',  // Only if provider ID differs from registry tool ID
};
```

---

## Step 5: Add Frontend Tool Definition

**File**: `frontend/components/admin/ToolsManagement.tsx` (line ~42)

```typescript
const EXTERNAL_TOOL_DEFINITIONS: ExternalToolDefinition[] = [
  // ... existing ...
  {
    id: "new-tool", // Must match backend id
    name: "New Tool Name", // Display name
    category: "external-newcategory", // Must match CATEGORY_TO_SECRET_CATEGORY key
    url: "https://newtool.com", // "Get API Key" link
    // Optional fields:
    noKeyRequired: false, // true if free/no key needed
    freeQuota: "100/month", // Optional quota info
    pricing: "$5/month+", // Optional pricing info
  },
];
```

**Critical**: The `category` string must exactly match a key in `CATEGORY_TO_SECRET_CATEGORY` (Step 6). If it doesn't match, the ConfigureModal will show zero secrets.

---

## Step 6: Add Category Mapping in ConfigureModal

**File**: `frontend/components/admin/tools/ConfigureModal.tsx` (line ~30)

```typescript
const CATEGORY_TO_SECRET_CATEGORY: Record<string, string | null> = {
  "external-search": "SEARCH",
  "external-extraction": "EXTRACTION",
  // ... existing ...
  "external-newcategory": "NEW_CATEGORY", // Must match SecretCategory enum value
};
```

**Critical alignment**:

```
frontend tool.category    →  CATEGORY_TO_SECRET_CATEGORY key  →  SecretCategory enum value
'external-newcategory'    →  'external-newcategory'           →  'NEW_CATEGORY'
```

All three must be consistent. This is the #1 source of bugs.

---

## Step 7: Regenerate Prisma Client

```bash
npx prisma generate
```

This updates TypeScript types to include the new `SecretCategory` enum value.

---

## Post-Implementation Verification

### Checklist (must pass all)

```
[ ] 1. Schema: SecretCategory has new value (if applicable)
[ ] 2. Migration: SQL file exists with ALTER TYPE (if applicable)
[ ] 3. Mapping: EXTERNAL_TOOL_SECRET_MAPPING has entry
[ ] 4. Mapping: SECRET_NAMES has corresponding constant
[ ] 5. Backend: EXTERNAL_TOOL_DEFINITIONS has entry with correct secretKeyName
[ ] 6. Frontend: EXTERNAL_TOOL_DEFINITIONS has entry with correct category
[ ] 7. Frontend: CATEGORY_TO_SECRET_CATEGORY has mapping for tool category
[ ] 8. Prisma: `npx prisma generate` ran successfully
[ ] 9. Category alignment: tool.category → CATEGORY_TO_SECRET_CATEGORY → SecretCategory all consistent
[ ] 10. Type check: `npm run type-check` passes
```

### Quick Verification Commands

```bash
# Verify secret mapping exists
grep -n "new-tool" backend/src/modules/platform/credentials/secrets/secret-name-mapping.ts

# Verify backend tool definition
grep -n "new-tool" backend/src/modules/open-api/admin/ai-admin.service.ts

# Verify frontend tool definition
grep -n "new-tool" frontend/components/admin/ToolsManagement.tsx

# Verify category mapping
grep -n "external-newcategory" frontend/components/admin/tools/ConfigureModal.tsx

# Type check
npm run type-check
```

---

## Example: Adding "News API" Tool (Complete)

### Scenario

- New tool: News API (newsapi.org)
- Needs API key
- No existing category fits → need new `NEWS` category

### Step 1: Prisma schema

```prisma
enum SecretCategory {
  // ... existing ...
  NEWS // News data API (NewsAPI, etc.)
  OTHER
}
```

### Step 2: Migration SQL

```sql
-- File: backend/prisma/migrations/20260313_add_news_category/migration.sql
ALTER TYPE "SecretCategory" ADD VALUE IF NOT EXISTS 'NEWS';
```

### Step 3: Secret mapping

```typescript
// secret-name-mapping.ts
export const EXTERNAL_TOOL_SECRET_MAPPING = {
  // ...
  "news-api": "news-api-key",
};

export const SECRET_NAMES = {
  // ...
  NEWS_API: EXTERNAL_TOOL_SECRET_MAPPING["news-api"],
};
```

### Step 4: Backend definition

```typescript
// ai-admin.service.ts
{
  id: 'news-api',
  name: 'NewsAPI',
  category: 'News',
  url: 'https://newsapi.org',
  secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING['news-api'],
},
```

### Step 5: Frontend definition

```typescript
// ToolsManagement.tsx
{
  id: 'news-api',
  name: 'NewsAPI',
  category: 'external-news',
  url: 'https://newsapi.org',
  freeQuota: '100/day',
},
```

### Step 6: Category mapping

```typescript
// ConfigureModal.tsx
const CATEGORY_TO_SECRET_CATEGORY = {
  // ...
  "external-news": "NEWS",
};
```

### Step 7: Generate

```bash
npx prisma generate
```

---

## Anti-Patterns

### DO NOT

```typescript
// 1. Hardcode secret names
const key = await secretsService.getValueInternal("news-api-key"); // BAD
const key = await secretsService.getValueInternal(SECRET_NAMES.NEWS_API); // GOOD

// 2. Store API key value in ToolConfig
await prisma.toolConfig.update({
  data: { config: { apiKey: "sk-xxx" } }, // BAD: plaintext in DB
});
await prisma.toolConfig.update({
  data: { secretKey: "news-api-key" }, // GOOD: reference only
});

// 3. Skip either frontend or backend definition
// BAD: Tool shows in UI but backend doesn't recognize it
// BAD: Backend has it but UI can't configure it

// 4. Use mismatched category strings
// Frontend: category: 'external-news'
// ConfigureModal: 'news': 'NEWS'  // BAD: key doesn't match!
// ConfigureModal: 'external-news': 'NEWS'  // GOOD: exact match

// 5. Forget migration SQL for new enum values
// npx prisma generate works locally (uses in-memory schema)
// But production deploy fails because DB doesn't have the enum value
```

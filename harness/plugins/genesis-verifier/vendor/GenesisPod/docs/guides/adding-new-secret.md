# Adding a New Secret

Three scenarios — pick the one that matches your case.

---

## Scenario 1: New LLM Provider

**When**: You integrated a new LLM provider (e.g. "Qwen") and stored its API key in the Secret Manager.  
**UI effect**: The key automatically appears in the "Model Provider Keys" (B class) section — no warning, no configure button.  
**Code change needed**: One line.

### File to edit

`backend/src/modules/platform/credentials/secrets/secret-name.catalog.ts`

### Change

```diff
 export const LLM_PROVIDER_NAME_PATTERNS: readonly string[] = [
   ...
   "yi-",
+  "qwen",         // Alibaba Cloud Qwen family
 ] as const;
```

### Verification

1. Start the backend: `npm run dev:backend`
2. Create a secret whose name contains `qwen` (e.g. `qwen-api-key`) via the Secrets Manager UI.
3. Open Admin → Secrets → "Platform Overview" panel.
4. The new secret should appear under **Model Provider Keys** with an "Active" badge. No warning, no "Configure" button.

### Type check

```bash
cd backend && npm run type-check
```

---

## Scenario 2: New Tool That Requires an API Key

**When**: You added a new external tool (e.g. `brave-search`) that needs its own API key configured by the admin.  
**UI effect**: The key appears in the "Platform Tool Keys" (A class) section with a "Configure" button and optional "Apply" link to the provider dashboard.

### Files to edit

1. `backend/src/modules/platform/credentials/secrets/secret-name.catalog.ts`

### Step A — Add the tool-to-secret mapping

In `EXTERNAL_TOOL_SECRET_MAPPING`:

```diff
   // ==================== Web Search ====================
   tavily: "tavily-search-api-key",
+  "brave-search": "brave-search-api-key",
```

### Step B — Add the preset slot entry

In `SYSTEM_SETTING_TO_SECRET_MAPPING`:

```diff
   {
     key: "search.serper.apiKey",
     name: SECRET_NAMES.SERPER,
     ...
   },
+  {
+    key: "search.brave.apiKey",
+    name: "brave-search-api-key",
+    displayName: "Brave Search API Key",
+    category: "SEARCH",
+    provider: "Brave",
+    setupGuideUrl: "https://api.search.brave.com/app/keys",
+    freeTierAvailable: true,
+    description: "Brave Search results API",
+  },
```

### Step C — Optionally add a `SECRET_NAMES` shortcut

```diff
 export const SECRET_NAMES = {
   TAVILY_SEARCH: EXTERNAL_TOOL_SECRET_MAPPING.tavily,
+  BRAVE_SEARCH: EXTERNAL_TOOL_SECRET_MAPPING["brave-search"],
   ...
 } as const;
```

### Verification

1. `npm run type-check` — must pass.
2. Open Admin → Secrets → "Platform Overview" panel.
3. `brave-search-api-key` appears in **Platform Tool Keys** with status "missing" and a "Configure" / "Apply" button.
4. After configuring the key, status changes to "configured".

---

## Scenario 3: User-Defined Custom Secret

**When**: A user or integration creates a secret with an arbitrary name (e.g. `my-slack-webhook-token`).  
**UI effect**: The key appears in the "Custom Secrets" (C class) section — no warning, no configure button.  
**Code change needed**: None. The classification falls through to "custom" automatically.

### How it works

`classifySecret(name)` in `secret-name.catalog.ts`:

1. Not in `SYSTEM_SETTING_TO_SECRET_MAPPING` → skip A class.
2. Name does not match any `LLM_PROVIDER_NAME_PATTERNS` token → skip B class.
3. Returns `"custom"` → key lands in `customSecrets` array.

### Verification

1. Create a secret with any arbitrary name (e.g. `my-slack-webhook-token`) via the Secrets Manager UI.
2. Open Admin → Secrets → "Platform Overview" panel.
3. The secret appears under **Custom Secrets** with an "Active" badge.
4. No warning color, no "Configure" or "Delete" button visible in the panel (management stays in the main Secrets table).

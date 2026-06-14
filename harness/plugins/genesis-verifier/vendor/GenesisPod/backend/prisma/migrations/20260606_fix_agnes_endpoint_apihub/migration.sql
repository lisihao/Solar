-- Correct the Agnes (Sapiens AI) provider endpoint to the OFFICIAL documented
-- gateway: https://apihub.agnes-ai.com/v1 (per agnes-ai.com/doc §2 Base URL).
--
-- History of wrong values this supersedes:
--   - https://agnes-ai.com/api/v1      → marketing site (Next.js); chat = 404 HTML
--   - https://api.agnes-ai.com/api/v1  → a different gateway that rejects Agnes keys
--                                        with {"code":"000501","invalid or expired token"}
-- The documented gateway apihub.agnes-ai.com/v1 is an OpenAI-compatible (new-api)
-- endpoint: POST /v1/chat/completions, GET /v1/models, Bearer auth.
--
-- AiProvidersSeeder is create-only (never updates existing rows), so update the live
-- system row here. Scope=system only; user-scoped custom rows untouched. Idempotent.
UPDATE "ai_providers"
SET endpoint = 'https://apihub.agnes-ai.com/v1'
WHERE slug = 'agnes'
  AND scope = 'system'
  AND endpoint <> 'https://apihub.agnes-ai.com/v1';

-- Fix Agnes (Sapiens AI) provider endpoint: the authenticated chat gateway lives on
-- the `api.` subdomain, not the marketing root domain.
--
-- Root cause: seeded endpoint was https://agnes-ai.com/api/v1 (marketing site, Next.js).
-- That root domain only serves a public GET /api/v1/models (200); its
-- /api/v1/chat/completions returns 404 HTML, so every connection test failed with a
-- 404 HTML page. The real authenticated gateway is https://api.agnes-ai.com/api/v1
-- (verified: POST .../api/v1/chat/completions returns JSON 401 "invalid or expired
-- token" with a bad key = route exists + enforces auth; a valid key connects).
--
-- AiProvidersSeeder is create-only (never updates existing rows), so the catalog edit
-- alone does not fix already-seeded databases — this migration updates the live row.
-- Scope=system only; user-scoped custom rows are untouched. Idempotent.
UPDATE "ai_providers"
SET endpoint = 'https://api.agnes-ai.com/api/v1'
WHERE slug = 'agnes'
  AND scope = 'system'
  AND endpoint = 'https://agnes-ai.com/api/v1';

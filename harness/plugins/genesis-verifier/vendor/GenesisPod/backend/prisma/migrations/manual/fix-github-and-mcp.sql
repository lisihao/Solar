-- Manual Migration: Fix GitHub Secret Category and MCP Package Names
-- Run this SQL on your production database
-- Date: 2026-01-21

-- ============================================
-- 1. Fix GitHub secret category to DEV_TOOLS
-- ============================================
UPDATE "secrets"
SET category = 'DEV_TOOLS'
WHERE (LOWER(name) LIKE '%github%' OR LOWER(display_name) LIKE '%github%')
  AND category != 'DEV_TOOLS';

-- ============================================
-- 2. Fix MCP server package names
-- Note: args is text[] array type, use array_replace() instead of jsonb
-- ============================================

-- Fix GitHub server package name
UPDATE "mcp_server_configs"
SET args = array_replace(args, '@anthropics/mcp-server-github', '@modelcontextprotocol/server-github')
WHERE '@anthropics/mcp-server-github' = ANY(args);

-- Fix DuckDuckGo server package name
UPDATE "mcp_server_configs"
SET args = array_replace(args, '@anthropics/mcp-server-duckduckgo', '@modelcontextprotocol/server-ddg-search')
WHERE '@anthropics/mcp-server-duckduckgo' = ANY(args);

-- Fix Filesystem server package name
UPDATE "mcp_server_configs"
SET args = array_replace(args, '@anthropics/mcp-server-filesystem', '@modelcontextprotocol/server-filesystem')
WHERE '@anthropics/mcp-server-filesystem' = ANY(args);

-- ============================================
-- Verification queries (run after migration)
-- ============================================

-- Check GitHub secrets
-- SELECT name, display_name, category FROM secrets WHERE LOWER(name) LIKE '%github%' OR LOWER(display_name) LIKE '%github%';

-- Check MCP server configs
-- SELECT server_id, name, args FROM "mcp_server_configs";

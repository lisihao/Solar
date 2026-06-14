-- Fix MCP server package names from @anthropics to @modelcontextprotocol
-- This migration corrects the npm package names for MCP servers
-- Note: args is text[] array type, use array_replace() instead of jsonb

-- Fix GitHub server
UPDATE "mcp_server_configs"
SET args = array_replace(args, '@anthropics/mcp-server-github', '@modelcontextprotocol/server-github')
WHERE '@anthropics/mcp-server-github' = ANY(args);

-- Fix DuckDuckGo server
UPDATE "mcp_server_configs"
SET args = array_replace(args, '@anthropics/mcp-server-duckduckgo', '@modelcontextprotocol/server-ddg-search')
WHERE '@anthropics/mcp-server-duckduckgo' = ANY(args);

-- Fix Filesystem server
UPDATE "mcp_server_configs"
SET args = array_replace(args, '@anthropics/mcp-server-filesystem', '@modelcontextprotocol/server-filesystem')
WHERE '@anthropics/mcp-server-filesystem' = ANY(args);

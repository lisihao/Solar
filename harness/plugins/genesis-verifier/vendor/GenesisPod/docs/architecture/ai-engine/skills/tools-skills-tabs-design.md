# Tools & Skills Management - Tabs Architecture Design

> **Version**: 1.0
> **Created**: 2025-01-20
> **Status**: Design Proposal

---

## Overview

This document outlines the architecture for implementing a tabbed interface for Tools and Skills management in the GenesisPod admin panel. The design separates local/built-in capabilities from external marketplace integrations.

---

## Architecture Summary

```
Admin Settings
├── Skills Management (2 Tabs)
│   ├── Local Skills - Installed .skill.md files
│   └── Skills Marketplace - Browse/install from SkillsMP
│
└── Tools Management (3 Tabs)
    ├── Built-in Tools - Core system tools
    ├── External Tools - API integrations
    └── MCP Marketplace - MCP server management
```

---

## 1. Skills Management

### 1.1 Local Skills Tab

**Purpose**: Display and manage locally installed skills from `.skill.md` files.

#### Features

- List all skills from `backend/skills/` directory
- Display skill metadata (name, description, version, author)
- Show skill status (active/inactive)
- Enable/disable individual skills
- View skill documentation
- Delete/uninstall skills

#### UI Components

```typescript
interface LocalSkillsTabProps {
  searchQuery?: string;
}

interface LocalSkill {
  id: string;
  name: string;
  displayName: string;
  version: string;
  author: string;
  description: string;
  category: string; // 'ai' | 'data' | 'content' | 'workflow'
  filePath: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  dependencies?: string[];
}
```

#### UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ Local Skills (12)                         [+ Upload]    │
├─────────────────────────────────────────────────────────┤
│ Search: [___________]  Category: [All ▼]  Status: [All ▼]│
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ 📊 AI Architecture Layering        v2.0  [Active] │   │
│ │ By: GenesisPod Team                                 │   │
│ │ Design AI systems with clear architectural layers │   │
│ │ [View] [Edit] [Disable] [Delete]                  │   │
│ └───────────────────────────────────────────────────┘   │
│                                                           │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🔍 Topic Research Framework        v1.5 [Active]  │   │
│ │ By: Research Team                                 │   │
│ │ Structured approach for deep topic research       │   │
│ │ [View] [Edit] [Disable] [Delete]                  │   │
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### API Endpoints

```typescript
// GET /api/admin/skills/local
// Returns all locally installed skills
GET /admin/skills/local
Response: {
  skills: LocalSkill[];
  total: number;
}

// GET /api/admin/skills/local/:id
// Get single skill details
GET /admin/skills/local/:id

// PUT /api/admin/skills/local/:id/toggle
// Enable/disable a skill
PUT /admin/skills/local/:id/toggle
Body: { isActive: boolean }

// DELETE /api/admin/skills/local/:id
// Delete a skill file
DELETE /admin/skills/local/:id

// POST /api/admin/skills/local/upload
// Upload new skill file
POST /admin/skills/local/upload
Body: FormData (file)
```

---

### 1.2 Skills Marketplace Tab

**Purpose**: Browse and install skills from SkillsMP marketplace.

#### Features

- Browse available skills from SkillsMP
- Search and filter marketplace skills
- View skill ratings and download counts
- Preview skill documentation
- Install skills with one click
- Update installed skills
- View installed skills (show which are already installed)

#### UI Components

```typescript
interface MarketplaceSkillsTabProps {
  searchQuery?: string;
}

interface MarketplaceSkill {
  id: string;
  name: string;
  displayName: string;
  version: string;
  author: string;
  authorAvatar?: string;
  description: string;
  category: string;
  tags: string[];
  rating: number;
  downloads: number;
  updatedAt: string;
  isInstalled: boolean;
  installedVersion?: string;
  hasUpdate?: boolean;
  previewUrl: string;
  downloadUrl: string;
}
```

#### UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ Skills Marketplace                    [🔄 Refresh]      │
├─────────────────────────────────────────────────────────┤
│ Search: [___________]  Category: [All ▼]  Sort: [Popular ▼]│
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🎯 Advanced Prompt Engineering     v3.1           │   │
│ │ By: SkillsMP Community    ⭐ 4.8  📥 2.3k        │   │
│ │ Master advanced prompting techniques for AI       │   │
│ │ Tags: ai, prompting, llm                          │   │
│ │                      [Preview] [Install] [Installed]│   │
│ └───────────────────────────────────────────────────┘   │
│                                                           │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 📈 Data Visualization Patterns    v2.0  UPDATE!   │   │
│ │ By: DataViz Team      ⭐ 4.6  📥 1.8k            │   │
│ │ Create compelling data visualizations             │   │
│ │ Tags: data, visualization, charts                 │   │
│ │                      [Preview] [Update v2.0]      │   │
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### API Endpoints

```typescript
// GET /api/admin/skills/marketplace
// Browse marketplace skills
GET /admin/skills/marketplace?page=1&limit=20&category=ai&sort=popular
Response: {
  skills: MarketplaceSkill[];
  total: number;
  page: number;
  limit: number;
}

// GET /api/admin/skills/marketplace/:id
// Get marketplace skill details
GET /admin/skills/marketplace/:id

// POST /api/admin/skills/marketplace/:id/install
// Install a skill from marketplace
POST /admin/skills/marketplace/:id/install
Body: { version?: string }
Response: { success: boolean; skill: LocalSkill }

// POST /api/admin/skills/marketplace/:id/update
// Update an installed skill
POST /admin/skills/marketplace/:id/update
Response: { success: boolean; skill: LocalSkill }
```

---

## 2. Tools Management

### 2.1 Built-in Tools Tab

**Purpose**: Display and manage core system tools that are part of the GenesisPod.

#### Tool Categories

1. **Information Tools**
   - Web Search (Tavily, Serper, etc.)
   - Knowledge Base Search
   - Document Retrieval

2. **Content Tools**
   - Web Scraping
   - URL Extraction
   - Content Summarization

3. **Data Tools**
   - Data Analysis
   - Chart Generation
   - Table Processing

4. **Code Tools**
   - Code Execution (Python, JavaScript)
   - Code Analysis
   - API Testing

#### UI Components

```typescript
interface BuiltinToolsTabProps {
  searchQuery?: string;
}

interface BuiltinTool {
  id: string;
  name: string;
  displayName: string;
  category: "information" | "content" | "data" | "code";
  description: string;
  capabilities: string[];
  isEnabled: boolean;
  configuration?: Record<string, unknown>;
  usageStats?: {
    totalCalls: number;
    lastUsed?: string;
  };
}
```

#### UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ Built-in Tools                                           │
├─────────────────────────────────────────────────────────┤
│ Category: [All ▼]  Status: [All ▼]                       │
├─────────────────────────────────────────────────────────┤
│ Information Tools (5)                                     │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🔍 Web Search                          [Enabled]  │   │
│ │ Search the web using multiple providers            │   │
│ │ Capabilities: Real-time search, Multi-source       │   │
│ │ Usage: 1,234 calls (Last: 2 hours ago)            │   │
│ │                              [Configure] [Disable] │   │
│ └───────────────────────────────────────────────────┘   │
│                                                           │
│ Content Tools (4)                                         │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🌐 Web Scraping                        [Enabled]  │   │
│ │ Extract content from web pages                     │   │
│ │ Capabilities: HTML parsing, Dynamic content        │   │
│ │ Usage: 856 calls (Last: 5 hours ago)              │   │
│ │                              [Configure] [Disable] │   │
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### API Endpoints

```typescript
// GET /api/admin/tools/builtin
// Get all built-in tools
GET /admin/tools/builtin?category=information
Response: {
  tools: BuiltinTool[];
  total: number;
}

// GET /api/admin/tools/builtin/:id
// Get tool details
GET /admin/tools/builtin/:id

// PUT /api/admin/tools/builtin/:id/toggle
// Enable/disable a tool
PUT /admin/tools/builtin/:id/toggle
Body: { isEnabled: boolean }

// PUT /api/admin/tools/builtin/:id/configure
// Update tool configuration
PUT /admin/tools/builtin/:id/configure
Body: { configuration: Record<string, unknown> }
```

---

### 2.2 External Tools Tab

**Purpose**: Manage API integrations and external tool connections.

#### Tool Categories

1. **Search APIs**
   - Google Search (API Key)
   - Serper (API Key)
   - Tavily (API Key)

2. **Extraction APIs**
   - Jina Reader (API Key)
   - Firecrawl (API Key)
   - ScrapingBee (API Key)

3. **Media APIs**
   - YouTube Data API (API Key)
   - Video Transcription

4. **Voice APIs**
   - OpenAI TTS (API Key)
   - ElevenLabs (API Key)
   - Azure Speech (API Key)

5. **Policy Research APIs**
   - Beijing Policy API (API Key)
   - National Policy API (API Key)
   - Custom Policy Sources

#### UI Components

```typescript
interface ExternalToolsTabProps {
  searchQuery?: string;
}

interface ExternalTool {
  id: string;
  name: string;
  displayName: string;
  category: "search" | "extraction" | "youtube" | "tts" | "policy";
  provider: string;
  description: string;
  secretName?: string; // Reference to secret in SecretsManager
  isConfigured: boolean;
  isActive: boolean;
  lastTestedAt?: string;
  testStatus?: "success" | "failed" | "pending";
  usageStats?: {
    totalCalls: number;
    lastUsed?: string;
    monthlyQuota?: number;
    monthlyUsage?: number;
  };
}
```

#### UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ External Tools                                           │
├─────────────────────────────────────────────────────────┤
│ Category: [All ▼]  Status: [All ▼]                       │
├─────────────────────────────────────────────────────────┤
│ Search APIs (3)                                           │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🔍 Tavily Search                   ✓ Configured   │   │
│ │ AI-optimized search API                            │   │
│ │ Provider: Tavily  |  Secret: TAVILY_API_KEY       │   │
│ │ Usage: 234/1000 calls this month                   │   │
│ │ Last tested: 1 hour ago - ✓ Success                │   │
│ │                [Test Connection] [Configure] [🔗]  │   │
│ └───────────────────────────────────────────────────┘   │
│                                                           │
│ Policy Research APIs (2)                                  │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🏛️ Beijing Policy API              ⚠️ Not Config  │   │
│ │ Access Beijing municipal policies and regulations  │   │
│ │ Provider: Beijing Gov  |  Secret: Not set         │   │
│ │ Last tested: Never                                 │   │
│ │                      [Add API Key] [Test] [View]   │   │
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### Integration with SecretsManager

External tools reference secrets stored in SecretsManager. The UI should:

- Link to SecretsManager for API key configuration
- Show secret status (configured/not configured)
- Allow testing API connections
- Display usage statistics if available

#### API Endpoints

```typescript
// GET /api/admin/tools/external
// Get all external tools
GET /admin/tools/external?category=search
Response: {
  tools: ExternalTool[];
  total: number;
}

// GET /api/admin/tools/external/:id
// Get tool details
GET /admin/tools/external/:id

// POST /api/admin/tools/external/:id/test
// Test API connection
POST /admin/tools/external/:id/test
Response: {
  success: boolean;
  message: string;
  latency?: number;
}

// PUT /api/admin/tools/external/:id/toggle
// Enable/disable a tool
PUT /admin/tools/external/:id/toggle
Body: { isActive: boolean }

// GET /api/admin/tools/external/:id/usage
// Get usage statistics
GET /admin/tools/external/:id/usage?period=month
Response: {
  totalCalls: number;
  period: string;
  quota?: number;
  breakdown: Array<{ date: string; calls: number }>;
}
```

---

### 2.3 MCP Marketplace Tab

**Purpose**: Manage Model Context Protocol (MCP) server connections.

#### Features

- Browse available MCP servers
- Connect to MCP servers (local or remote)
- Configure MCP server settings
- View connected servers and their status
- Test MCP server connections
- Enable/disable MCP servers
- View available tools from each MCP server

#### UI Components

```typescript
interface MCPMarketplaceTabProps {
  searchQuery?: string;
}

interface MCPServer {
  id: string;
  name: string;
  displayName: string;
  description: string;
  type: "local" | "remote";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  isConnected: boolean;
  isActive: boolean;
  status: "online" | "offline" | "error" | "connecting";
  lastPingAt?: string;
  tools: MCPTool[];
  metadata?: {
    version: string;
    author: string;
    repository?: string;
  };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPMarketplaceItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  rating: number;
  downloads: number;
  repository: string;
  installCommand: string;
  isInstalled: boolean;
}
```

#### UI Layout - Connected Servers

```
┌─────────────────────────────────────────────────────────┐
│ MCP Servers                            [+ Add Server]    │
├─────────────────────────────────────────────────────────┤
│ Connected Servers (3) | Marketplace                      │
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🟢 Filesystem MCP Server                 [Active] │   │
│ │ Type: Local  |  Status: Online                     │   │
│ │ Command: npx @modelcontextprotocol/server-filesystem│  │
│ │ Tools: read_file, write_file, list_directory (8)  │   │
│ │ Last ping: 30 seconds ago                          │   │
│ │          [Test] [Configure] [Restart] [Disable]    │   │
│ └───────────────────────────────────────────────────┘   │
│                                                           │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🔴 GitHub MCP Server                    [Inactive]│   │
│ │ Type: Remote  |  Status: Offline                   │   │
│ │ URL: https://mcp.github.com                        │   │
│ │ Tools: Not available (server offline)              │   │
│ │ Last ping: 2 hours ago - Connection timeout        │   │
│ │          [Test] [Configure] [Reconnect] [Enable]   │   │
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### UI Layout - Marketplace

```
┌─────────────────────────────────────────────────────────┐
│ MCP Marketplace                        [🔄 Refresh]      │
├─────────────────────────────────────────────────────────┤
│ Connected Servers | Marketplace                          │
├─────────────────────────────────────────────────────────┤
│ Search: [___________]  Category: [All ▼]  Sort: [Popular ▼]│
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ 📁 Filesystem MCP                      [Installed]│   │
│ │ By: Anthropic         ⭐ 4.9  📥 5.2k            │   │
│ │ Access and manipulate local filesystem             │   │
│ │ Tags: filesystem, files, local                     │   │
│ │ npm i -g @modelcontextprotocol/server-filesystem  │   │
│ │                              [Configure] [Update]  │   │
│ └───────────────────────────────────────────────────┘   │
│                                                           │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🐙 GitHub MCP                                      │   │
│ │ By: Anthropic         ⭐ 4.7  📥 3.8k            │   │
│ │ Interact with GitHub repositories and issues       │   │
│ │ Tags: github, git, repository                      │   │
│ │ npm i -g @modelcontextprotocol/server-github      │   │
│ │                   [View Details] [Install] [Docs]  │   │
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### Add Server Dialog

```
┌─────────────────────────────────────────────────────────┐
│ Add MCP Server                                      [×]  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│ Server Type:  ○ Local Process  ● Remote Server          │
│                                                           │
│ Name: [GitHub MCP Server___________________________]     │
│                                                           │
│ Display Name: [GitHub Tools_________________________]     │
│                                                           │
│ Description:                                              │
│ [Access GitHub repositories, issues, and PRs_______]     │
│ [_________________________________________________]     │
│                                                           │
│ URL: [https://mcp.github.com_______________________]     │
│                                                           │
│ Authentication (Optional):                                │
│ API Key: [●●●●●●●●●●●●●●●●●●●●●●●●●●●__________]     │
│                                                           │
│ Environment Variables:                                    │
│ [+ Add Variable]                                          │
│                                                           │
│                           [Test Connection] [Cancel] [Add]│
└─────────────────────────────────────────────────────────┘
```

#### API Endpoints

```typescript
// GET /api/admin/tools/mcp/servers
// Get all connected MCP servers
GET /admin/tools/mcp/servers
Response: {
  servers: MCPServer[];
  total: number;
}

// POST /api/admin/tools/mcp/servers
// Add a new MCP server
POST /admin/tools/mcp/servers
Body: {
  name: string;
  displayName: string;
  type: 'local' | 'remote';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

// GET /api/admin/tools/mcp/servers/:id
// Get server details including tools
GET /admin/tools/mcp/servers/:id

// POST /api/admin/tools/mcp/servers/:id/test
// Test MCP server connection
POST /admin/tools/mcp/servers/:id/test
Response: {
  success: boolean;
  status: string;
  tools?: MCPTool[];
  latency?: number;
}

// PUT /api/admin/tools/mcp/servers/:id/toggle
// Enable/disable MCP server
PUT /admin/tools/mcp/servers/:id/toggle
Body: { isActive: boolean }

// DELETE /api/admin/tools/mcp/servers/:id
// Remove MCP server
DELETE /admin/tools/mcp/servers/:id

// GET /api/admin/tools/mcp/marketplace
// Browse MCP marketplace
GET /admin/tools/mcp/marketplace?category=filesystem&sort=popular
Response: {
  items: MCPMarketplaceItem[];
  total: number;
}
```

---

## 3. Component Structure

### 3.1 File Organization

```
frontend/components/admin/
├── SkillsManagement.tsx                 # Main Skills page with tabs
│   ├── skills/
│   │   ├── LocalSkillsTab.tsx          # Local skills tab
│   │   ├── MarketplaceSkillsTab.tsx    # Marketplace tab
│   │   ├── SkillCard.tsx               # Skill display card
│   │   ├── SkillDetailsModal.tsx       # Skill details dialog
│   │   └── SkillUploadDialog.tsx       # Upload skill dialog
│   │
├── ToolsManagement.tsx                  # Main Tools page with tabs
│   └── tools/
│       ├── BuiltinToolsTab.tsx         # Built-in tools tab
│       ├── ExternalToolsTab.tsx        # External tools tab
│       ├── MCPMarketplaceTab.tsx       # MCP marketplace tab
│       ├── ToolCard.tsx                # Tool display card
│       ├── ToolConfigDialog.tsx        # Tool configuration dialog
│       ├── MCPServerCard.tsx           # MCP server card
│       ├── AddMCPServerDialog.tsx      # Add MCP server dialog
│       └── ConnectionTestButton.tsx    # Test connection component
│
└── shared/
    ├── TabNavigation.tsx               # Reusable tab component
    ├── SearchBar.tsx                   # Search with filters
    └── StatusBadge.tsx                 # Status indicator
```

### 3.2 Component Hierarchy

```
SkillsManagement
├── TabNavigation (Local Skills | Marketplace)
├── LocalSkillsTab
│   ├── SearchBar
│   ├── FilterControls
│   └── SkillCard[] (map)
│       ├── StatusBadge
│       └── ActionButtons
└── MarketplaceSkillsTab
    ├── SearchBar
    ├── FilterControls
    └── SkillCard[] (map)
        ├── RatingDisplay
        ├── InstallButton
        └── PreviewButton

ToolsManagement
├── TabNavigation (Built-in | External | MCP)
├── BuiltinToolsTab
│   ├── CategoryFilters
│   └── ToolCard[] (grouped by category)
│       ├── StatusBadge
│       ├── UsageStats
│       └── ActionButtons
├── ExternalToolsTab
│   ├── CategoryFilters
│   └── ToolCard[] (grouped by category)
│       ├── ConfigurationStatus
│       ├── ConnectionTestButton
│       └── UsageStats
└── MCPMarketplaceTab
    ├── SubTabs (Connected | Marketplace)
    ├── ConnectedServers
    │   └── MCPServerCard[]
    │       ├── StatusIndicator
    │       ├── ToolsList
    │       └── ActionButtons
    └── Marketplace
        ├── SearchBar
        └── MCPMarketplaceCard[]
            ├── InstallInstructions
            └── InstallButton
```

---

## 4. State Management

### 4.1 Zustand Store Structure

```typescript
// stores/admin-store.ts

interface SkillsState {
  localSkills: LocalSkill[];
  marketplaceSkills: MarketplaceSkill[];
  selectedSkill: LocalSkill | MarketplaceSkill | null;
  isLoadingLocal: boolean;
  isLoadingMarketplace: boolean;

  fetchLocalSkills: () => Promise<void>;
  fetchMarketplaceSkills: (filters?: SkillFilters) => Promise<void>;
  installSkill: (skillId: string) => Promise<void>;
  uninstallSkill: (skillId: string) => Promise<void>;
  toggleSkill: (skillId: string, isActive: boolean) => Promise<void>;
}

interface ToolsState {
  builtinTools: BuiltinTool[];
  externalTools: ExternalTool[];
  mcpServers: MCPServer[];
  mcpMarketplace: MCPMarketplaceItem[];
  selectedTool: BuiltinTool | ExternalTool | MCPServer | null;
  isLoading: boolean;

  fetchBuiltinTools: () => Promise<void>;
  fetchExternalTools: () => Promise<void>;
  fetchMCPServers: () => Promise<void>;
  fetchMCPMarketplace: (filters?: MCPFilters) => Promise<void>;
  testConnection: (toolId: string) => Promise<TestResult>;
  toggleTool: (toolId: string, isActive: boolean) => Promise<void>;
  addMCPServer: (config: MCPServerConfig) => Promise<void>;
  removeMCPServer: (serverId: string) => Promise<void>;
}

// Combined admin store
interface AdminStore extends SkillsState, ToolsState {
  // Global admin state
}

export const useAdminStore = create<AdminStore>((set, get) => ({
  // Implementation
}));
```

### 4.2 React Query for Data Fetching

```typescript
// hooks/admin/useLocalSkills.ts
export function useLocalSkills(filters?: SkillFilters) {
  return useQuery({
    queryKey: ["admin", "skills", "local", filters],
    queryFn: () => fetchLocalSkills(filters),
    staleTime: 60000, // 1 minute
  });
}

// hooks/admin/useMarketplaceSkills.ts
export function useMarketplaceSkills(filters?: SkillFilters) {
  return useQuery({
    queryKey: ["admin", "skills", "marketplace", filters],
    queryFn: () => fetchMarketplaceSkills(filters),
    staleTime: 300000, // 5 minutes
  });
}

// hooks/admin/useMCPServers.ts
export function useMCPServers() {
  return useQuery({
    queryKey: ["admin", "tools", "mcp", "servers"],
    queryFn: () => fetchMCPServers(),
    refetchInterval: 30000, // Poll every 30s for status updates
  });
}
```

---

## 5. Backend Implementation

### 5.1 Module Structure

```
backend/src/modules/admin/
├── skills/
│   ├── skills-admin.controller.ts
│   ├── skills-admin.service.ts
│   ├── skills-local.service.ts         # Manage .skill.md files
│   ├── skills-marketplace.service.ts   # SkillsMP integration
│   └── dto/
│       ├── skill-filter.dto.ts
│       └── install-skill.dto.ts
│
├── tools/
│   ├── tools-admin.controller.ts
│   ├── tools-admin.service.ts
│   ├── builtin-tools.service.ts        # Core tools management
│   ├── external-tools.service.ts       # API tools management
│   ├── mcp-manager.service.ts          # MCP server management
│   └── dto/
│       ├── tool-filter.dto.ts
│       ├── mcp-server-config.dto.ts
│       └── test-connection.dto.ts
│
└── admin.module.ts
```

### 5.2 Service Layer

#### SkillsLocalService

```typescript
@Injectable()
export class SkillsLocalService {
  private readonly skillsPath = path.join(process.cwd(), "backend", "skills");

  async getLocalSkills(): Promise<LocalSkill[]> {
    const files = await fs.readdir(this.skillsPath, { recursive: true });
    const skillFiles = files.filter((f) => f.endsWith(".skill.md"));

    return Promise.all(skillFiles.map((file) => this.parseSkillFile(file)));
  }

  private async parseSkillFile(filePath: string): Promise<LocalSkill> {
    const content = await fs.readFile(filePath, "utf-8");
    const metadata = this.extractMetadata(content);

    return {
      id: this.generateSkillId(filePath),
      filePath,
      ...metadata,
    };
  }

  async toggleSkill(id: string, isActive: boolean): Promise<void> {
    // Update skill configuration
  }

  async deleteSkill(id: string): Promise<void> {
    // Delete skill file
  }
}
```

#### MCPManagerService

```typescript
@Injectable()
export class MCPManagerService {
  private connections = new Map<string, MCPConnection>();

  async addServer(config: MCPServerConfig): Promise<MCPServer> {
    const connection = await this.createConnection(config);
    this.connections.set(connection.id, connection);

    // Start connection
    await connection.start();

    return connection.getServerInfo();
  }

  async testConnection(serverId: string): Promise<TestResult> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new NotFoundException(`Server ${serverId} not found`);
    }

    const startTime = Date.now();
    try {
      await connection.ping();
      const tools = await connection.listTools();

      return {
        success: true,
        latency: Date.now() - startTime,
        tools,
        message: "Connection successful",
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async removeServer(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (connection) {
      await connection.stop();
      this.connections.delete(serverId);
    }
  }
}
```

---

## 6. Database Schema

### 6.1 Prisma Models

```prisma
// Schema additions for tools and skills management

model LocalSkill {
  id          String   @id @default(cuid())
  name        String   @unique
  displayName String
  version     String
  author      String
  description String
  category    String
  filePath    String   @unique
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("local_skills")
}

model MCPServer {
  id          String   @id @default(cuid())
  name        String   @unique
  displayName String
  description String?
  type        String   // 'local' | 'remote'
  url         String?
  command     String?
  args        Json?    // string[]
  env         Json?    // Record<string, string>
  isActive    Boolean  @default(true)
  isConnected Boolean  @default(false)
  lastPingAt  DateTime?
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("mcp_servers")
}

model ToolUsageStats {
  id        String   @id @default(cuid())
  toolId    String
  toolType  String   // 'builtin' | 'external' | 'mcp'
  date      DateTime
  calls     Int      @default(0)
  errors    Int      @default(0)

  @@unique([toolId, toolType, date])
  @@map("tool_usage_stats")
}
```

---

## 7. Implementation Steps

### Phase 1: Foundation (Week 1)

1. **Backend Setup**
   - [ ] Create admin/skills and admin/tools modules
   - [ ] Implement SkillsLocalService
   - [ ] Implement basic BuiltinToolsService
   - [ ] Add Prisma models and migration
   - [ ] Create API endpoints

2. **Frontend Setup**
   - [ ] Create component file structure
   - [ ] Build TabNavigation component
   - [ ] Create base layout for SkillsManagement page
   - [ ] Create base layout for ToolsManagement page

### Phase 2: Skills Management (Week 2)

3. **Local Skills Tab**
   - [ ] Implement LocalSkillsTab component
   - [ ] Build SkillCard component
   - [ ] Add skill file parsing logic
   - [ ] Implement enable/disable functionality
   - [ ] Add skill deletion

4. **Skills Marketplace Tab**
   - [ ] Integrate SkillsMP API
   - [ ] Implement MarketplaceSkillsTab component
   - [ ] Add skill installation logic
   - [ ] Add skill update detection
   - [ ] Build preview functionality

### Phase 3: Tools Management - Built-in & External (Week 3)

5. **Built-in Tools Tab**
   - [ ] Implement BuiltinToolsTab component
   - [ ] Create tool category grouping
   - [ ] Add tool configuration dialogs
   - [ ] Implement usage statistics display

6. **External Tools Tab**
   - [ ] Implement ExternalToolsTab component
   - [ ] Integrate with SecretsManager
   - [ ] Add connection testing
   - [ ] Display usage statistics
   - [ ] Add quota monitoring

### Phase 4: MCP Integration (Week 4)

7. **MCP Server Management**
   - [ ] Implement MCPManagerService
   - [ ] Create MCP connection handling
   - [ ] Build MCPMarketplaceTab component
   - [ ] Add AddMCPServerDialog
   - [ ] Implement server status monitoring

8. **MCP Marketplace**
   - [ ] Integrate MCP marketplace API
   - [ ] Add server installation flow
   - [ ] Build server configuration UI
   - [ ] Implement tool discovery

### Phase 5: Polish & Testing (Week 5)

9. **UI/UX Refinement**
   - [ ] Add loading states
   - [ ] Improve error handling
   - [ ] Add confirmation dialogs
   - [ ] Implement optimistic updates
   - [ ] Add toast notifications

10. **Testing & Documentation**
    - [ ] Write unit tests for services
    - [ ] Write integration tests for API endpoints
    - [ ] Test connection handling
    - [ ] Create user documentation
    - [ ] Add inline help tooltips

---

## 8. Security Considerations

### 8.1 API Key Management

- **Never expose secrets in frontend**: All API keys must be stored in SecretsManager
- **Use secure references**: External tools reference secrets by name, not value
- **Encrypt at rest**: All secrets must be encrypted in database
- **Audit logging**: Track all secret access and modifications

### 8.2 MCP Server Security

- **Validate server URLs**: Prevent SSRF attacks by validating remote URLs
- **Sandbox local processes**: Run local MCP servers in restricted environment
- **Connection timeout**: Enforce connection timeouts to prevent DoS
- **Rate limiting**: Limit MCP server requests to prevent abuse

### 8.3 Skill Installation Security

- **Validate skill files**: Parse and validate .skill.md files before installation
- **Scan for malicious content**: Check for embedded scripts or suspicious patterns
- **User confirmation**: Require confirmation before installing from marketplace
- **Rollback capability**: Allow reverting to previous skill versions

---

## 9. Performance Considerations

### 9.1 Caching Strategy

```typescript
// Cache skill and tool data
const CACHE_CONFIG = {
  localSkills: { ttl: 60000 }, // 1 minute
  marketplaceSkills: { ttl: 300000 }, // 5 minutes
  builtinTools: { ttl: 300000 }, // 5 minutes
  externalTools: { ttl: 60000 }, // 1 minute
  mcpServers: { ttl: 30000 }, // 30 seconds (real-time status)
};
```

### 9.2 Lazy Loading

- Load skill/tool details on demand
- Paginate marketplace results
- Virtual scrolling for long lists
- Image lazy loading for icons/screenshots

### 9.3 Optimistic Updates

- Immediately update UI when toggling skills/tools
- Show loading states for async operations
- Rollback on error

---

## 10. Future Enhancements

### 10.1 Skills

- [ ] Skill versioning and rollback
- [ ] Skill dependencies and auto-installation
- [ ] Skill marketplace categories and tags
- [ ] Skill ratings and reviews
- [ ] Collaborative skill editing
- [ ] Skill templates and scaffolding

### 10.2 Tools

- [ ] Tool usage analytics dashboard
- [ ] Cost tracking for paid APIs
- [ ] Tool performance metrics
- [ ] Custom tool creation wizard
- [ ] Tool chaining and workflows
- [ ] Tool marketplace for custom tools

### 10.3 MCP

- [ ] MCP server health monitoring
- [ ] MCP server logs viewer
- [ ] MCP tool testing playground
- [ ] MCP server clustering
- [ ] Auto-discovery of local MCP servers
- [ ] MCP server templates

---

## 11. UI/UX Mockups

### Tab Navigation Pattern

```
┌─────────────────────────────────────────────────────────┐
│ [Skills Management]              Search: [_________] 🔍 │
├─────────────────────────────────────────────────────────┤
│ ┌──────────────┬──────────────────┐                     │
│ │ Local Skills │ Marketplace      │                     │
│ └──────────────┴──────────────────┘                     │
│                                                           │
│ [Tab content here]                                        │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### Color Coding

- **Green**: Active/Online/Configured
- **Yellow**: Warning/Update Available
- **Red**: Inactive/Offline/Not Configured
- **Blue**: Information/Default state
- **Gray**: Disabled

### Icons

- **Skills**: 🎯 (target), 📚 (books), ⚡ (lightning)
- **Built-in Tools**: 🔧 (wrench), 🛠️ (tools), ⚙️ (gear)
- **External Tools**: 🔌 (plug), 🌐 (globe), 🔗 (link)
- **MCP Servers**: 🖥️ (server), 📡 (satellite), 🔌 (plug)
- **Status**: 🟢 (online), 🔴 (offline), 🟡 (warning)

---

## Conclusion

This design provides a comprehensive architecture for managing skills and tools in GenesisPod. The tabbed interface separates concerns clearly:

- **Skills**: Local installation vs. marketplace discovery
- **Tools**: Built-in core tools vs. external APIs vs. MCP protocol

Key benefits:

- **Clear separation**: Each tab has a specific purpose
- **Scalability**: Easy to add new tool types or skill sources
- **Consistency**: Reusable components across all tabs
- **Security**: Proper secret management and connection testing
- **User-friendly**: Intuitive navigation and clear status indicators

The implementation plan spreads work across 5 weeks, allowing for iterative development and testing.

---

**Next Steps:**

1. Review and approve design
2. Create GitHub issues for each implementation phase
3. Begin Phase 1 implementation
4. Set up CI/CD for automated testing

**Questions for Discussion:**

- Should we support skill/tool categories beyond those listed?
- Do we need rate limiting on marketplace API calls?
- Should MCP servers support authentication methods beyond API keys?
- Do we want skill/tool backup and restore functionality?

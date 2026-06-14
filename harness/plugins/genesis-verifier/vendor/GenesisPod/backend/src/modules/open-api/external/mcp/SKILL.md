# GenesisPod — MCP Skill Manifest

> 声明式能力描述，供 OpenClaw、Claude Code 等 MCP 客户端自动发现和集成。

## Metadata

```yaml
name: genesis-ai
version: 2.0.0
protocol: mcp/2024-11-05
transport: streamable-http
description: >
  Enterprise AI engine exposing deep research, multi-agent debate,
  content analysis, writing assistance, and 50+ dynamic tools
  via the Model Context Protocol.
author: GenesisPod AI
license: proprietary
```

## Authentication

```yaml
auth:
  type: api-key
  header: Authorization
  format: "Bearer {MCP_API_KEY}"
  alt_header: X-API-Key
```

## Endpoints

```yaml
endpoints:
  jsonrpc: POST /mcp
  sse: GET /mcp
  terminate: DELETE /mcp
  admin: /admin/mcp-server/*
```

## Capabilities

```yaml
capabilities:
  tools:
    listChanged: true
  resources:
    subscribe: false
    listChanged: false
  prompts:
    listChanged: false
```

---

## Tools (Curated)

### genesis_deep_research

```yaml
name: genesis_deep_research
category: research
tier: curated
timeout: 300s
description: >
  Execute deep research on a topic. Creates a research plan,
  runs iterative search with self-reflection, and returns
  a comprehensive report with citations and evidence.
input:
  topic:
    type: string
    required: true
    description: The research topic or question to investigate
  dimensions:
    type: array[string]
    required: false
    description: "Research angles (e.g., 'market analysis', 'technical feasibility')"
  depth:
    type: enum
    values: [quick, standard, deep]
    default: standard
    description: Research depth level
  language:
    type: string
    default: en
    description: Output language for the report
output:
  format: json
  fields:
    executiveSummary: string
    sections: array[{title, content, sources}]
    conclusion: string
    references: array[{title, url, relevance}]
    metadata: { totalSources, duration, depth }
```

### genesis_ask

```yaml
name: genesis_ask
category: chat
tier: curated
timeout: 60s
description: >
  Ask GenesisPod AI a question. Supports multi-model responses
  with web search augmentation.
input:
  question:
    type: string
    required: true
    description: The question to ask
  context:
    type: string
    required: false
    description: Additional context for the question
  webSearch:
    type: boolean
    default: false
    description: Whether to augment with web search results
output:
  format: json
  fields:
    answer: string
    model: string
    tokensUsed: number
    webSearchUsed: boolean
```

### genesis_team_debate

```yaml
name: genesis_team_debate
category: collaboration
tier: curated
timeout: 180s
description: >
  Run a structured multi-agent debate on a topic.
  Two AI agents with opposing perspectives analyze the topic
  through multiple rounds with a final judgment.
input:
  topic:
    type: string
    required: true
    description: The debate topic or proposition
  rounds:
    type: number
    range: [1, 5]
    default: 3
    description: Number of debate rounds
  perspective:
    type: string
    required: false
    description: Specific angle for the debate
output:
  format: json
  fields:
    topic: string
    rounds: array[{round, proArgument, conArgument}]
    judgment: { winner, confidence, proStrengths, conStrengths, conclusion }
```

### genesis_content_analysis

```yaml
name: genesis_content_analysis
category: analysis
tier: curated
timeout: 60s
description: >
  Analyze provided text across multiple dimensions.
  Supports comprehensive, summary, key findings, quality,
  structure, and sentiment analysis.
input:
  content:
    type: string
    required: true
    description: The text content to analyze
  analysisType:
    type: enum
    values:
      [comprehensive, summary, key_findings, quality, structure, sentiment]
    default: comprehensive
  dimensions:
    type: array[string]
    required: false
    description: "Custom analysis dimensions (e.g., 'market impact')"
  language:
    type: string
    default: en
output:
  format: json
  fields:
    analysisType: string
    result: object # structure varies by analysisType
    model: string
    tokensUsed: number
```

### genesis_writing_assist

```yaml
name: genesis_writing_assist
category: writing
tier: curated
timeout: 60s
description: >
  Writing assistance tool. Supports content improvement,
  expansion, summarization, rewriting, proofreading,
  and outline generation.
input:
  content:
    type: string
    required: true
    description: The original text content to work with
  task:
    type: enum
    required: true
    values: [improve, expand, summarize, rewrite, proofread, outline]
    description: The writing task to perform
  style:
    type: string
    required: false
    description: "Target style (academic, business, casual, technical)"
  targetAudience:
    type: string
    required: false
    description: "Target audience (executives, developers, general public)"
  language:
    type: string
    default: en
output:
  format: json
  fields:
    task: string
    result: object # structure varies by task
    model: string
    tokensUsed: number
```

---

## Tools (Dynamic Bridge)

Dynamic bridge tools are auto-discovered from the AI Engine's internal registries.
They follow a naming convention with prefixes:

```yaml
bridge:
  tool_*:
    source: ToolRegistry
    description: Direct tool execution
    examples: [tool_web_search, tool_url_reader, tool_calculator]
  skill_*:
    source: SkillRegistry
    description: Skill-based AI execution with domain context
    examples: [skill_code_review, skill_data_analysis]
  agent_*:
    source: AgentRegistry
    description: Autonomous agent execution
    examples: [agent_research, agent_planning]
```

> Bridge tools require explicit permission via `allowedToolPatterns`
> in the session's permission policy. Default policy only allows `genesis_*`.

---

## Resources

```yaml
resources:
  genesis://capabilities:
    description: Overview of all AI capabilities
    mimeType: application/json
  genesis://tools:
    description: List of registered tools with schemas
    mimeType: application/json
  genesis://skills:
    description: List of skills organized by domain/layer
    mimeType: application/json
  genesis://agents:
    description: List of agents with capabilities
    mimeType: application/json
  genesis://teams:
    description: Team configurations for multi-agent collaboration
    mimeType: application/json
  genesis://models:
    description: Available AI models
    mimeType: application/json
```

---

## Prompts

```yaml
prompts:
  deep-research:
    description: Generate a structured deep research request
    arguments:
      topic: { required: true, description: "Research topic" }
      depth: { required: false, description: "quick|standard|deep" }
      language: { required: false, description: "Output language" }

  content-analysis:
    description: Analyze content with multiple dimensions
    arguments:
      content: { required: true, description: "Content to analyze" }
      type: { required: false, description: "comprehensive|summary|..." }

  team-debate:
    description: Start a multi-agent debate
    arguments:
      topic: { required: true, description: "Debate topic" }
      rounds: { required: false, description: "1-5, default 3" }

  writing-assist:
    description: AI writing assistance
    arguments:
      text: { required: true, description: "Text to work with" }
      task: { required: false, description: "improve|expand|summarize|..." }
      style: { required: false, description: "academic|professional|..." }

  discover-capabilities:
    description: Discover available GenesisPod AI capabilities
    arguments:
      category:
        { required: false, description: "tools|skills|agents|teams|models" }
```

---

## Permission Model

```yaml
permissions:
  default_policy:
    allowedToolPatterns: ["genesis_*"] # curated tools only
    deniedToolPatterns: []
    maxConcurrency: 5
    dailyQuota: 1000
    allowStreaming: true
    allowResources: true
    allowPrompts: true
  pattern_matching: glob # supports *, tool_*, *_search, tool_*_v2
  enforcement: deny-by-default
  fail_mode: closed # no session = denied
```

---

## Rate Limits & Quotas

```yaml
limits:
  daily_quota: 1000 calls/key
  max_concurrent: 5 per session
  tool_timeouts:
    single_call: 60s
    multi_step: 180s
    research: 300s
  session:
    max_active: 2000
    storage: in-memory LRU
```

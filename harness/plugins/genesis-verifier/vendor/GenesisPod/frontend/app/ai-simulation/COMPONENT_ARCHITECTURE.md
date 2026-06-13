# AI Simulation Component Architecture

## Component Hierarchy

```
AISimulationPage (page.tsx - 306 lines)
│
├── Sidebar (from @/components/layout)
│
├── Header Section
│   ├── Title & Icon
│   └── "New Simulation" Button
│
├── Templates Section
│   └── TemplateCard[] (50 lines each)
│       ├── Template Info
│       ├── Badge
│       └── Statistics
│
├── Scenarios Section
│   └── ScenarioCardItem[] (123 lines each)
│       ├── Scenario Info
│       ├── Run Status
│       ├── Statistics
│       └── Action Buttons (Edit, Delete)
│
└── EditorModal (2,762 lines) - Conditional Rendering
    ├── Modal Header
    │   ├── Title
    │   ├── Save Button
    │   └── Close Button
    │
    ├── Tab Navigation (4 tabs)
    │   ├── Basic Info Tab
    │   ├── Companies Tab
    │   ├── Agents Tab
    │   └── Parameters Tab
    │
    ├── Tab Content
    │   │
    │   ├── Basic Info Tab
    │   │   ├── Name, Industry, Region
    │   │   ├── Goals Configuration
    │   │   └── Navigation Buttons
    │   │
    │   ├── Companies Tab
    │   │   ├── Company List
    │   │   ├── CompanyCard[] (621 lines each)
    │   │   │   ├── Company Header
    │   │   │   ├── AI Assist Button
    │   │   │   ├── Expand/Collapse
    │   │   │   ├── Remove Button
    │   │   │   └── Metrics Form (when expanded)
    │   │   │       ├── Financial Metrics
    │   │   │       ├── Operational Metrics
    │   │   │       └── Moat Metrics
    │   │   └── Add Company Button
    │   │
    │   ├── Agents Tab
    │   │   ├── Agent List
    │   │   ├── AgentCard[] (394 lines each)
    │   │   │   ├── Agent Header
    │   │   │   ├── Team Selection
    │   │   │   ├── Role Input
    │   │   │   ├── Company Assignment
    │   │   │   ├── Expand/Collapse
    │   │   │   ├── Remove Button
    │   │   │   └── Persona Form (when expanded)
    │   │   │       ├── Traits & Biases
    │   │   │       ├── Pressure & Time Preference
    │   │   │       ├── Risk Tolerance Slider
    │   │   │       ├── Compliance Slider
    │   │   │       └── Private Memory
    │   │   └── Add Agent Button
    │   │
    │   └── Parameters Tab
    │       ├── Game Mechanics
    │       │   ├── Blind Move Toggle
    │       │   ├── Chain of Thought Toggle
    │       │   └── Human Intervention Frequency
    │       └── AI Behavior
    │           ├── Chaos Probability Slider
    │           └── Irrational Probability Slider
    │
    └── Footer
        └── Progress Indicator
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      AISimulationPage                        │
│                                                              │
│  State:                                                      │
│  ├── scenarios: ScenarioCard[]                              │
│  ├── showEditor: boolean                                    │
│  ├── editing: ScenarioCard | null                           │
│  └── seed: ScenarioTemplate | null                          │
│                                                              │
│  Actions:                                                    │
│  ├── fetchScenarios() - Load from API                       │
│  ├── handleCreate() - Open editor for new scenario          │
│  ├── handleEdit(scenario) - Open editor for existing        │
│  ├── handleDelete(scenario) - Delete scenario               │
│  ├── handleTemplate(template) - Create from template        │
│  └── handleViewDetail(scenario) - Navigate to detail page   │
│                                                              │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               │                               │
               ▼                               ▼
    ┌──────────────────┐           ┌─────────────────────┐
    │  TemplateCard    │           │ ScenarioCardItem    │
    │                  │           │                     │
    │  Props:          │           │  Props:             │
    │  ├── template    │           │  ├── scenario       │
    │  └── onClick     │           │  ├── latestRun      │
    └──────────────────┘           │  ├── onView         │
                                   │  ├── onEdit         │
                                   │  └── onDelete       │
                                   └─────────────────────┘
               │
               │ (when showEditor)
               ▼
    ┌─────────────────────────────────────────────┐
    │           EditorModal                       │
    │                                             │
    │  Props:                                     │
    │  ├── scenario (editing) | null              │
    │  ├── seed (template) | null                 │
    │  ├── onClose                                │
    │  └── onSaved                                │
    │                                             │
    │  Internal State:                            │
    │  ├── form: { name, industry, goals, ... }  │
    │  ├── companies: ScenarioFormCompany[]       │
    │  ├── agents: ScenarioFormAgent[]            │
    │  └── activeTab: TabType                     │
    │                                             │
    └────────┬──────────────────┬─────────────────┘
             │                  │
             ▼                  ▼
    ┌────────────────┐  ┌────────────────┐
    │  CompanyCard   │  │   AgentCard    │
    │                │  │                │
    │  Props:        │  │  Props:        │
    │  ├── company   │  │  ├── agent     │
    │  ├── industry  │  │  ├── companies │
    │  ├── onUpdate  │  │  ├── teamColors│
    │  └── onRemove  │  │  ├── onUpdate  │
    └────────────────┘  │  └── onRemove  │
                        └────────────────┘
```

## Import Dependencies

```
page.tsx
├── react (useState, useEffect)
├── next/navigation (useRouter)
├── @/components/layout/Sidebar
├── @/contexts/AuthContext (useAuth)
├── @/lib/utils/config
├── @/lib/utils/auth (getAuthHeader)
├── ./types (ScenarioCard, ScenarioTemplate, ScenarioRun)
├── ./constants (SCENARIO_TEMPLATES)
├── ./components/EditorModal
├── ./components/TemplateCard
└── ./components/ScenarioCardItem

EditorModal.tsx
├── react (useState, useEffect)
├── next/navigation (useRouter)
├── ../types (All interfaces)
├── ../constants (DEFAULT_SCENARIO_PARAMS, TEAM_COLORS)
├── ../utils (safeJson)
├── @/lib/utils/config
├── @/lib/utils/auth (getAuthHeader)
├── ./AgentCard
└── ./CompanyCard

AgentCard.tsx
├── react (useState, useMemo)
├── ../types (ScenarioFormAgent, ScenarioFormCompany)
└── ../utils (safeJson)

CompanyCard.tsx
├── react (useState)
├── ../types (ScenarioFormCompany)
├── @/lib/utils/config
└── @/lib/utils/auth (getAuthHeader)

ScenarioCardItem.tsx
├── react
└── ../types (ScenarioCard, ScenarioRun)

TemplateCard.tsx
├── react
└── ../types (ScenarioTemplate)
```

## Shared Resources

### types.ts

Centralized TypeScript interfaces used across all components

### constants.ts

- Scenario templates
- Default parameters
- Team color mappings

### utils.ts

- safeJson() - Safe JSON parsing utility

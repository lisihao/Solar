# 003. A2A (Agent-to-Agent) Protocol Adoption via Teams Adapter

**Date**: 2026-02-05
**Status**: Proposed

## Background

Google's A2A protocol (v0.3, backed by 150+ organizations) standardizes agent-to-agent communication. GenesisPod already has a mature multi-agent Teams module (Team + TeamBuilder + ITeamMember + ILeader + Workflow + ConstraintEngine) that handles internal agent collaboration. Enterprise customers need cross-platform agent orchestration.

## Decision

Integrate A2A INTO the existing Teams system via the adapter pattern, not as a parallel system:

1. **A2ATeamMemberAdapter** implements existing `ITeamMember` interface
   - External A2A agents join teams as regular members via `TeamBuilder.addMember()`
   - Status maps from A2A lifecycle to existing `MemberStatus` enum
   - Skills/tools derived from A2A Agent Card capabilities
   - External agents are always members, never leaders (GenesisPod retains orchestration control)

2. **Agent Cards** for GenesisPod agents expose them to external A2A platforms
   - Discovery endpoint: `/.well-known/agent.json`
   - Maps existing agent capabilities to A2A skill format

3. **A2A is opt-in per team** - zero impact on teams that don't use external agents

## Rationale

- Reuses battle-tested Teams infrastructure (workflows, constraints, review cycles)
- No changes to `ITeamMember`, `ITeam`, `TeamBuilder`, or `Workflow` interfaces
- External agents are just another `ITeamMember` implementation
- `AITeamsSettings.tsx` extends naturally - "External Agent" option in member editor
- Admin retains full control: which external agents are allowed, which teams can use them

## Impact

- **Positive**: Agent interoperability with zero disruption to existing teams
- **Positive**: GenesisPod agents discoverable by external platforms
- **Negative**: External agents may have higher latency (HTTP round-trips)
- **Risk**: External agent reliability affects team execution

## Alternatives Considered

1. **Separate A2A module (parallel to Teams)**: More isolated but duplicates orchestration logic
2. **Replace Teams with A2A-native framework**: Too disruptive, loses existing capabilities
3. **A2A for outbound only (no inbound)**: Limits interoperability

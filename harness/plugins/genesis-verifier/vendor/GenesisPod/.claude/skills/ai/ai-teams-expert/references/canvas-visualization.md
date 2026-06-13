# Canvas Visualization

## Node Positioning Algorithm

```typescript
function calculateNodePositions(
  leaderId: string,
  agents: TopicAIMember[],
  width: number,
  height: number,
  tasksByAgent: Map<string, AgentTask[]>,
): Map<string, { x: number; y: number }> {
  const positions = new Map();
  const centerX = width / 2;

  // Leader at top center
  if (leaderId) {
    positions.set(leaderId, { x: centerX, y: 90 });
  }

  // Workers in rows below, sorted by activity
  const workers = agents.filter((a) => a.id !== leaderId);
  const sortedWorkers = sortByActivity(workers, tasksByAgent);

  // Distribute in grid layout
  const nodesPerRow = Math.ceil(Math.sqrt(workers.length));
  sortedWorkers.forEach((worker, index) => {
    const row = Math.floor(index / nodesPerRow);
    const col = index % nodesPerRow;
    positions.set(worker.id, {
      x: calculateX(col, nodesPerRow, width),
      y: 250 + row * 160,
    });
  });

  return positions;
}
```

## Connection Lines with Animation

```typescript
function renderTaskConnection(
  leaderPos: Position,
  agentPos: Position,
  task: AgentTask
): JSX.Element {
  const connectionColor = getTaskConnectionColor(task.status);
  const isActive = task.status === 'IN_PROGRESS';

  return (
    <g key={task.id}>
      {/* Curved path */}
      <path
        d={`M ${leaderPos.x} ${leaderPos.y + 40}
            Q ${midX} ${midY}
            ${agentPos.x} ${agentPos.y - 40}`}
        stroke={connectionColor}
        strokeWidth={isActive ? 4 : 2}
        fill="none"
      />

      {/* Animated particle for active tasks */}
      {isActive && (
        <circle r="6" fill={connectionColor}>
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={pathD}
          />
        </circle>
      )}
    </g>
  );
}
```

## Task Connection Colors

```typescript
function getTaskConnectionColor(status: AgentTaskStatus): string {
  switch (status) {
    case "PENDING":
      return "#94a3b8"; // gray
    case "IN_PROGRESS":
      return "#3b82f6"; // blue
    case "AWAITING_REVIEW":
      return "#f59e0b"; // amber
    case "COMPLETED":
      return "#22c55e"; // green
    case "REVISION_NEEDED":
      return "#ef4444"; // red
    default:
      return "#94a3b8";
  }
}
```

## Agent Node Component

```tsx
interface AgentNodeProps {
  agent: TopicAIMember;
  position: { x: number; y: number };
  isLeader: boolean;
  currentTask?: AgentTask;
}

function AgentNode({ agent, position, isLeader, currentTask }: AgentNodeProps) {
  return (
    <g transform={`translate(${position.x}, ${position.y})`}>
      {/* Avatar circle */}
      <circle
        r={isLeader ? 50 : 40}
        fill={getModelColor(agent.modelProvider)}
        stroke={currentTask ? "#3b82f6" : "transparent"}
        strokeWidth={3}
      />

      {/* Avatar image */}
      <image
        href={agent.avatar}
        x={isLeader ? -35 : -28}
        y={isLeader ? -35 : -28}
        width={isLeader ? 70 : 56}
        height={isLeader ? 70 : 56}
        clipPath="url(#avatarClip)"
      />

      {/* Name label */}
      <text
        y={isLeader ? 70 : 55}
        textAnchor="middle"
        className="text-sm font-medium"
      >
        {agent.displayName}
      </text>

      {/* Role badge */}
      {isLeader && (
        <text y={85} textAnchor="middle" className="text-xs text-amber-500">
          Team Leader
        </text>
      )}
    </g>
  );
}
```

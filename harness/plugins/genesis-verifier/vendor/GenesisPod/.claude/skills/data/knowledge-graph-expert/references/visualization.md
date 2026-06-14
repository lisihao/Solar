# Graph Visualization

## D3.js Force Graph

```typescript
interface GraphNode {
  id: string;
  label: string;
  type: ResourceType;
  size: number; // Based on importance/connections
  color: string; // Based on type or topic
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: RelationshipType;
  strength: number;
}

const ForceGraph: React.FC<{ nodes: GraphNode[]; links: GraphLink[] }> = ({
  nodes,
  links,
}) => {
  useEffect(() => {
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d) => d.id)
          .strength((d) => d.strength),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide().radius((d) => d.size + 10),
      );

    // Render nodes and links...
  }, [nodes, links]);
};
```

## Topic Hierarchy

```typescript
interface Topic {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  children?: Topic[];
  resourceCount: number;
  color?: string;
  icon?: string;
}

async getTopicTree(): Promise<Topic[]> {
  const topics = await this.topicModel.find().lean();
  return this.buildTree(topics);
}

async getResourcesByTopic(topicId: string, includeChildren = true): Promise<Resource[]> {
  const topicIds = includeChildren
    ? await this.getDescendantIds(topicId)
    : [topicId];

  return this.resourceModel.find({
    topics: { $in: topicIds }
  });
}
```

## Graph-Based Exploration

```typescript
async explore(startId: string, depth = 2): Promise<ExplorationResult> {
  const visited = new Set<string>();
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  await this.traverseGraph(startId, depth, visited, nodes, links);

  return { nodes, links, center: startId };
}
```

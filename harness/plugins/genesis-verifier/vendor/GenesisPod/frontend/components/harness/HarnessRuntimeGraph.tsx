/**
 * HarnessRuntimeGraph
 *
 * A live node/edge graph that visualises a Self-Driven Team mission run.
 * Built on @xyflow/react (reactflow v12) with deterministic topological layout.
 *
 * Nodes:
 *   - Mission (root, layer 0)
 *   - Plan    (layer 1)
 *   - Step    (one per plan.steps[], layered by dependency depth)
 *   - Deliverable (last layer)
 *
 * Status-colour legend for step nodes:
 *   pending  → gray
 *   running  → blue + pulsing border
 *   done     → emerald
 *   failed   → red
 */
'use client';

import '@xyflow/react/dist/style.css';

import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import { motion } from 'framer-motion';
import {
  Loader,
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  Zap,
  Network,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/i18n-context';
import type {
  SelfDrivenMissionEvent,
  PlanEvent,
  TeamBuiltEvent,
  StepStartedEvent,
  StepCompletedEvent,
  DeliverableEvent,
  ExecutionStep,
} from '@/lib/api/self-driven-stream';

// ─── layout constants ───────────────────────────────────────────────────────

const NODE_W = 200;
const NODE_H = 100; // approximate, actual height varies
const H_GAP = 60; // horizontal gap between same-layer nodes
const V_GAP = 80; // vertical gap between layers

// ─── step node status types ──────────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'done' | 'failed';

// Edges anchor to Handles; without them reactflow renders no lines. Kept tiny +
// near-transparent so the connection dots don't clutter the design.
const HANDLE_STYLE: React.CSSProperties = {
  width: 6,
  height: 6,
  background: '#cbd5e1',
  border: 'none',
  opacity: 0.01,
};

// ─── custom node data shapes ─────────────────────────────────────────────────

interface MissionNodeData {
  kind: 'mission';
  label: string;
  isStreaming: boolean;
  [key: string]: unknown;
}

interface PlanNodeData {
  kind: 'plan';
  label: string;
  stepCount: number;
  [key: string]: unknown;
}

interface StepNodeData {
  kind: 'step';
  stepName: string;
  executor: string;
  modelId: string;
  status: StepStatus;
  durationMs?: number;
  [key: string]: unknown;
}

interface DeliverableNodeData {
  kind: 'deliverable';
  label: string;
  [key: string]: unknown;
}

type AnyNodeData =
  | MissionNodeData
  | PlanNodeData
  | StepNodeData
  | DeliverableNodeData;

// ─── MissionNode ─────────────────────────────────────────────────────────────

function MissionNode({ data }: { data: MissionNodeData }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex w-[200px] flex-col items-center gap-1.5 rounded-xl border-2 border-violet-300 bg-violet-50 px-4 py-3 shadow-md"
    >
      <div className="flex items-center gap-1.5">
        <Network size={14} className="text-violet-600" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-wide text-violet-700">
          {data.label}
        </span>
        {data.isStreaming && (
          <span className="ml-1 h-2 w-2 animate-pulse rounded-full bg-violet-400" />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </motion.div>
  );
}

// ─── PlanNode ─────────────────────────────────────────────────────────────────

function PlanNode({ data }: { data: PlanNodeData }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex w-[200px] flex-col items-center gap-1 rounded-xl border-2 border-indigo-200 bg-indigo-50 px-4 py-3 shadow-sm"
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <div className="flex items-center gap-1.5">
        <Zap size={13} className="text-indigo-500" aria-hidden />
        <span className="text-xs font-bold text-indigo-700">{data.label}</span>
      </div>
      <span className="text-[11px] text-indigo-400">
        {data.stepCount} steps
      </span>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </motion.div>
  );
}

// ─── StepNode ─────────────────────────────────────────────────────────────────

const statusBorderColor: Record<StepStatus, string> = {
  pending: 'border-gray-200',
  running: 'border-blue-400',
  done: 'border-emerald-400',
  failed: 'border-red-400',
};

const statusBgColor: Record<StepStatus, string> = {
  pending: 'bg-gray-50',
  running: 'bg-blue-50',
  done: 'bg-emerald-50',
  failed: 'bg-red-50',
};

const statusDotColor: Record<StepStatus, string> = {
  pending: 'bg-gray-300',
  running: 'bg-blue-400',
  done: 'bg-emerald-400',
  failed: 'bg-red-400',
};

function StepNode({ data }: { data: StepNodeData }) {
  const { status, stepName, executor, modelId, durationMs } = data;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={[
        'w-[200px] rounded-xl border-2 px-3 py-2.5 shadow-sm',
        statusBorderColor[status],
        statusBgColor[status],
        status === 'running' ? 'animate-pulse-border' : '',
      ].join(' ')}
      style={
        status === 'running'
          ? {
              boxShadow: '0 0 0 3px rgba(59,130,246,0.25)',
              animation: 'none',
            }
          : undefined
      }
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      {/* Status dot + name */}
      <div className="flex items-start gap-2">
        <span className="mt-1 shrink-0">
          {status === 'running' ? (
            <Loader
              size={11}
              className="animate-spin text-blue-500"
              aria-hidden
            />
          ) : status === 'done' ? (
            <CheckCircle size={11} className="text-emerald-500" aria-hidden />
          ) : status === 'failed' ? (
            <AlertCircle size={11} className="text-red-500" aria-hidden />
          ) : (
            <span
              className={`mt-0.5 block h-2.5 w-2.5 rounded-full ${statusDotColor[status]}`}
            />
          )}
        </span>
        <span className="line-clamp-2 min-w-0 flex-1 text-[12px] font-semibold leading-tight text-gray-800">
          {stepName}
        </span>
      </div>

      {/* Role chip */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md border border-gray-200 bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
          {executor}
        </span>
        {modelId && (
          <span className="font-mono max-w-[110px] truncate text-[10px] text-gray-400">
            {modelId}
          </span>
        )}
      </div>

      {/* Duration */}
      {status === 'done' && durationMs !== undefined && (
        <div className="mt-1 flex items-center gap-0.5 text-[10px] text-emerald-600">
          <Clock size={9} aria-hidden />
          <span>{(durationMs / 1000).toFixed(1)}s</span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </motion.div>
  );
}

// ─── DeliverableNode ──────────────────────────────────────────────────────────

function DeliverableNode({ data }: { data: DeliverableNodeData }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex w-[200px] items-center gap-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 shadow-md"
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <FileText size={14} className="shrink-0 text-emerald-600" aria-hidden />
      <span className="text-xs font-bold text-emerald-700">{data.label}</span>
    </motion.div>
  );
}

// ─── nodeTypes registry ───────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  missionNode: MissionNode as unknown as NodeTypes[string],
  planNode: PlanNode as unknown as NodeTypes[string],
  stepNode: StepNode as unknown as NodeTypes[string],
  deliverableNode: DeliverableNode as unknown as NodeTypes[string],
};

// ─── topological layout helpers ──────────────────────────────────────────────

/** Compute the depth of each step in the dependency DAG (0 = no deps). */
function computeDepthMap(steps: ExecutionStep[]): Map<string, number> {
  const depths = new Map<string, number>();
  const stepById = new Map(steps.map((s) => [s.id, s]));

  function getDepth(id: string, visited = new Set<string>()): number {
    if (depths.has(id)) return depths.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);
    const step = stepById.get(id);
    if (!step || step.dependencies.length === 0) {
      depths.set(id, 0);
      return 0;
    }
    const maxDepDep = Math.max(
      ...step.dependencies.map((d) => getDepth(d, visited))
    );
    const depth = maxDepDep + 1;
    depths.set(id, depth);
    return depth;
  }

  steps.forEach((s) => getDepth(s.id));
  return depths;
}

/** Assign (x, y) positions using a layered left-to-right layout.
 *  Layer 0 = Mission, Layer 1 = Plan, Layer 2+ = steps by depth, last = Deliverable. */
function buildLayout(
  steps: ExecutionStep[],
  depthMap: Map<string, number>
): {
  stepPositions: Map<string, { x: number; y: number }>;
  maxStepLayer: number;
} {
  // Group steps by their depth layer (offset by 2 because Mission=0, Plan=1)
  const layerBuckets = new Map<number, string[]>();
  steps.forEach((s) => {
    const layer = (depthMap.get(s.id) ?? 0) + 2;
    if (!layerBuckets.has(layer)) layerBuckets.set(layer, []);
    layerBuckets.get(layer)!.push(s.id);
  });

  const stepPositions = new Map<string, { x: number; y: number }>();
  let maxStepLayer = 2;

  layerBuckets.forEach((ids, layer) => {
    if (layer > maxStepLayer) maxStepLayer = layer;
    const totalWidth = ids.length * NODE_W + (ids.length - 1) * H_GAP;
    const startX = -totalWidth / 2;
    ids.forEach((id, idx) => {
      stepPositions.set(id, {
        x: startX + idx * (NODE_W + H_GAP),
        y: layer * (NODE_H + V_GAP),
      });
    });
  });

  return { stepPositions, maxStepLayer };
}

// ─── main graph derivation ────────────────────────────────────────────────────

interface HarnessRuntimeGraphProps {
  events: SelfDrivenMissionEvent[];
  isStreaming: boolean;
}

export function HarnessRuntimeGraph({
  events,
  isStreaming,
}: HarnessRuntimeGraphProps) {
  const { t } = useI18n();

  const { nodes, edges } = useMemo(() => {
    // --- extract relevant events ---
    const planEvent = events
      .filter((e): e is PlanEvent => e.type === 'plan')
      .at(-1);
    const teamBuiltEvent = events.find(
      (e): e is TeamBuiltEvent => e.type === 'team_built'
    );
    const stepStartedMap = new Map<string, StepStartedEvent>();
    const stepCompletedMap = new Map<string, StepCompletedEvent>();

    events.forEach((e) => {
      if (e.type === 'step_started') stepStartedMap.set(e.stepId, e);
      if (e.type === 'step_completed') stepCompletedMap.set(e.stepId, e);
    });

    const hasDeliverable = events.some(
      (e): e is DeliverableEvent => e.type === 'deliverable'
    );

    // --- model lookup: team_built wins over roleAssignments ---
    const modelByRole = new Map<string, string>();
    if (teamBuiltEvent) {
      teamBuiltEvent.roles.forEach((r) => modelByRole.set(r.roleId, r.modelId));
    } else if (planEvent?.plan.roleAssignments) {
      planEvent.plan.roleAssignments.forEach((r) =>
        modelByRole.set(r.roleId, r.modelId)
      );
    }

    const nodes: Node<AnyNodeData>[] = [];
    const edges: Edge[] = [];

    // Layer 0 — Mission root
    nodes.push({
      id: 'mission',
      type: 'missionNode',
      position: { x: -100, y: 0 },
      data: {
        kind: 'mission',
        label: t('aiAsk.selfDriven.mission'),
        isStreaming,
      } satisfies MissionNodeData,
      draggable: true,
      selectable: false,
    });

    if (!planEvent) {
      // No plan yet — show just the mission node
      return { nodes, edges };
    }

    const plan = planEvent.plan;
    const steps = plan.steps ?? [];

    // Layer 1 — Plan node
    nodes.push({
      id: 'plan',
      type: 'planNode',
      position: { x: -100, y: NODE_H + V_GAP },
      data: {
        kind: 'plan',
        label: t('aiAsk.selfDriven.plan'),
        stepCount: steps.length,
      } satisfies PlanNodeData,
      draggable: true,
      selectable: false,
    });

    edges.push({
      id: 'mission-plan',
      source: 'mission',
      target: 'plan',
      animated: isStreaming,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: '#a5b4fc',
      },
      style: { stroke: '#a5b4fc', strokeWidth: 1.5 },
    });

    if (steps.length === 0) {
      return { nodes, edges };
    }

    // Compute topological depth + positions
    const depthMap = computeDepthMap(steps);
    const { stepPositions, maxStepLayer } = buildLayout(steps, depthMap);

    // Centre the Mission/Plan nodes
    // All step x-positions are centred around 0; shift Mission/Plan to match
    const allXPositions = Array.from(stepPositions.values()).map((p) => p.x);
    const minX = Math.min(...allXPositions);
    const maxX = Math.max(...allXPositions) + NODE_W;
    const centreX = (minX + maxX) / 2 - NODE_W / 2;

    nodes[0].position = { x: centreX, y: 0 };
    nodes[1].position = { x: centreX, y: NODE_H + V_GAP };

    // Step nodes
    const stepIdSet = new Set(steps.map((s) => s.id));

    steps.forEach((step) => {
      const started = stepStartedMap.get(step.id);
      const completed = stepCompletedMap.get(step.id);

      let status: StepStatus = 'pending';
      if (completed) status = completed.ok ? 'done' : 'failed';
      else if (started) status = 'running';

      const pos = stepPositions.get(step.id) ?? {
        x: 0,
        y: 2 * (NODE_H + V_GAP),
      };
      const modelId = modelByRole.get(step.executor) ?? '';

      nodes.push({
        id: `step-${step.id}`,
        type: 'stepNode',
        position: pos,
        data: {
          kind: 'step',
          stepName: step.name,
          executor: step.executor,
          modelId,
          status,
          durationMs: completed?.durationMs,
        } satisfies StepNodeData,
        draggable: true,
        selectable: false,
      });

      // Edge: Plan → first-layer steps (no deps) or dep-less
      if (step.dependencies.length === 0) {
        const isTargetRunning = status === 'running';
        edges.push({
          id: `plan-step-${step.id}`,
          source: 'plan',
          target: `step-${step.id}`,
          animated: isTargetRunning,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: '#6366f1',
          },
          style: { stroke: '#6366f1', strokeWidth: 1.5 },
        });
      }

      // Edges: dep → step
      step.dependencies.forEach((depId) => {
        if (!stepIdSet.has(depId)) return;
        const depCompleted = stepCompletedMap.get(depId);
        const isActive = status === 'running' && !!depCompleted?.ok;
        edges.push({
          id: `dep-${depId}-${step.id}`,
          source: `step-${depId}`,
          target: `step-${step.id}`,
          animated: isActive,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: isActive ? '#3b82f6' : '#d1d5db',
          },
          style: { stroke: isActive ? '#3b82f6' : '#d1d5db', strokeWidth: 1.5 },
        });
      });
    });

    // Deliverable node (last layer)
    if (hasDeliverable) {
      const deliverableY = (maxStepLayer + 1) * (NODE_H + V_GAP);
      nodes.push({
        id: 'deliverable',
        type: 'deliverableNode',
        position: { x: centreX, y: deliverableY },
        data: {
          kind: 'deliverable',
          label: t('aiAsk.selfDriven.report'),
        } satisfies DeliverableNodeData,
        draggable: true,
        selectable: false,
      });

      // Edges: leaf steps (no other step depends on them) → Deliverable
      const hasDependents = new Set<string>();
      steps.forEach((s) => s.dependencies.forEach((d) => hasDependents.add(d)));
      const leafSteps = steps.filter((s) => !hasDependents.has(s.id));

      leafSteps.forEach((step) => {
        edges.push({
          id: `step-${step.id}-deliverable`,
          source: `step-${step.id}`,
          target: 'deliverable',
          animated: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: '#34d399',
          },
          style: { stroke: '#34d399', strokeWidth: 1.5 },
        });
      });
    }

    return { nodes, edges };
  }, [events, isStreaming, t]);

  // Stable callback refs for ReactFlow
  const onNodesChange = useCallback(() => {}, []);
  const onEdgesChange = useCallback(() => {}, []);

  return (
    <div className="h-[480px] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50/50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.25}
        maxZoom={2}
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll={true}
      >
        <Background color="#e5e7eb" gap={20} size={1} />
        <Controls
          showInteractive={false}
          className="!border-gray-200 !shadow-sm [&>button:hover]:!bg-gray-50 [&>button]:!border-gray-200 [&>button]:!bg-white"
        />
      </ReactFlow>
    </div>
  );
}

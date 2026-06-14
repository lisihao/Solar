'use client';

import { useState, useEffect, useCallback } from 'react';
import { Network } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { EmptyState } from '@/components/ui/states/EmptyState';

import { logger } from '@/lib/utils/logger';
import { confirm } from '@/stores';
interface GraphNode {
  id: string;
  type: string;
  linkedAt: string;
  labels?: string[];
  properties?: {
    name?: string;
    description?: string;
    username?: string;
    affiliation?: string;
  };
}

interface KnowledgeGraphLinkerProps {
  noteId: string;
  resourceId: string;
  linkedNodes: GraphNode[];
  onNodeLinked?: (node: GraphNode) => void;
  onNodeUnlinked?: (nodeId: string) => void;
}

/**
 * 知识图谱关联组件
 *
 * 功能：
 * - 展示资源相关的知识图谱节点
 * - 链接节点到笔记
 * - 显示已链接的节点
 * - 移除节点链接
 */
export default function KnowledgeGraphLinker({
  noteId,
  resourceId,
  linkedNodes,
  onNodeLinked,
  onNodeUnlinked,
}: KnowledgeGraphLinkerProps) {
  const [graphData, setGraphData] = useState<{ nodes?: GraphNode[] } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showNodeSelector, setShowNodeSelector] = useState(false);

  useEffect(() => {
    loadGraph();
  }, [resourceId]);

  const loadGraph = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/knowledge-graph/resource/${resourceId}?depth=2`
      );

      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        setGraphData(data);
      }
    } catch (err) {
      logger.error('Failed to load knowledge graph:', err);
    } finally {
      setLoading(false);
    }
  };

  const linkNode = useCallback(
    async (nodeId: string, nodeType: string) => {
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/notes/${noteId}/graph-nodes`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, nodeType }),
          }
        );

        if (response.ok) {
          const newNode = {
            id: nodeId,
            type: nodeType,
            linkedAt: new Date().toISOString(),
          };
          onNodeLinked?.(newNode);
          setShowNodeSelector(false);
        }
      } catch (err) {
        logger.error('Failed to link node:', err);
      }
    },
    [noteId, onNodeLinked]
  );

  const unlinkNode = useCallback(
    async (nodeId: string) => {
      if (
        !(await confirm({ title: '确定要移除此节点关联吗？', type: 'danger' }))
      )
        return;

      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/notes/${noteId}/graph-nodes/${encodeURIComponent(nodeId)}`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (response.ok) {
          onNodeUnlinked?.(nodeId);
        } else {
          logger.error('Failed to unlink node:', await response.text());
        }
      } catch (err) {
        logger.error('Failed to unlink node:', err);
      }
    },
    [noteId, onNodeUnlinked]
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  const availableNodes = graphData?.nodes || [];
  const topics = availableNodes.filter((n) => n.labels?.includes('Topic'));
  const authors = availableNodes.filter((n) => n.labels?.includes('Author'));

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gradient-to-r from-green-50 to-teal-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900">
              知识图谱关联
            </h3>
          </div>

          <button
            onClick={() => setShowNodeSelector(!showNodeSelector)}
            className="text-xs font-medium text-green-600 hover:text-green-800"
          >
            {showNodeSelector ? '隐藏' : '添加节点'}
          </button>
        </div>
      </div>

      {/* Linked Nodes */}
      {linkedNodes.length > 0 && (
        <div className="border-b border-gray-200 p-4">
          <h4 className="mb-2 text-xs font-semibold text-gray-700">
            已关联节点 ({linkedNodes.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {linkedNodes.map((node) => (
              <div
                key={node.id}
                className="inline-flex items-center rounded-full border border-green-200 bg-green-100 px-3 py-1 text-xs font-medium text-green-800"
              >
                <span className="mr-2 capitalize">{node.type}</span>
                <span>{node.id}</span>
                <button
                  onClick={() => unlinkNode(node.id)}
                  className="ml-2 hover:text-green-900"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Node Selector */}
      {showNodeSelector && (
        <div className="p-4">
          {/* Topics */}
          {topics.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs font-semibold text-gray-700">
                主题 ({topics.length})
              </h4>
              <div className="max-h-48 space-y-2 overflow-auto">
                {topics.map((topic) => {
                  const isLinked = linkedNodes.some(
                    (n) => n.id === topic.properties?.name
                  );
                  return (
                    <div
                      key={topic.properties?.name}
                      className="flex items-center justify-between rounded bg-gray-50 p-2 transition-colors hover:bg-gray-100"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {topic.properties?.name}
                        </div>
                        {topic.properties?.description && (
                          <div className="text-xs text-gray-600">
                            {topic.properties.description}
                          </div>
                        )}
                      </div>
                      {!isLinked ? (
                        <button
                          onClick={() =>
                            linkNode(topic.properties?.name || '', 'topic')
                          }
                          className="rounded px-3 py-1 text-xs font-medium text-green-600 hover:bg-green-50 hover:text-green-800"
                        >
                          关联
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">已关联</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Authors */}
          {authors.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-gray-700">
                作者 ({authors.length})
              </h4>
              <div className="max-h-48 space-y-2 overflow-auto">
                {authors.map((author) => {
                  const isLinked = linkedNodes.some(
                    (n) => n.id === author.properties?.username
                  );
                  return (
                    <div
                      key={author.properties?.username}
                      className="flex items-center justify-between rounded bg-gray-50 p-2 transition-colors hover:bg-gray-100"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {author.properties?.name ||
                            author.properties?.username}
                        </div>
                        {author.properties?.affiliation && (
                          <div className="text-xs text-gray-600">
                            {author.properties.affiliation}
                          </div>
                        )}
                      </div>
                      {!isLinked ? (
                        <button
                          onClick={() =>
                            linkNode(
                              author.properties?.username || '',
                              'author'
                            )
                          }
                          className="rounded px-3 py-1 text-xs font-medium text-green-600 hover:bg-green-50 hover:text-green-800"
                        >
                          关联
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">已关联</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {topics.length === 0 && authors.length === 0 && (
            <EmptyState
              size="sm"
              icon={<Network className="h-12 w-12" />}
              title="暂无可关联的知识图谱节点"
              description="系统将在后台为此资源构建知识图谱"
            />
          )}
        </div>
      )}

      {/* Empty State */}
      {!showNodeSelector && linkedNodes.length === 0 && (
        <EmptyState
          size="sm"
          icon={<Network className="h-10 w-10" />}
          title="暂未关联任何知识图谱节点"
          action={{
            label: '开始添加',
            onClick: () => setShowNodeSelector(true),
          }}
        />
      )}
    </div>
  );
}

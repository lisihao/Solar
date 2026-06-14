'use client';

/**
 * SlashCommandMenu - 聊天输入框斜杠命令菜单
 * 当用户输入 / 时触发，显示可用命令列表
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  TrendingUp,
  GitCompare,
  FileText,
  Presentation,
  Network,
  Lightbulb,
  BarChart3,
  Zap,
  Search,
} from 'lucide-react';

export interface SlashCommand {
  id: string;
  command: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  placeholder?: string;
  requiresArgs?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'trend',
    command: '/trend',
    title: '趋势报告',
    description: '生成科技趋势分析报告',
    icon: <TrendingUp className="h-4 w-4 text-blue-500" />,
    placeholder: '输入技术关键词，如: LLM, 量子计算',
    requiresArgs: true,
  },
  {
    id: 'compare',
    command: '/compare',
    title: '技术对比',
    description: '对比两个技术方案',
    icon: <GitCompare className="h-4 w-4 text-purple-500" />,
    placeholder: '输入对比项，如: React vs Vue',
    requiresArgs: true,
  },
  {
    id: 'summary',
    command: '/summary',
    title: '生成摘要',
    description: '为选中资源生成结构化摘要',
    icon: <FileText className="h-4 w-4 text-green-500" />,
    placeholder: '输入摘要要求或留空使用默认',
    requiresArgs: false,
  },
  {
    id: 'ppt',
    command: '/ppt',
    title: '生成演示',
    description: '基于资源生成 PPT 演示文稿',
    icon: <Presentation className="h-4 w-4 text-orange-500" />,
    placeholder: '输入演示主题或留空使用选中资源',
    requiresArgs: false,
  },
  {
    id: 'graph',
    command: '/graph',
    title: '知识图谱',
    description: '可视化主题知识图谱',
    icon: <Network className="h-4 w-4 text-cyan-500" />,
    placeholder: '输入主题关键词',
    requiresArgs: true,
  },
  {
    id: 'insights',
    command: '/insights',
    title: '深度洞察',
    description: '提取关键洞察和发现',
    icon: <Lightbulb className="h-4 w-4 text-yellow-500" />,
    placeholder: '输入分析主题',
    requiresArgs: false,
  },
  {
    id: 'hype',
    command: '/hype',
    title: 'Hype Cycle',
    description: '查看技术成熟度曲线',
    icon: <BarChart3 className="h-4 w-4 text-pink-500" />,
    placeholder: '输入技术领域，如: AI, 区块链',
    requiresArgs: true,
  },
  {
    id: 'search',
    command: '/search',
    title: '深度搜索',
    description: '在知识库中深度搜索',
    icon: <Search className="h-4 w-4 text-gray-500" />,
    placeholder: '输入搜索关键词',
    requiresArgs: true,
  },
];

interface SlashCommandMenuProps {
  isOpen: boolean;
  searchQuery: string;
  position: { top: number; left: number };
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  onNavigate: (direction: 'up' | 'down') => void;
}

export default function SlashCommandMenu({
  isOpen,
  searchQuery,
  position,
  selectedIndex,
  onSelect,
  onClose,
  onNavigate,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 过滤命令
  const filteredCommands = SLASH_COMMANDS.filter((cmd) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      cmd.command.toLowerCase().includes(query) ||
      cmd.title.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query)
    );
  });

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // 滚动到选中项
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const selectedItem = menuRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen || filteredCommands.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-80 rounded-lg border border-gray-200 bg-white shadow-xl"
      style={{
        bottom: `calc(100vh - ${position.top}px + 8px)`,
        left: `${position.left}px`,
      }}
    >
      {/* 标题 */}
      <div className="border-b border-gray-100 px-3 py-2">
        <div className="flex items-center space-x-2 text-xs text-gray-500">
          <Zap className="h-3 w-3" />
          <span>斜杠命令</span>
          <span className="text-gray-400">
            {filteredCommands.length} 个可用
          </span>
        </div>
      </div>

      {/* 命令列表 */}
      <div className="max-h-64 overflow-y-auto py-1">
        {filteredCommands.map((cmd, index) => (
          <div
            key={cmd.id}
            data-index={index}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => {
              // 鼠标悬停时也更新选中状态
            }}
            className={`flex cursor-pointer items-center space-x-3 px-3 py-2 transition-colors ${
              index === selectedIndex
                ? 'bg-blue-50 text-blue-700'
                : 'hover:bg-gray-50'
            }`}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                index === selectedIndex ? 'bg-blue-100' : 'bg-gray-100'
              }`}
            >
              {cmd.icon}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-sm font-medium text-gray-900">
                  {cmd.command}
                </span>
                <span className="text-sm text-gray-600">{cmd.title}</span>
              </div>
              <p className="truncate text-xs text-gray-500">
                {cmd.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* 提示 */}
      <div className="border-t border-gray-100 px-3 py-2">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>↑↓ 选择</span>
          <span>↵ 确认</span>
          <span>Esc 取消</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 解析消息中的斜杠命令
 */
export function parseSlashCommand(message: string): {
  command: SlashCommand | null;
  args: string;
} {
  const trimmed = message.trim();

  if (!trimmed.startsWith('/')) {
    return { command: null, args: message };
  }

  // 查找匹配的命令
  for (const cmd of SLASH_COMMANDS) {
    if (
      trimmed.toLowerCase().startsWith(cmd.command.toLowerCase() + ' ') ||
      trimmed.toLowerCase() === cmd.command.toLowerCase()
    ) {
      const args = trimmed.slice(cmd.command.length).trim();
      return { command: cmd, args };
    }
  }

  return { command: null, args: message };
}

/**
 * 根据命令构建增强的 prompt
 */
export function buildCommandPrompt(
  command: SlashCommand,
  args: string,
  context?: { selectedResourceCount: number }
): string {
  const resourceNote =
    context?.selectedResourceCount && context.selectedResourceCount > 0
      ? `\n\n[已选择 ${context.selectedResourceCount} 个资源作为参考]`
      : '';

  switch (command.id) {
    case 'trend':
      return `请为我生成关于「${args || '科技领域'}」的趋势分析报告。

报告应包含：
1. 技术发展现状概述
2. 关键趋势和技术点
3. Hype Cycle 阶段定位
4. 未来发展预测
5. 代表性项目/论文推荐

请使用专业但易懂的语言，并提供数据支撑。${resourceNote}`;

    case 'compare':
      const parts = args.split(/\s+vs\s+|\s+VS\s+|\s+对比\s+/i);
      if (parts.length >= 2) {
        return `请对比分析「${parts[0].trim()}」和「${parts[1].trim()}」这两个技术方案。

对比维度应包含：
1. 核心特性对比
2. 性能表现
3. 生态系统成熟度
4. 学习曲线
5. 社区活跃度
6. 适用场景
7. 优劣势总结
8. 选型建议

请使用表格形式呈现对比结果。${resourceNote}`;
      }
      return `请对比分析：${args}\n\n请提供全面的技术对比分析。${resourceNote}`;

    case 'summary':
      return `请为选中的资源生成结构化摘要。${args ? `\n\n额外要求：${args}` : ''}

摘要应包含：
1. 核心观点（3-5 条）
2. 关键发现
3. 方法论（如适用）
4. 创新点
5. 局限性
6. 应用场景

请确保摘要简洁精炼，突出重点。${resourceNote}`;

    case 'ppt':
      return `请基于${args ? `「${args}」主题和` : ''}选中的资源，生成 PPT 演示文稿内容。

要求：
1. 清晰的逻辑结构
2. 每页幻灯片要点明确
3. 包含数据可视化建议
4. 专业的商务风格

请使用 Markdown 格式，以 ### Slide X 标记每一页。${resourceNote}`;

    case 'graph':
      return `请为「${args || '选中资源'}」生成知识图谱结构。

图谱应包含：
1. 核心概念节点
2. 概念之间的关系
3. 层级结构
4. 关键技术点标注

请以 JSON 格式输出节点和边的定义，便于可视化渲染。${resourceNote}`;

    case 'insights':
      return `请从选中的资源中提取深度洞察。${args ? `\n\n关注方向：${args}` : ''}

洞察应包含：
1. 关键趋势发现
2. 隐藏的模式和规律
3. 潜在机会
4. 风险预警
5. 行动建议

请提供有价值且可执行的洞察。${resourceNote}`;

    case 'hype':
      return `请分析「${args || '新兴技术'}」在 Gartner Hype Cycle 上的位置。

分析应包含：
1. 当前所处阶段（创新触发期/期望膨胀期/泡沫破裂谷底期/爬升恢复期/生产力高原期）
2. 判断依据
3. 预计到达生产力高原期的时间
4. 相关技术对比
5. 投资/采用建议

请提供专业的技术成熟度分析。${resourceNote}`;

    case 'search':
      return `请在知识库中深度搜索「${args}」相关内容。

搜索范围：
1. 相关论文和研究
2. 技术博客和教程
3. 开源项目
4. 行业报告
5. 最新动态

请整理并呈现搜索结果摘要。${resourceNote}`;

    default:
      return args || '';
  }
}

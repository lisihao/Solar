'use client';

import { useState, useRef, useEffect } from 'react';
import { Eye, Users, Shield, ChevronDown, Lock } from 'lucide-react';

// 视角类型定义
export type ViewPerspective = 'GOD' | 'BLUE' | 'RED' | 'GREEN' | 'WHITE';

// 视角配置
export const VIEW_PERSPECTIVES: Record<
  ViewPerspective,
  {
    key: ViewPerspective;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    description: string;
    color: string;
    bgColor: string;
    borderColor: string;
    team?: string;
    canSeeAll?: boolean;
  }
> = {
  GOD: {
    key: 'GOD',
    label: '上帝视角',
    shortLabel: '上帝',
    icon: <Eye className="h-4 w-4" />,
    description: '全知视角，可查看所有阵营的行动和内心独白',
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/20',
    borderColor: 'border-indigo-500/50',
    canSeeAll: true,
  },
  BLUE: {
    key: 'BLUE',
    label: '蓝军视角',
    shortLabel: '蓝军',
    icon: <Users className="h-4 w-4" />,
    description: '主角方视角，只能看到蓝军完整信息',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/50',
    team: 'BLUE',
  },
  RED: {
    key: 'RED',
    label: '红军视角',
    shortLabel: '红军',
    icon: <Users className="h-4 w-4" />,
    description: '竞争对手视角，只能看到红军完整信息',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/50',
    team: 'RED',
  },
  GREEN: {
    key: 'GREEN',
    label: '绿军视角',
    shortLabel: '绿军',
    icon: <Users className="h-4 w-4" />,
    description: '市场方视角，只能看到绿军完整信息',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    borderColor: 'border-green-500/50',
    team: 'GREEN',
  },
  WHITE: {
    key: 'WHITE',
    label: '白方视角',
    shortLabel: '白方',
    icon: <Shield className="h-4 w-4" />,
    description: '监管视角，可看到合规评估和监管相关信息',
    color: 'text-gray-300',
    bgColor: 'bg-gray-500/20',
    borderColor: 'border-gray-500/50',
    team: 'WHITE',
  },
};

interface PerspectiveSelectorProps {
  value: ViewPerspective;
  onChange: (perspective: ViewPerspective) => void;
  availablePerspectives?: ViewPerspective[];
  showDescription?: boolean;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export function PerspectiveSelector({
  value,
  onChange,
  availablePerspectives = ['GOD', 'BLUE', 'RED', 'GREEN', 'WHITE'],
  showDescription = true,
  size = 'md',
  disabled = false,
}: PerspectiveSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentPerspective = VIEW_PERSPECTIVES[value];

  // 点击外部关闭下拉框
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* 触发按钮 */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-2 rounded-lg border transition-all
          ${currentPerspective.bgColor} ${currentPerspective.borderColor}
          ${sizeClasses[size]}
          ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:opacity-90'}
        `}
      >
        <span className={currentPerspective.color}>
          {currentPerspective.icon}
        </span>
        <span className={`font-medium ${currentPerspective.color}`}>
          {currentPerspective.shortLabel}
        </span>
        <ChevronDown
          className={`h-3 w-3 ${currentPerspective.color} transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          {availablePerspectives.map((perspectiveKey) => {
            const perspective = VIEW_PERSPECTIVES[perspectiveKey];
            const isSelected = perspectiveKey === value;
            const isAvailable = availablePerspectives.includes(perspectiveKey);

            return (
              <button
                key={perspectiveKey}
                onClick={() => {
                  if (isAvailable) {
                    onChange(perspectiveKey);
                    setIsOpen(false);
                  }
                }}
                disabled={!isAvailable}
                className={`
                  w-full px-3 py-2.5 text-left transition-all
                  ${isSelected ? perspective.bgColor : 'hover:bg-gray-800'}
                  ${!isAvailable ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
                `}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${perspective.bgColor}`}
                  >
                    <span className={perspective.color}>
                      {perspective.icon}
                    </span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-medium ${isSelected ? perspective.color : 'text-white'}`}
                      >
                        {perspective.label}
                      </span>
                      {isSelected && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400">
                          当前
                        </span>
                      )}
                      {!isAvailable && (
                        <Lock className="h-3 w-3 text-gray-500" />
                      )}
                    </div>
                    {showDescription && (
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {perspective.description}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 视角指示器组件 - 更简洁的显示
export function PerspectiveIndicator({
  perspective,
  size = 'sm',
}: {
  perspective: ViewPerspective;
  size?: 'sm' | 'md';
}) {
  const config = VIEW_PERSPECTIVES[perspective];

  return (
    <div
      className={`
        inline-flex items-center gap-1.5 rounded-full
        ${config.bgColor} ${config.borderColor} border
        ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}
      `}
    >
      <span className={config.color}>{config.icon}</span>
      <span className={`font-medium ${config.color}`}>{config.shortLabel}</span>
    </div>
  );
}

// 视角信息隐藏提示
export function PerspectiveHiddenHint({
  currentPerspective,
  requiredPerspective = 'GOD',
  message,
}: {
  currentPerspective: ViewPerspective;
  requiredPerspective?: ViewPerspective;
  message?: string;
}) {
  if (currentPerspective === 'GOD') return null;

  const required = VIEW_PERSPECTIVES[requiredPerspective];

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-xs text-gray-400">
      <Lock className="h-3.5 w-3.5" />
      <span>
        {message || `此信息在当前视角下隐藏`}
        <button className="ml-1 underline hover:text-gray-300">
          切换到{required.label}查看
        </button>
      </span>
    </div>
  );
}

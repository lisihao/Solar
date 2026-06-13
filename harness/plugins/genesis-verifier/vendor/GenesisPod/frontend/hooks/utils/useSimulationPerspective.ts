'use client';

import { useState, useEffect, useCallback } from 'react';
import { ViewPerspective } from '@/components/ai-simulation/PerspectiveSelector';

import { logger } from '@/lib/utils/logger';
const STORAGE_KEY = 'deepdive_simulation_preferences';

interface SimulationPreferences {
  defaultPerspective: ViewPerspective;
  scenarioPreferences: Record<string, ViewPerspective>;
  lastUpdated: string;
}

interface UseSimulationPerspectiveOptions {
  scenarioId?: string;
  runId?: string;
  initialPerspective?: ViewPerspective;
}

interface UseSimulationPerspectiveReturn {
  perspective: ViewPerspective;
  setPerspective: (p: ViewPerspective) => void;
  isLoading: boolean;
  defaultPerspective: ViewPerspective;
  setDefaultPerspective: (p: ViewPerspective) => void;
  resetToDefault: () => void;
}

// 从 localStorage 读取偏好
function getStoredPreferences(): SimulationPreferences {
  if (typeof window === 'undefined') {
    return {
      defaultPerspective: 'GOD',
      scenarioPreferences: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    logger.error('Failed to parse simulation preferences:', e);
  }

  return {
    defaultPerspective: 'GOD',
    scenarioPreferences: {},
    lastUpdated: new Date().toISOString(),
  };
}

// 保存偏好到 localStorage
function savePreferences(preferences: SimulationPreferences): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...preferences,
        lastUpdated: new Date().toISOString(),
      })
    );
  } catch (e) {
    logger.error('Failed to save simulation preferences:', e);
  }
}

export function useSimulationPerspective(
  options: UseSimulationPerspectiveOptions = {}
): UseSimulationPerspectiveReturn {
  const { scenarioId, runId, initialPerspective } = options;

  const [isLoading, setIsLoading] = useState(true);
  const [preferences, setPreferences] = useState<SimulationPreferences>(() =>
    getStoredPreferences()
  );

  // 当前视角 - 优先级: 场景级别 > 运行级别 > 默认
  const [perspective, setPerspectiveState] = useState<ViewPerspective>(() => {
    if (initialPerspective) return initialPerspective;

    const stored = getStoredPreferences();

    // 1. 先检查场景级别偏好
    if (scenarioId && stored.scenarioPreferences[scenarioId]) {
      return stored.scenarioPreferences[scenarioId];
    }

    // 2. 检查运行级别偏好
    if (runId && stored.scenarioPreferences[`run_${runId}`]) {
      return stored.scenarioPreferences[`run_${runId}`];
    }

    // 3. 使用默认视角
    return stored.defaultPerspective;
  });

  // 初始化加载
  useEffect(() => {
    const stored = getStoredPreferences();
    setPreferences(stored);

    // 确定初始视角
    let initialValue = stored.defaultPerspective;

    if (scenarioId && stored.scenarioPreferences[scenarioId]) {
      initialValue = stored.scenarioPreferences[scenarioId];
    } else if (runId && stored.scenarioPreferences[`run_${runId}`]) {
      initialValue = stored.scenarioPreferences[`run_${runId}`];
    }

    if (initialPerspective) {
      initialValue = initialPerspective;
    }

    setPerspectiveState(initialValue);
    setIsLoading(false);
  }, [scenarioId, runId, initialPerspective]);

  // 设置当前视角
  const setPerspective = useCallback(
    (newPerspective: ViewPerspective) => {
      setPerspectiveState(newPerspective);

      // 保存到场景或运行级别
      const key = runId ? `run_${runId}` : scenarioId;
      if (key) {
        setPreferences((prev) => {
          const updated = {
            ...prev,
            scenarioPreferences: {
              ...prev.scenarioPreferences,
              [key]: newPerspective,
            },
          };
          savePreferences(updated);
          return updated;
        });
      }
    },
    [scenarioId, runId]
  );

  // 设置默认视角
  const setDefaultPerspective = useCallback((newDefault: ViewPerspective) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        defaultPerspective: newDefault,
      };
      savePreferences(updated);
      return updated;
    });
  }, []);

  // 重置为默认视角
  const resetToDefault = useCallback(() => {
    setPerspectiveState(preferences.defaultPerspective);
  }, [preferences.defaultPerspective]);

  return {
    perspective,
    setPerspective,
    isLoading,
    defaultPerspective: preferences.defaultPerspective,
    setDefaultPerspective,
    resetToDefault,
  };
}

// 辅助函数: 检查用户是否可以查看特定内容
export function canViewContent(
  perspective: ViewPerspective,
  contentTeam: string,
  contentType: 'full' | 'public' | 'inner'
): boolean {
  // 上帝视角可以看所有
  if (perspective === 'GOD') {
    return true;
  }

  // 公开内容所有视角都能看
  if (contentType === 'public') {
    return true;
  }

  // 完整内容和内心独白只有同阵营可见
  return perspective === contentTeam;
}

// 辅助函数: 获取视角的可见团队
export function getVisibleTeams(perspective: ViewPerspective): string[] {
  if (perspective === 'GOD') {
    return ['BLUE', 'RED', 'GREEN', 'WHITE'];
  }
  return [perspective]; // 只能完整看到自己阵营
}

'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
import { LoadingState } from '@/components/ui/states';
import {
  ScenarioGoals,
  ScenarioParams,
  ScenarioFormCompany,
  ScenarioFormAgent,
} from '../../types';

interface ScenarioDetail {
  id: string;
  name: string;
  industry: string;
  region?: string;
  goals?: ScenarioGoals;
  constraints?: ScenarioParams;
  params?: ScenarioParams;
  companies?: ScenarioFormCompany[];
  agents?: ScenarioFormAgent[];
  createdAt: string;
  updatedAt: string;
}

export default function EditScenarioPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const scenarioId = params?.id as string;

  const [scenario, setScenario] = useState<ScenarioDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const redirectedRef = useRef(false);

  // 获取场景数据
  useEffect(() => {
    if (user && scenarioId && !redirectedRef.current) {
      void fetchScenario();
    }
  }, [user, scenarioId]);

  // 场景加载成功后重定向
  useEffect(() => {
    if (scenario && !redirectedRef.current) {
      redirectedRef.current = true;
      sessionStorage.setItem('editScenarioId', scenario.id);
      router.push('/ai-simulation');
    }
  }, [scenario, router]);

  const fetchScenario = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `${config.apiUrl}/simulation/scenarios/${scenarioId}`,
        {
          headers: { ...getAuthHeader() },
        }
      );
      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setScenario(data);
      } else {
        setError(true);
      }
    } catch (err) {
      logger.error('Failed to fetch scenario:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // 加载中
  if (authLoading || loading) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center">
          <LoadingState text="加载中..." />
        </main>
      </AppShell>
    );
  }

  // 未登录或加载失败
  if (!user || error) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mb-4 text-6xl text-gray-300">404</div>
            <div className="mb-4 text-gray-500">场景不存在或无权访问</div>
            <button
              onClick={() => router.push('/ai-simulation')}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              返回场景列表
            </button>
          </div>
        </main>
      </AppShell>
    );
  }

  // 正在跳转
  return (
    <AppShell>
      <main className="flex flex-1 items-center justify-center">
        <LoadingState text="正在跳转到编辑器..." />
      </main>
    </AppShell>
  );
}

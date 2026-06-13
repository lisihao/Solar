'use client';

import { useState, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { AdminPageLayout } from '@/components/admin/layout';
import { EmptyState } from '@/components/ui/states/EmptyState';

interface GuardrailInfo {
  id: string;
  name: string;
  enabled: boolean;
}

interface GuardrailsData {
  input: GuardrailInfo[];
  output: GuardrailInfo[];
  totalRules: number;
}

export default function GuardrailsPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [data, setData] = useState<GuardrailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGuardrails() {
      try {
        const res = await fetch(`${config.apiUrl}/admin/ai/guardrails`, {
          headers: getAuthHeader(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const payload = json?.data ?? json;
        // payload 必须含 input/output 数组才能渲染；Pipeline 未 ready 时后端可能返
        // 回 {} 或 null（接口前还未初始化），不加守卫会让 .input.length 在渲染期炸。
        setData({
          input: Array.isArray(payload?.input) ? payload.input : [],
          output: Array.isArray(payload?.output) ? payload.output : [],
          totalRules:
            typeof payload?.totalRules === 'number' ? payload.totalRules : 0,
        });
      } catch (e) {
        logger.error('Failed to fetch guardrails', e);
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchGuardrails();
  }, []);

  const body = (
    <>
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-600">
          {error}
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Summary */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">
              <ShieldCheck className="h-4 w-4" />
              {data.totalRules} guardrails registered
            </div>
            <div className="flex items-center gap-2 rounded-full bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
              <ShieldCheck className="h-4 w-4" />
              {data.input.filter((g) => g.enabled).length +
                data.output.filter((g) => g.enabled).length}{' '}
              enabled
            </div>
          </div>

          {/* Input Guardrails */}
          <div className="rounded-lg border bg-white">
            <div className="flex items-center gap-2 border-b px-5 py-3">
              <ArrowDownToLine className="h-4 w-4 text-blue-500" />
              <h3 className="text-sm font-semibold">
                Input Guardrails ({data.input.length})
              </h3>
            </div>
            <div className="divide-y">
              {data.input.map((g) => (
                <GuardrailRow key={g.id} guardrail={g} />
              ))}
              {data.input.length === 0 && (
                <EmptyState size="sm" title="No input guardrails registered" />
              )}
            </div>
          </div>

          {/* Output Guardrails */}
          <div className="rounded-lg border bg-white">
            <div className="flex items-center gap-2 border-b px-5 py-3">
              <ArrowUpFromLine className="h-4 w-4 text-violet-500" />
              <h3 className="text-sm font-semibold">
                Output Guardrails ({data.output.length})
              </h3>
            </div>
            <div className="divide-y">
              {data.output.map((g) => (
                <GuardrailRow key={g.id} guardrail={g} />
              ))}
              {data.output.length === 0 && (
                <EmptyState size="sm" title="No output guardrails registered" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Guardrails"
      description="AI safety guardrails — input/output validation rules"
      icon={Shield}
      domain="ai"
    >
      {body}
    </AdminPageLayout>
  );
}

function GuardrailRow({ guardrail }: { guardrail: GuardrailInfo }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <div className="flex items-center gap-3">
        {guardrail.enabled ? (
          <ShieldCheck className="h-4 w-4 text-green-500" />
        ) : (
          <ShieldAlert className="h-4 w-4 text-gray-400" />
        )}
        <div>
          <p className="text-sm font-medium">{guardrail.name}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {guardrail.id}
          </p>
        </div>
      </div>
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
          guardrail.enabled
            ? 'bg-green-50 text-green-700'
            : 'bg-gray-100 text-gray-500'
        }`}
      >
        {guardrail.enabled ? 'Enabled' : 'Disabled'}
      </span>
    </div>
  );
}

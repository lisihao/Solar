'use client';

import { useState, useEffect } from 'react';
import { X, History, User, Clock, Activity } from 'lucide-react';
import { SecretAccessLog } from '@/hooks/domain/useAdminSecrets';
import { formatDateSafe } from '@/lib/utils/date';

interface SecretAccessLogsProps {
  secretName: string;
  onClose: () => void;
  getAccessLogs: (name: string, limit?: number) => Promise<SecretAccessLog[]>;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  VIEW: { label: '查看', color: 'bg-blue-100 text-blue-800' },
  CREATE: { label: '创建', color: 'bg-green-100 text-green-800' },
  UPDATE: { label: '更新', color: 'bg-yellow-100 text-yellow-800' },
  DELETE: { label: '删除', color: 'bg-red-100 text-red-800' },
  REFERENCE: { label: '引用', color: 'bg-purple-100 text-purple-800' },
  ACCESS_DENIED: { label: '拒绝', color: 'bg-red-100 text-red-800' },
};

export function SecretAccessLogs({
  secretName,
  onClose,
  getAccessLogs,
}: SecretAccessLogsProps) {
  const [logs, setLogs] = useState<SecretAccessLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      const result = await getAccessLogs(secretName, 100);
      setLogs(result);
      setLoading(false);
    };
    fetchLogs();
  }, [secretName, getAccessLogs]);

  const formatTime = (timestamp: string) => {
    return formatDateSafe(timestamp, 'datetime-short');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl ">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 ">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 ">
            <History className="h-5 w-5" />
            访问日志 - {secretName}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100 ">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 日志列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-gray-500">暂无访问日志</div>
          ) : (
            <div className="space-y-3">
              {logs.map((log) => {
                const actionInfo = ACTION_LABELS[log.action] ?? {
                  label: log.action,
                  color: 'bg-gray-100 text-gray-800',
                };
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-4 rounded-lg bg-gray-50 p-3 "
                  >
                    <Activity className="mt-0.5 h-5 w-5 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${actionInfo.color}`}
                        >
                          {actionInfo.label}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            log.actionStatus === 'success'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {log.actionStatus === 'success' ? '成功' : '失败'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-4 text-sm text-gray-500 ">
                        {log.userEmail && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {log.userEmail}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTime(log.timestamp)}
                        </span>
                        {log.ipAddress && (
                          <span className="text-xs text-gray-400">
                            IP: {log.ipAddress}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="border-t border-gray-200 px-6 py-4 ">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-gray-100 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-200 "
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

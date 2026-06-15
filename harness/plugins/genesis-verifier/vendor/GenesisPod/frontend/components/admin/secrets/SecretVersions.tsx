'use client';

import { useState, useEffect } from 'react';
import {
  X,
  GitBranch,
  Clock,
  User,
  RotateCcw,
  Check,
  Eye,
  EyeOff,
  Copy,
  AlertCircle,
} from 'lucide-react';
import { SecretVersion } from '@/hooks/domain/useAdminSecrets';
import { formatDateSafe } from '@/lib/utils/date';

interface SecretVersionsProps {
  secretName: string;
  onClose: () => void;
  getVersions: (name: string) => Promise<SecretVersion[]>;
  getVersionValue: (name: string, version: number) => Promise<string | null>;
  rollbackVersion: (name: string, version: number) => Promise<void>;
  isRollingBack: boolean;
}

export function SecretVersions({
  secretName,
  onClose,
  getVersions,
  getVersionValue,
  rollbackVersion,
  isRollingBack,
}: SecretVersionsProps) {
  const [versions, setVersions] = useState<SecretVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealedVersion, setRevealedVersion] = useState<number | null>(null);
  const [versionValue, setVersionValue] = useState<string | null>(null);
  const [copiedVersion, setCopiedVersion] = useState<number | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState<number | null>(null);

  useEffect(() => {
    const fetchVersions = async () => {
      setLoading(true);
      const result = await getVersions(secretName);
      setVersions(result);
      setLoading(false);
    };
    fetchVersions();
  }, [secretName, getVersions]);

  const formatTime = (timestamp: string) => {
    return formatDateSafe(timestamp, 'datetime');
  };

  const handleReveal = async (version: number) => {
    if (revealedVersion === version) {
      setRevealedVersion(null);
      setVersionValue(null);
    } else {
      const value = await getVersionValue(secretName, version);
      setVersionValue(value);
      setRevealedVersion(version);
      // 30秒后自动隐藏
      setTimeout(() => {
        setRevealedVersion((curr) => (curr === version ? null : curr));
        setVersionValue(null);
      }, 30000);
    }
  };

  const handleCopy = async (version: number) => {
    let value = versionValue;
    if (revealedVersion !== version) {
      value = await getVersionValue(secretName, version);
    }
    if (value) {
      await navigator.clipboard.writeText(value);
      setCopiedVersion(version);
      setTimeout(() => setCopiedVersion(null), 2000);
    }
  };

  const handleRollback = async (version: number) => {
    await rollbackVersion(secretName, version);
    setRollbackConfirm(null);
    // Refresh versions
    const result = await getVersions(secretName);
    setVersions(result);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl ">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 ">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 ">
            <GitBranch className="h-5 w-5 text-blue-500" />
            版本历史 - {secretName}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 "
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 版本列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
            </div>
          ) : versions.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <AlertCircle className="mx-auto mb-2 h-8 w-8" />
              <p>暂无版本历史</p>
              <p className="mt-1 text-sm">更新密钥值后会自动创建新版本</p>
            </div>
          ) : (
            <div className="space-y-4">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className={`rounded-xl border p-4 transition-all ${
                    version.isCurrent
                      ? 'border-blue-200 bg-blue-50 '
                      : 'border-gray-200 bg-white hover:border-gray-300 '
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* 版本号和状态 */}
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-gray-900 ">
                          v{version.version}
                        </span>
                        {version.isCurrent && (
                          <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 ">
                            <Check className="h-3 w-3" />
                            当前版本
                          </span>
                        )}
                      </div>

                      {/* 变更说明 */}
                      {version.changeNote && (
                        <p className="mt-1 text-sm text-gray-600 ">
                          {version.changeNote}
                        </p>
                      )}

                      {/* 元信息 */}
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTime(version.createdAt)}
                        </span>
                        {version.createdBy && (
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            {version.createdBy}
                          </span>
                        )}
                        <span
                          className="font-mono text-gray-400"
                          title="Checksum"
                        >
                          #{version.checksum.substring(0, 8)}
                        </span>
                      </div>

                      {/* 显示值 */}
                      {revealedVersion === version.version && versionValue && (
                        <div className="mt-3">
                          <code className="font-mono block break-all rounded-lg bg-gray-100 p-2 text-sm ">
                            {versionValue}
                          </code>
                        </div>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="ml-4 flex items-center gap-2">
                      <button
                        onClick={() => handleReveal(version.version)}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 "
                        title={
                          revealedVersion === version.version ? '隐藏' : '查看'
                        }
                      >
                        {revealedVersion === version.version ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleCopy(version.version)}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 "
                        title="复制"
                      >
                        {copiedVersion === version.version ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                      {!version.isCurrent && (
                        <>
                          {rollbackConfirm === version.version ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleRollback(version.version)}
                                disabled={isRollingBack}
                                className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200 disabled:opacity-50"
                              >
                                {isRollingBack ? '回滚中...' : '确认'}
                              </button>
                              <button
                                onClick={() => setRollbackConfirm(null)}
                                className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() =>
                                setRollbackConfirm(version.version)
                              }
                              className="rounded-lg p-2 text-amber-500 hover:bg-amber-50 "
                              title="回滚到此版本"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部说明 */}
        <div className="border-t border-gray-200 px-6 py-3 ">
          <p className="text-xs text-gray-500">
            每次更新密钥值会自动创建新版本，回滚操作会创建一个包含历史值的新版本
          </p>
        </div>
      </div>
    </div>
  );
}

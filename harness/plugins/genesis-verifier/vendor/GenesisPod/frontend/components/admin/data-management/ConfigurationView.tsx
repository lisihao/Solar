'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import { toast } from '@/stores';
import { ClientDate } from '@/components/common/ClientDate';

type ResourceType = 'PAPER' | 'BLOG' | 'REPORT' | 'YOUTUBE_VIDEO' | 'NEWS';

interface Configuration {
  id: string;
  name: string;
  keywords: string[];
  urlPatterns: string[];
  enabled: boolean;
  createdAt: string;
}

export function ConfigurationView({
  resourceType,
}: {
  resourceType: ResourceType;
}) {
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    keywords: '',
    urlPatterns: '',
  });

  const handleAddConfiguration = () => {
    if (!formData.name || !formData.keywords) {
      toast.warning('表单验证', '请输入名称和关键词');
      return;
    }

    const newConfig: Configuration = {
      id: Date.now().toString(),
      name: formData.name,
      keywords: formData.keywords.split(',').map((k) => k.trim()),
      urlPatterns: formData.urlPatterns
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean),
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    setConfigurations([...configurations, newConfig]);
    setFormData({ name: '', keywords: '', urlPatterns: '' });
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    setConfigurations(configurations.filter((c) => c.id !== id));
  };

  const handleToggle = (id: string) => {
    setConfigurations(
      configurations.map((c) =>
        c.id === id ? { ...c, enabled: !c.enabled } : c
      )
    );
  };

  return (
    <div className="space-y-6">
      {/* 添加配置按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">采集配置列表</h3>
          <p className="mt-1 text-sm text-gray-600">
            为{' '}
            {resourceType === 'PAPER'
              ? '学术论文'
              : resourceType === 'BLOG'
                ? '研究博客'
                : resourceType === 'REPORT'
                  ? '商业报告'
                  : resourceType === 'YOUTUBE_VIDEO'
                    ? 'YouTube视频'
                    : '科技新闻'}{' '}
            配置采集规则
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          添加配置
        </button>
      </div>

      {/* 添加配置表单 */}
      {showForm && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h4 className="mb-4 text-sm font-semibold text-gray-900">
            新建采集配置
          </h4>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                配置名称
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="例如：MIT AI研究"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                关键词 (逗号分隔)
              </label>
              <textarea
                value={formData.keywords}
                onChange={(e) =>
                  setFormData({ ...formData, keywords: e.target.value })
                }
                placeholder="例如：machine learning, deep learning, AI"
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                URL模式 (可选, 逗号分隔)
              </label>
              <input
                type="text"
                value={formData.urlPatterns}
                onChange={(e) =>
                  setFormData({ ...formData, urlPatterns: e.target.value })
                }
                placeholder="例如：arxiv.org, papers.nips.cc"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleAddConfiguration}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                保存
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 配置列表 */}
      <div className="space-y-3">
        {configurations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
            <p className="text-sm text-gray-600">
              暂无配置，点击"添加配置"创建新的采集规则
            </p>
          </div>
        ) : (
          configurations.map((config) => (
            <div
              key={config.id}
              className={`rounded-lg border p-4 transition-colors ${
                config.enabled
                  ? 'border-gray-200 bg-white hover:bg-gray-50'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={() => handleToggle(config.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <h5 className="font-medium text-gray-900">
                        {config.name}
                      </h5>
                      <p className="mt-1 text-xs text-gray-500">
                        创建于{' '}
                        <ClientDate date={config.createdAt} format="date" />
                      </p>
                    </div>
                  </div>
                  <div className="ml-7 mt-3 space-y-2">
                    <div>
                      <p className="text-xs font-medium text-gray-600">
                        关键词：
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {config.keywords.map((kw, idx) => (
                          <span
                            key={idx}
                            className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs text-blue-700"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                    {config.urlPatterns.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-600">
                          URL模式：
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {config.urlPatterns.map((url, idx) => (
                            <span
                              key={idx}
                              className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-700"
                            >
                              {url}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="ml-4 flex gap-2">
                  <button className="rounded p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(config.id)}
                    className="rounded p-2 text-gray-500 transition-colors hover:bg-red-100 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

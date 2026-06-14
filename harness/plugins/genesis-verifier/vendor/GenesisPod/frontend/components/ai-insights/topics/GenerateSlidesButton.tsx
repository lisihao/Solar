'use client';

import { useRouter } from 'next/navigation';
import { Presentation } from 'lucide-react';

interface GenerateSlidesButtonProps {
  topicId: string;
  topicName?: string;
  className?: string;
  /**
   * 预设 id（见 backend/.../slides/presets/*.json）。
   * 不传则 Slides 生成走默认 pipeline；传入后后端会按 preset 绑定替换对应 slot 的 skill。
   * 建议：从 Topic Insights 章节视图入口传入 "topic-insights.executive-brief"。
   */
  preset?: string;
  /** 按钮显示文本，默认「生成 PPT」 */
  label?: string;
}

export function GenerateSlidesButton({
  topicId,
  topicName,
  className,
  preset,
  label = '生成 PPT',
}: GenerateSlidesButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    const params = new URLSearchParams();
    params.set('action', 'import');
    params.set('sourceType', 'research');
    params.set('sourceId', topicId);
    if (topicName) params.set('title', topicName);
    if (preset) params.set('preset', preset);
    router.push(`/ai-office/slides?${params.toString()}`);
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 ${className ?? ''}`}
      title={preset ? `生成演示文稿（preset: ${preset}）` : '生成演示文稿'}
    >
      <Presentation className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

'use client';

import { AutoConfigureButton } from '@/components/common/model-config/AutoConfigureButton';

/**
 * 用户版一键 AI 配置按钮 —— 薄封装：
 *   endpoint = /user/model-configs/auto-configure
 *   真正的 UI / 逻辑在 components/shared/model-config/AutoConfigureButton.tsx
 */
export function UserModelsAutoConfigureButton({
  disabled,
  onDone,
}: {
  disabled?: boolean;
  onDone?: () => void;
}) {
  return (
    <AutoConfigureButton
      endpoint="/user/model-configs/auto-configure"
      disabled={disabled}
      disabledReason="先在 API Keys Tab 配置至少一个 Provider 的 Key"
      onDone={onDone}
      confirmSubtitle="自动为你的每个 Provider Key 创建推荐模型"
      bullets={[
        '用你的每个 Personal Key 调 Provider 的 /v1/models',
        '按推荐矩阵（OpenAI / Claude / Cohere rerank 等）自动选定 modelId',
        '为每个 modelType 创建 UserModelConfig，第一个命中自动设为默认',
        '已经配置过的模型不会重复创建',
      ]}
    />
  );
}

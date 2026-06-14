/**
 * ModelBadges
 *
 * 模型来源徽章组件 — 在自定义下拉/卡片场景里渲染 chip 标识：
 *   - 绿色 "My Key": 用户配了 BYOK
 *   - 紫色 "Multi": 多模型混合
 *
 * `<select>` 原生 <option> 不能放 React 组件，那种场景请用 modelLabelSuffix(model)
 * 拿到纯文本（`· 我的 Key` / `· 系统 Key`）。
 *
 * 来源：从 app/ai-ask/page.tsx 提到 components/common/，作为唯一来源给所有
 * 页面复用，避免每个页面再各搞一套。
 */
'use client';

import { KeyRound, Layers, Server, BotMessageSquare } from 'lucide-react';
import type { AIModel } from '@/hooks';
import { useI18n } from '@/lib/i18n/i18n-context';

interface BadgeShape {
  isUserKey?: boolean;
  isMixture?: boolean;
  isSelfDriven?: boolean;
}

interface MetaShape extends BadgeShape {
  provider?: string;
}

/**
 * 模型来源元信息行 — 在自定义下拉 / 列表 / 卡片里替代纯 provider 文本：
 *   `<provider> · [KeyRound] 我的 Key`（emerald）
 *   `<provider> · [Server]   系统 Key`（slate）
 *
 * 与 `ModelSelect` 下拉行视觉一致，让 AI Ask / ai-teams 等已自定义 UI 的下拉
 * 也能拿到同款专业图标，而不是仅靠右上角小 chip。
 */
export function ModelKeyMeta({
  model,
  className,
}: {
  model: MetaShape | AIModel;
  className?: string;
}) {
  const { t } = useI18n();
  const m = model as MetaShape;
  const isUserKey = !!m.isUserKey;
  const Icon = isUserKey ? KeyRound : Server;
  const labelKey = isUserKey
    ? 'common.modelKeyLabel.myKey'
    : 'common.modelKeyLabel.systemKey';
  const fallback = isUserKey ? '我的 Key' : '系统 Key';
  const labelRaw = t(labelKey);
  const label = labelRaw === labelKey ? fallback : labelRaw;
  const tone = isUserKey ? 'text-emerald-600' : 'text-slate-500';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] text-gray-500 ${className ?? ''}`}
    >
      {m.provider ? <span className="truncate">{m.provider}</span> : null}
      {m.provider ? <span aria-hidden>·</span> : null}
      <Icon size={11} className={`shrink-0 ${tone}`} aria-hidden />
      <span className={tone}>{label}</span>
    </span>
  );
}

export function ModelBadges({ model }: { model: BadgeShape | AIModel }) {
  return (
    <>
      {(model as BadgeShape).isSelfDriven && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-gradient-to-r from-violet-600 to-purple-600 px-1 py-0.5 text-[10px] text-white">
          <BotMessageSquare size={10} aria-hidden />
          Team
        </span>
      )}
      {(model as BadgeShape).isMixture && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-gradient-to-r from-violet-500 to-fuchsia-500 px-1 py-0.5 text-[10px] text-white">
          <Layers size={10} aria-hidden />
          Multi
        </span>
      )}
      {(model as BadgeShape).isUserKey && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-1 py-0.5 text-[10px] text-white">
          <KeyRound size={10} aria-hidden />
          My Key
        </span>
      )}
    </>
  );
}

/**
 * `<select>` 场景下的纯文本后缀（option 内不能放 component）。
 * 用于：app/page.tsx, app/explore/youtube/page.tsx, app/admin/workspace/page.tsx
 *      及 ai-teams 等所有用原生 select 的地方。
 *
 * 例：`{model.name} ({model.provider}){modelLabelSuffix(model, t)}`
 *     渲染："ChatGPT (OpenAI) · My Key" 或 "...· 我的 Key"
 *
 * 接收可选的 t 函数让 i18n 生效；不传时退回中文（旧调用方兼容）。
 * Translator 签名匹配项目 `useI18n().t`：
 *   `(key, params?: Record<string, string | number>) => string`
 * 项目 t 不支持 fallback 参数，因此本函数自己做 fallback 兜底（key 缺失返回 key 本身）。
 */
type Translator = (
  key: string,
  params?: Record<string, string | number>
) => string;

export function modelLabelSuffix(model: BadgeShape, t?: Translator): string {
  const fallback = model.isUserKey ? '我的 Key' : '系统 Key';
  if (t) {
    const key = model.isUserKey
      ? 'common.modelKeyLabel.myKey'
      : 'common.modelKeyLabel.systemKey';
    const result = t(key);
    // 项目 t 在 key 不存在时直接返回 key 本身；这种情况退回中文兜底
    const label = result === key ? fallback : result;
    return ` · ${label}`;
  }
  return ` · ${fallback}`;
}

'use client';

/**
 * ApprovalCard
 *
 * 单个审批请求卡片，支持四种交互模式：
 * - confirm  → Approve / Reject 按钮
 * - choose   → 选项列表，选择后自动提交
 * - input    → 文本输入框 + Submit
 * - review   → textarea 反馈 + Approve / Reject
 */

import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  MessageSquare,
  List,
  Edit3,
  Eye,
  Loader,
} from 'lucide-react';
import {
  ApprovalRequest,
  RespondPayload,
  ChoiceOption,
} from './useApprovalQueue';

// ─── Helpers ──────────────────────────────────────────────

function typeIcon(type: ApprovalRequest['approvalType']) {
  if (type === 'confirm')
    return <CheckCircle className="h-4 w-4 text-blue-400" />;
  if (type === 'choose') return <List className="h-4 w-4 text-purple-400" />;
  if (type === 'input') return <Edit3 className="h-4 w-4 text-yellow-400" />;
  return <Eye className="h-4 w-4 text-green-400" />;
}

function typeLabel(type: ApprovalRequest['approvalType']) {
  const labels: Record<string, string> = {
    confirm: '确认',
    choose: '选择',
    input: '输入',
    review: '审查',
  };
  return labels[type] ?? type;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} 小时前`;
}

// ─── Props ─────────────────────────────────────────────────

interface ApprovalCardProps {
  approval: ApprovalRequest;
  isBusy: boolean;
  onRespond: (payload: RespondPayload) => Promise<void>;
}

// ─── Sub-renderers ─────────────────────────────────────────

function ConfirmButtons({
  isBusy,
  onRespond,
}: {
  isBusy: boolean;
  onRespond: (p: RespondPayload) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onRespond({ approved: true })}
        disabled={isBusy}
        className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50"
      >
        {isBusy ? (
          <Loader className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle className="h-3.5 w-3.5" />
        )}
        批准
      </button>
      <button
        onClick={() => onRespond({ approved: false })}
        disabled={isBusy}
        className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
      >
        <XCircle className="h-3.5 w-3.5" />
        拒绝
      </button>
    </div>
  );
}

function ChoiceButtons({
  choices,
  isBusy,
  onRespond,
}: {
  choices: ChoiceOption[];
  isBusy: boolean;
  onRespond: (p: RespondPayload) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((c) => (
        <button
          key={c.id}
          onClick={() => onRespond({ approved: true, choice: c.id })}
          disabled={isBusy}
          title={c.description}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-blue-500/60 hover:bg-blue-500/10 hover:text-white disabled:opacity-50"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function InputForm({
  isBusy,
  onRespond,
}: {
  isBusy: boolean;
  onRespond: (p: RespondPayload) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="输入内容..."
        className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/60"
      />
      <button
        onClick={() => onRespond({ approved: true, input: value })}
        disabled={isBusy || !value.trim()}
        className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {isBusy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : '提交'}
      </button>
    </div>
  );
}

function ReviewForm({
  isBusy,
  onRespond,
}: {
  isBusy: boolean;
  onRespond: (p: RespondPayload) => void;
}) {
  const [feedback, setFeedback] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="填写审查意见（可选）..."
        rows={3}
        className="resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/60"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onRespond({ approved: true, feedback })}
          disabled={isBusy}
          className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50"
        >
          <CheckCircle className="h-3.5 w-3.5" />
          通过
        </button>
        <button
          onClick={() => onRespond({ approved: false, feedback })}
          disabled={isBusy}
          className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
        >
          <XCircle className="h-3.5 w-3.5" />
          退回
        </button>
      </div>
    </div>
  );
}

// ─── Main Card ─────────────────────────────────────────────

export function ApprovalCard({
  approval,
  isBusy,
  onRespond,
}: ApprovalCardProps) {
  const { approvalType, prompt, context, choices, requestId, createdAt } =
    approval;

  return (
    <div className="rounded-xl border border-white/10 bg-gray-900 p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {typeIcon(approvalType)}
          <span className="text-xs font-medium text-gray-400">
            {typeLabel(approvalType)}
          </span>
          <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[11px] text-yellow-400">
            待处理
          </span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-gray-600">
          <Clock className="h-3 w-3" />
          {timeAgo(createdAt)}
        </div>
      </div>

      {/* Prompt */}
      <p className="mb-3 text-sm text-white">{prompt}</p>

      {/* Context */}
      {context?.summary && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
          <span className="text-xs text-gray-400">{context.summary}</span>
        </div>
      )}
      {context?.preview && /^https?:\/\//i.test(context.preview) && (
        <img
          src={context.preview}
          alt="preview"
          className="mb-3 max-h-48 rounded-lg object-cover"
        />
      )}

      {/* Request ID */}
      <p className="font-mono mb-3 text-[10px] text-gray-700">{requestId}</p>

      {/* Action area */}
      {approvalType === 'confirm' && (
        <ConfirmButtons isBusy={isBusy} onRespond={onRespond} />
      )}
      {approvalType === 'choose' && choices && choices.length > 0 && (
        <ChoiceButtons
          choices={choices}
          isBusy={isBusy}
          onRespond={onRespond}
        />
      )}
      {approvalType === 'input' && (
        <InputForm isBusy={isBusy} onRespond={onRespond} />
      )}
      {approvalType === 'review' && (
        <ReviewForm isBusy={isBusy} onRespond={onRespond} />
      )}
    </div>
  );
}

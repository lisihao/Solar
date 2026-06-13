/**
 * 把后端 raw error code / stack 转成普通用户友好的简短中文。
 *
 * Strategy:
 *   1. 已知 error code → 中文短语 + 可选 hint
 *   2. 未匹配 → 去掉冗余技术细节后截前 80 字 + 省略号
 */

const ERROR_CODE_LABELS: Record<string, { label: string; hint?: string }> = {
  RUNNER_OUTPUT_SCHEMA_MISMATCH: {
    label: '输出格式不符合预期',
    hint: '已自动重试，无需人工介入',
  },
  RUNNER_INPUT_SCHEMA_MISMATCH: {
    label: '输入参数格式异常',
    hint: '检查任务配置或重新提交',
  },
  TOOL_TIMEOUT: { label: '工具调用超时', hint: '已自动降级或重试' },
  TOOL_RUNTIME_ERROR: { label: '工具执行失败', hint: '已记录错误日志' },
  TOOL_INPUT_VALIDATION_FAILED: { label: '工具参数校验未通过' },
  PROVIDER_API_ERROR: { label: 'AI 服务暂时不可用', hint: '稍后自动重试' },
  PROVIDER_QUOTA_EXCEEDED: {
    label: 'LLM 账户余额/配额已耗尽',
    hint: '请到所选模型 Provider（OpenAI / Anthropic 等）控制台充值或提升配额，再重新启动任务',
  },
  PROVIDER_RATE_LIMIT: {
    label: 'LLM 触发限速',
    hint: '系统会自动退避重试，无需手动处理；持续失败请稍后再试',
  },
  PROVIDER_TRUNCATED: {
    label: '模型上下文长度被截断',
    hint: '已尝试切到大窗口模型；如仍失败请缩短 topic 或减小 dim 数',
  },
  PROVIDER_SAFETY_REFUSAL: {
    label: '模型出于安全策略拒绝响应',
    hint: '请改写 topic 避免触发安全拦截',
  },
  PROVIDER_BYOK_MODEL_NOT_FOUND: {
    label: '所选 BYOK 模型不可用',
    hint: '检查模型 ID 拼写或换一个可用模型',
  },
  AGENT_BUDGET_EXHAUSTED: { label: '本任务预算耗尽' },
  AGENT_MAX_ITERATIONS: {
    label: '推理轮次达上限',
    hint: '已按当前最佳结果产出',
  },
  AGENT_ABORTED: { label: '任务被取消' },
};

export function friendlyError(raw: string | undefined | null): string {
  if (!raw) return '';
  const text = String(raw).trim();
  // ★ 2026-05-01 (mission b791054e 实证): backend 抛 "Leader.plan failed [CODE]: msg"
  //   时 [CODE] 不在字符串开头，旧 ^\[ 锚定永远不命中，用户看到原文 raw text
  //   "Agent 内部错误 —— 详见 trace 末尾"。改为全文搜首个 [CODE_NAME]。
  const codeMatch = text.match(/\[([A-Z][A-Z_]+)\]/);
  if (codeMatch) {
    const meta = ERROR_CODE_LABELS[codeMatch[1]];
    if (meta) {
      return meta.hint ? `${meta.label}（${meta.hint}）` : meta.label;
    }
  }
  // 兜底：去掉 schemaError / code= 等冗余技术细节后截短
  let cleaned = text
    .replace(/\[schemaError=[^\]]+\]/g, '')
    .replace(/\(code=[^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 80) + '…';
  return cleaned;
}

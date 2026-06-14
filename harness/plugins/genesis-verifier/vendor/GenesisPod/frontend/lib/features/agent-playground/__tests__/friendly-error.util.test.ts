import { friendlyError } from '../friendly-error.util';

describe('friendlyError', () => {
  it('maps RUNNER_OUTPUT_SCHEMA_MISMATCH to friendly Chinese with hint', () => {
    const raw =
      '[RUNNER_OUTPUT_SCHEMA_MISMATCH] [schemaError=<root>: Expected object, received null (code=invalid_type)] Output schema validation failed';
    expect(friendlyError(raw)).toBe(
      '输出格式不符合预期（已自动重试，无需人工介入）'
    );
  });

  it('maps RUNNER_INPUT_SCHEMA_MISMATCH', () => {
    expect(friendlyError('[RUNNER_INPUT_SCHEMA_MISMATCH] bad input')).toBe(
      '输入参数格式异常（检查任务配置或重新提交）'
    );
  });

  it('maps TOOL_TIMEOUT', () => {
    expect(friendlyError('[TOOL_TIMEOUT] timeout after 30s')).toBe(
      '工具调用超时（已自动降级或重试）'
    );
  });

  it('maps TOOL_RUNTIME_ERROR', () => {
    expect(friendlyError('[TOOL_RUNTIME_ERROR] unexpected error')).toBe(
      '工具执行失败（已记录错误日志）'
    );
  });

  it('maps TOOL_INPUT_VALIDATION_FAILED (no hint)', () => {
    expect(friendlyError('[TOOL_INPUT_VALIDATION_FAILED] missing field')).toBe(
      '工具参数校验未通过'
    );
  });

  it('maps PROVIDER_API_ERROR', () => {
    expect(friendlyError('[PROVIDER_API_ERROR] rate limit')).toBe(
      'AI 服务暂时不可用（稍后自动重试）'
    );
  });

  it('maps PROVIDER_QUOTA_EXCEEDED to actionable billing message', () => {
    expect(
      friendlyError(
        '[PROVIDER_QUOTA_EXCEEDED] You exceeded your current quota, please check your plan and billing details.'
      )
    ).toBe(
      'LLM 账户余额/配额已耗尽（请到所选模型 Provider（OpenAI / Anthropic 等）控制台充值或提升配额，再重新启动任务）'
    );
  });

  it('maps PROVIDER_RATE_LIMIT', () => {
    expect(friendlyError('[PROVIDER_RATE_LIMIT] 429')).toBe(
      'LLM 触发限速（系统会自动退避重试，无需手动处理；持续失败请稍后再试）'
    );
  });

  it('finds [CODE] anywhere in string (not just at start)', () => {
    // Real backend message: "Leader.plan failed [CODE]: msg"
    expect(
      friendlyError(
        'Leader.plan failed [PROVIDER_QUOTA_EXCEEDED]: Agent 内部错误'
      )
    ).toBe(
      'LLM 账户余额/配额已耗尽（请到所选模型 Provider（OpenAI / Anthropic 等）控制台充值或提升配额，再重新启动任务）'
    );
  });

  it('maps AGENT_BUDGET_EXHAUSTED', () => {
    expect(friendlyError('[AGENT_BUDGET_EXHAUSTED]')).toBe('本任务预算耗尽');
  });

  it('maps AGENT_MAX_ITERATIONS', () => {
    expect(friendlyError('[AGENT_MAX_ITERATIONS] reached 20')).toBe(
      '推理轮次达上限（已按当前最佳结果产出）'
    );
  });

  it('maps AGENT_ABORTED', () => {
    expect(friendlyError('[AGENT_ABORTED] user cancelled')).toBe('任务被取消');
  });

  it('falls back to truncated text for unknown code', () => {
    expect(friendlyError('[UNKNOWN_CODE] some message')).toBe(
      '[UNKNOWN_CODE] some message'
    );
  });

  it('strips schemaError and code= from fallback text', () => {
    const raw =
      'Something failed [schemaError=<root>: Expected object (code=invalid_type)] extra';
    expect(friendlyError(raw)).toBe('Something failed extra');
  });

  it('truncates long fallback text at 80 chars', () => {
    const raw = 'A'.repeat(100);
    const result = friendlyError(raw);
    expect(result).toBe('A'.repeat(80) + '…');
  });

  it('returns empty string for undefined', () => {
    expect(friendlyError(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(friendlyError(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(friendlyError('')).toBe('');
  });
});

const truthyValues = new Set(["true", "1", "yes", "on"]);

/**
 * 判断功能开关是否开启
 * @param value 环境变量值
 */
const isTruthy = (value?: string | null): boolean => {
  if (!value) {
    return false;
  }
  return truthyValues.has(value.toLowerCase());
};

/**
 * Workspace AI V2 功能开关
 */
export const isWorkspaceAiV2Enabled = (): boolean => {
  const direct = process.env.WORKSPACE_AI_V2_ENABLED;
  if (direct !== undefined) {
    return isTruthy(direct);
  }

  // 兼容前端公开变量
  return isTruthy(process.env.NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED);
};

/**
 * 通用 Feature Flag 读取方法，可以按需扩展
 */
export const isFeatureEnabled = (key: string, fallback = false): boolean => {
  const value = process.env[key];
  if (value === undefined) {
    return fallback;
  }
  return isTruthy(value);
};

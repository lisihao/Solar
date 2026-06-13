'use client';

/**
 * useAssetForm - 资产基本信息编辑 Hook
 *
 * 抽出 ResearchSettingsModal / WritingEditDialog / PlanSettingsModal 共用的：
 * - 表单态（dirty / submitting / error）
 * - 字段级 validator
 * - 提交编排（onSubmit + 错误处理）
 * - 权限检查（自定义 permissionCheck，平台不假设权限模型）
 *
 * 不在平台层做的：
 * - API 调用（onSubmit 由调用方实现）
 * - 字段渲染（hook 只管态，UI 由调用方写）
 * - i18n（错误文案由调用方根据 errorKey 翻译）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type AssetFormErrorKey =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'invalidFormat'
  | 'custom';

export interface AssetFormFieldError {
  key: AssetFormErrorKey;
  /** 自定义文案 / 翻译 fallback */
  message?: string;
}

export type AssetFormValidator<TValue> = (
  value: TValue,
  values: Record<string, unknown>
) => AssetFormFieldError | null;

export interface AssetFormFieldConfig<TValue = unknown> {
  /** 默认值 */
  defaultValue: TValue;
  /** 必填 */
  required?: boolean;
  /** 最小长度（字符串） */
  minLength?: number;
  /** 最大长度（字符串） */
  maxLength?: number;
  /** 自定义校验，返回错误 / null */
  validate?: AssetFormValidator<TValue>;
}

export interface UseAssetFormOptions<TFields extends Record<string, unknown>> {
  /** 字段配置（key 必须与 TFields 对齐） */
  fields: { [K in keyof TFields]: AssetFormFieldConfig<TFields[K]> };
  /** 初始值（一般是当前资产数据） */
  initialValues?: Partial<TFields>;
  /** 提交回调 */
  onSubmit: (values: TFields) => Promise<void> | void;
  /**
   * 权限检查；返回 false 时禁止编辑。
   * 默认 () => true。
   */
  permissionCheck?: () => boolean | Promise<boolean>;
}

export interface UseAssetFormResult<TFields extends Record<string, unknown>> {
  values: TFields;
  setField: <K extends keyof TFields>(key: K, value: TFields[K]) => void;
  setValues: (next: Partial<TFields>) => void;
  reset: () => void;
  /** 字段级错误 */
  errors: Partial<Record<keyof TFields, AssetFormFieldError>>;
  /** 顶层提交错误（来自 onSubmit 抛出的 Error） */
  submitError: string | null;
  /** 表单是否被修改过 */
  dirty: boolean;
  /** 是否有效（无字段错误） */
  valid: boolean;
  /** 是否有权限编辑（异步 permissionCheck 解析中为 null） */
  canEdit: boolean | null;
  /** 是否正在提交 */
  submitting: boolean;
  /** 触发提交 */
  submit: () => Promise<void>;
}

function getValueLength(value: unknown): number | null {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.length;
  return null;
}

function validateField<TValue>(
  config: AssetFormFieldConfig<TValue>,
  value: TValue,
  values: Record<string, unknown>
): AssetFormFieldError | null {
  if (config.required) {
    if (value === undefined || value === null || value === '') {
      return { key: 'required' };
    }
  }
  const len = getValueLength(value);
  if (len !== null) {
    if (config.minLength !== undefined && len < config.minLength) {
      return { key: 'tooShort' };
    }
    if (config.maxLength !== undefined && len > config.maxLength) {
      return { key: 'tooLong' };
    }
  }
  if (config.validate) {
    return config.validate(value, values);
  }
  return null;
}

export function useAssetForm<TFields extends Record<string, unknown>>(
  options: UseAssetFormOptions<TFields>
): UseAssetFormResult<TFields> {
  const { fields, initialValues, onSubmit, permissionCheck } = options;

  const baseValues = useMemo(() => {
    const result: Record<string, unknown> = {};
    (Object.keys(fields) as Array<keyof TFields>).forEach((key) => {
      const initial = initialValues?.[key];
      result[key as string] =
        initial !== undefined ? initial : fields[key].defaultValue;
    });
    return result as TFields;
    // initialValues / fields 引用变化时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, initialValues]);

  const [values, setValuesState] = useState<TFields>(baseValues);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [canEdit, setCanEdit] = useState<boolean | null>(
    permissionCheck ? null : true
  );

  // 当 baseValues 重置时同步
  useEffect(() => {
    setValuesState(baseValues);
  }, [baseValues]);

  // 异步权限检查
  useEffect(() => {
    if (!permissionCheck) {
      setCanEdit(true);
      return;
    }
    let cancelled = false;
    Promise.resolve(permissionCheck())
      .then((ok) => {
        if (!cancelled) setCanEdit(ok);
      })
      .catch(() => {
        if (!cancelled) setCanEdit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [permissionCheck]);

  const setField = useCallback(
    <K extends keyof TFields>(key: K, value: TFields[K]) => {
      setValuesState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const setValues = useCallback((next: Partial<TFields>) => {
    setValuesState((prev) => ({ ...prev, ...next }));
  }, []);

  const reset = useCallback(() => {
    setValuesState(baseValues);
    setSubmitError(null);
  }, [baseValues]);

  const errors = useMemo(() => {
    const out: Partial<Record<keyof TFields, AssetFormFieldError>> = {};
    (Object.keys(fields) as Array<keyof TFields>).forEach((key) => {
      const err = validateField(
        fields[key],
        values[key],
        values as Record<string, unknown>
      );
      if (err) out[key] = err;
    });
    return out;
  }, [fields, values]);

  const valid = Object.keys(errors).length === 0;

  const dirty = useMemo(() => {
    return (Object.keys(fields) as Array<keyof TFields>).some(
      (key) => values[key] !== baseValues[key]
    );
  }, [fields, values, baseValues]);

  const submit = useCallback(async () => {
    if (!valid || canEdit === false) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Submission failed';
      setSubmitError(message);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [valid, canEdit, onSubmit, values]);

  return {
    values,
    setField,
    setValues,
    reset,
    errors,
    submitError,
    dirty,
    valid,
    canEdit,
    submitting,
    submit,
  };
}

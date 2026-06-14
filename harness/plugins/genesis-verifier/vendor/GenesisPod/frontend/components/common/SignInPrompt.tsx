'use client';

import { useRouter } from 'next/navigation';
import { LogIn, AlertCircle } from 'lucide-react';

interface SignInPromptProps {
  /** 提示标题 */
  title?: string;
  /** 提示描述 */
  description?: string;
  /** 是否显示图标 */
  showIcon?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 登录引导组件
 * 当用户未登录时显示，引导用户登录
 */
export default function SignInPrompt({
  title = '请先登录',
  description = '登录后即可使用此功能',
  showIcon = true,
  className = '',
}: SignInPromptProps) {
  const router = useRouter();

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 py-12 ${className}`}
    >
      {showIcon && (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <AlertCircle className="h-8 w-8 text-blue-600" />
        </div>
      )}
      <h3 className="mt-4 text-lg font-medium text-gray-900">{title}</h3>
      <p className="mt-2 max-w-md text-center text-gray-500">{description}</p>
      <button
        onClick={() => router.push('/login')}
        className="mt-6 flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-white transition-colors hover:bg-blue-700"
      >
        <LogIn className="h-5 w-5" />
        登录 / 注册
      </button>
    </div>
  );
}

/**
 * 检查是否是认证错误
 * 支持 Error 和 ApiError 类型
 */
export function isAuthError(
  error: { message?: string; status?: number } | null | undefined
): boolean {
  if (!error) return false;
  const errorMessage = error.message?.toLowerCase() || '';
  const errorStatus = error.status;

  return (
    errorStatus === 401 ||
    errorMessage.includes('sign in') ||
    errorMessage.includes('please sign in') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('not authenticated')
  );
}

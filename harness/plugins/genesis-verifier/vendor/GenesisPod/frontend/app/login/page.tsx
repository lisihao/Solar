'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { BrandLogo } from '@/components/common/brand/BrandLogo';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';

type Mode = 'login' | 'register';

const COPY: Record<
  Mode,
  {
    title: string;
    subtitle: string;
    submit: string;
    switchPrompt: string;
    switchAction: string;
  }
> = {
  login: {
    title: '欢迎回来',
    subtitle: '登入工作台，继续你的研究',
    submit: '登入',
    switchPrompt: '还没有账户？',
    switchAction: '创建账户',
  },
  register: {
    title: '创建账户',
    subtitle: '几分钟搭好你的 AI 工作流',
    submit: '注册',
    switchPrompt: '已有账户？',
    switchAction: '直接登入',
  },
};

export default function LoginPage() {
  const router = useRouter();
  const { login, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const copy = COPY[mode];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // ★ 2026-05-27 修复 (Screenshot_86 Failed to fetch):
      //   apiUrl 走 same-origin → Next.js middleware 实时 rewrite 到 backend,
      //   不再用 streamApiUrl (那个为 SSE 直连设计, onprem 部署烤死 localhost:4000 失败)。
      const url = `${config.apiUrl}/auth/${mode}`;
      const body =
        mode === 'login' ? { email, password } : { email, password, username };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.message || `${mode} failed`);
      }

      const { user, accessToken, refreshToken } = result.data;
      login(user, accessToken, refreshToken);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (nextMode?: Mode) => {
    setError(null);
    setMode((current) =>
      nextMode ?? (current === 'login' ? 'register' : 'login')
    );
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-violet-50/40 px-4 py-8 text-slate-900">
      {/* 浅色背景: 极淡网格 + 双柔光 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
          maskImage:
            'radial-gradient(ellipse at center, black 40%, transparent 75%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[15%] top-[12%] h-[420px] w-[420px] rounded-full bg-violet-200/40 blur-[120px]" />
        <div className="absolute bottom-[8%] right-[14%] h-[380px] w-[380px] rounded-full bg-cyan-200/40 blur-[100px]" />
      </div>

      <main className="relative w-full max-w-[400px]">
        {/* Logo - 头顶居中, 极简 */}
        <div className="mb-7 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="transition-opacity hover:opacity-80"
            aria-label="Go home"
          >
            <BrandLogo variant="full" subtitle={null} />
          </button>
          <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-slate-500">
            AI Research Workspace
          </span>
        </div>

        {/* 主卡片 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:p-7">
          {/* Mode toggle */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50/80 p-1">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`h-9 rounded-lg text-[13px] font-medium transition ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              登入
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`h-9 rounded-lg text-[13px] font-medium transition ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              注册
            </button>
          </div>

          {/* 标题区 */}
          <div className="mb-5">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {copy.title}
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">{copy.subtitle}</p>
          </div>

          {/* Google */}
          <button
            type="button"
            onClick={() => loginWithGoogle(email || undefined)}
            disabled={loading}
            className="mb-4 inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 text-[13.5px] font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            使用 Google 账户
          </button>

          {/* 分隔 */}
          <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            <span className="h-px bg-slate-200" />
            <span>或</span>
            <span className="h-px bg-slate-200" />
          </div>

          {/* 表单 */}
          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-3">
            <input
              type="text"
              name="fake-username"
              autoComplete="username"
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
            />
            <input
              type="password"
              name="fake-password"
              autoComplete="current-password"
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
            />

            <input
              key={`${mode}-email`}
              type="email"
              name={`${mode}-contact`}
              required
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              placeholder="邮箱"
            />

            {mode === 'register' && (
              <input
                key={`${mode}-username`}
                type="text"
                name="register-display-name"
                required
                minLength={1}
                maxLength={50}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                placeholder="用户名"
              />
            )}

            <input
              key={`${mode}-password`}
              type="password"
              name={`${mode}-secret`}
              required
              minLength={mode === 'register' ? 8 : 6}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              placeholder={mode === 'register' ? '设置密码 (≥8 位)' : '密码'}
            />

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,0.4)] transition hover:from-violet-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{loading ? '请稍候' : copy.submit}</span>
              {!loading && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </form>

          {/* 底部辅助 */}
          <div className="mt-5 flex items-center justify-between gap-3 text-[12px] text-slate-500">
            <button
              type="button"
              onClick={() => switchMode()}
              className="font-medium text-slate-700 transition hover:text-slate-900"
            >
              {copy.switchPrompt}
              <span className="ml-1 text-violet-600">{copy.switchAction}</span>
            </button>
            {mode === 'login' && (
              <Link
                href="/"
                className="font-medium transition hover:text-slate-700"
              >
                需要帮助？
              </Link>
            )}
          </div>
        </div>

        {/* 页脚 */}
        <p className="mt-5 text-center text-[11px] text-slate-400">
          Powered by Genesis · 多 Agent 协作研究平台
        </p>
      </main>
    </div>
  );
}

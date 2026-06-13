'use client';

import { useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { BrandLogo } from '@/components/common/brand/BrandLogo';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';

// Auth callback uses direct backend URL to bypass CDN/proxy.
// The Next.js rewrite proxy goes through Railway's Fastly CDN edge,
// which can return 503 under load ("Pop visit count exceeded").
// Critical auth flows must not depend on CDN availability.
const getAuthApiUrl = () => config.streamApiUrl;

function AuthCallbackLoading({ text }: { text: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#eef5ff_0%,#fff8f1_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[-8%] h-[320px] w-[320px] rounded-full bg-sky-300/30 blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-6%] h-[280px] w-[280px] rounded-full bg-amber-200/40 blur-3xl" />
      </div>

      <div className="relative flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-[520px] rounded-[32px] border border-white/70 bg-white/78 p-3 shadow-[0_28px_90px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="rounded-[28px] bg-white/92 p-8 sm:p-10">
            <div className="mb-8 flex justify-center">
              <BrandLogo variant="full" subtitle={null} />
            </div>

            <div className="mx-auto max-w-md text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <h1 className="text-3xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-4xl">
                Finishing sign in
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-[15px]">
                {text}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const exchangedRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams?.get('code');
      const directToken = searchParams?.get('token');
      const directRefreshToken = searchParams?.get('refreshToken');

      if (directToken && directRefreshToken) {
        try {
          const response = await fetch(`${getAuthApiUrl()}/auth/me`, {
            headers: {
              Authorization: `Bearer ${directToken}`,
            },
          });

          if (!response.ok) {
            throw new Error('Failed to fetch user info');
          }

          const result = await response.json();
          const user = result?.data ?? result;
          login(user, directToken, directRefreshToken);
          router.push('/');
          return;
        } catch (error) {
          logger.error('Authentication failed with direct tokens:', error);
          router.push('/');
          return;
        }
      }

      if (!code) {
        logger.error('Missing authorization code in callback URL');
        router.push('/');
        return;
      }

      if (exchangedRef.current) {
        return;
      }
      exchangedRef.current = true;

      try {
        const exchangeResponse = await fetch(`${getAuthApiUrl()}/auth/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        });

        if (!exchangeResponse.ok) {
          throw new Error('Failed to exchange authorization code');
        }

        const exchangeResult = await exchangeResponse.json();
        const tokenData = exchangeResult?.data ?? exchangeResult;
        const { accessToken, refreshToken, user } = tokenData;

        if (!accessToken || !refreshToken) {
          throw new Error('Invalid token response');
        }

        let userData = user;
        if (!userData) {
          const userResponse = await fetch(`${getAuthApiUrl()}/auth/me`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (!userResponse.ok) {
            throw new Error('Failed to fetch user info');
          }

          const userResult = await userResponse.json();
          userData = userResult?.data ?? userResult;
        }

        login(userData, accessToken, refreshToken);
        router.push('/');
      } catch (error) {
        logger.error('Authentication failed:', error);
        router.push('/');
      }
    };

    handleCallback();
  }, [searchParams, router, login]);

  return (
    <AuthCallbackLoading text="We are verifying your session and preparing your workspace." />
  );
}

export default function AuthCallback() {
  return (
    <Suspense
      fallback={
        <AuthCallbackLoading text="Loading your authentication details." />
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}

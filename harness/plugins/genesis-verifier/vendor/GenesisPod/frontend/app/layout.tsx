import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
import { config } from '@/lib/utils/config';

// ★ 跳过静态生成 - 应用使用客户端上下文，必须在运行时渲染
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${config.brand.fullName} - ${config.brand.tagline}`,
  description:
    'AI-powered research platform for intelligent knowledge discovery',
  icons: {
    icon: [{ url: config.brand.logo.faviconPath, type: 'image/svg+xml' }],
    apple: config.brand.logo.faviconPath,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

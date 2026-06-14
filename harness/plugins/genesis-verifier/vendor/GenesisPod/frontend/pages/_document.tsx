// ★ 恢复（2026-05-27）：commit 6d4dc1908 误删此文件，导致 Next 14.2 build
//   prerender /404 + /500 时报 `<Html> should not be imported outside of
//   pages/_document`。Next 用默认 Document 与 app/global-error.tsx 的
//   `<html>/<body>` 冲突；显式提供 _document 解决。
//   纯 App Router 仍需此文件作为 Pages Router fallback 的 Document 骨架。

import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

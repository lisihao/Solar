// ★ 恢复（2026-05-27）：commit 6d4dc1908 误删此文件，与 _document.tsx 同步。
//   Pages Router fallback /404 + /500 静态生成时需要此自定义 Error 页面，避免
//   走 Next 默认实现导致 <Html> 调用上下文错乱。

interface ErrorProps {
  statusCode?: number;
}

function Error({ statusCode }: ErrorProps) {
  return (
    <p>
      {statusCode
        ? `An error ${statusCode} occurred on server`
        : 'An error occurred on client'}
    </p>
  );
}

Error.getInitialProps = ({
  res,
  err,
}: {
  res?: { statusCode?: number };
  err?: { statusCode?: number };
}) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;

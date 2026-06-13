import type { StatusToken } from './tokens';

interface StatusDotProps {
  token: StatusToken;
  size?: 'sm' | 'md';
}

/**
 * 统一的状态徽章 (圆点 + 标签)
 */
export default function StatusDot({ token, size = 'sm' }: StatusDotProps) {
  const sizing =
    size === 'sm' ? 'px-2 py-0.5 text-xs gap-1.5' : 'px-2.5 py-1 text-sm gap-2';
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${token.bg} ${token.text} ${sizing}`}
    >
      <span className={`rounded-full ${dotSize} ${token.dot}`} />
      {token.label}
    </span>
  );
}

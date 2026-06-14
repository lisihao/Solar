import type { TeamAvatarProps } from './types';

/**
 * Writer Avatar — Kawaii character in a writing pose holding a pen.
 */
export function WriterAvatar({ size, status }: TeamAvatarProps) {
  const h = size;
  const w = h * 0.6;
  const isWorking = status === 'working';

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 30 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={isWorking ? 'animate-bounce-subtle' : undefined}
    >
      {/* Head */}
      <circle
        cx="15"
        cy="13"
        r="7"
        fill="#FFD7B5"
        stroke="#333"
        strokeWidth="1"
      />
      {/* Beret */}
      <path
        d="M8 11 Q8 5 15 6 Q22 5 22 11"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.8"
      />
      <circle
        cx="15"
        cy="5"
        r="1.5"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.5"
      />
      {/* Eyes */}
      <circle cx="12.5" cy="12.5" r="1" fill="#333" />
      <circle cx="17.5" cy="12.5" r="1" fill="#333" />
      {/* Focused mouth (small) */}
      <circle cx="15" cy="16.5" r="0.8" fill="#333" opacity="0.5" />

      {/* Body */}
      <path
        d="M10 20 L8 34 L22 34 L20 20Z"
        fill="currentColor"
        stroke="#333"
        strokeWidth="1"
        strokeLinejoin="round"
      />

      {/* Pen (right hand) — angled writing pose */}
      <line
        x1="22"
        y1="24"
        x2="27"
        y2="16"
        stroke="#333"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="27"
        y1="16"
        x2="28"
        y2="14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="28.2" cy="13.5" r="0.5" fill="#333" />

      {/* Left arm down */}
      <line
        x1="8"
        y1="24"
        x2="5"
        y2="30"
        stroke="#333"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Legs */}
      <line
        x1="12"
        y1="34"
        x2="11"
        y2="41"
        stroke="#333"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="34"
        x2="19"
        y2="41"
        stroke="#333"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Shoes */}
      <ellipse cx="10" cy="41.5" rx="2.5" ry="1.5" fill="#333" />
      <ellipse cx="20" cy="41.5" rx="2.5" ry="1.5" fill="#333" />
    </svg>
  );
}

import type { TeamAvatarProps } from './types';

/**
 * DebaterPro Avatar — Kawaii character raising a sword (offensive stance).
 */
export function DebaterProAvatar({ size, status }: TeamAvatarProps) {
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
      {/* Aggressive eyebrows */}
      <line
        x1="10.5"
        y1="10"
        x2="13.5"
        y2="11"
        stroke="#333"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="16.5"
        y1="11"
        x2="19.5"
        y2="10"
        stroke="#333"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Eyes (intense) */}
      <circle cx="12.5" cy="13" r="1.1" fill="#333" />
      <circle cx="17.5" cy="13" r="1.1" fill="#333" />
      {/* Grin */}
      <path
        d="M12.5 16 Q15 18.5 17.5 16"
        stroke="#333"
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
      />

      {/* Body */}
      <path
        d="M10 20 L8 34 L22 34 L20 20Z"
        fill="currentColor"
        stroke="#333"
        strokeWidth="1"
        strokeLinejoin="round"
      />

      {/* Sword (right hand, raised) */}
      <line
        x1="22"
        y1="22"
        x2="27"
        y2="12"
        stroke="#999"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Sword blade */}
      <line
        x1="27"
        y1="12"
        x2="28"
        y2="5"
        stroke="#CCC"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="27"
        y1="12"
        x2="28"
        y2="5"
        stroke="#FFF"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      {/* Sword guard */}
      <line
        x1="25.5"
        y1="13"
        x2="28.5"
        y2="11.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Left arm */}
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

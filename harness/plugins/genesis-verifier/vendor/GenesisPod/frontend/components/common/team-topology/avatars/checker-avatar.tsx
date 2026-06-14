import type { TeamAvatarProps } from './types';

/**
 * Checker Avatar — Kawaii character with a magnifying glass and small checkmark.
 */
export function CheckerAvatar({ size, status }: TeamAvatarProps) {
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
      {/* Cap */}
      <path
        d="M8 11 Q8 7 15 7 Q22 7 22 11"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.8"
      />
      <line x1="7" y1="11" x2="23" y2="11" stroke="#333" strokeWidth="0.8" />
      {/* Eyes (focused) */}
      <ellipse cx="12.5" cy="13" rx="1" ry="0.7" fill="#333" />
      <ellipse cx="17.5" cy="13" rx="1" ry="0.7" fill="#333" />
      {/* Determined mouth */}
      <path
        d="M13.5 16 L16.5 16"
        stroke="#333"
        strokeWidth="0.8"
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

      {/* Magnifying glass (right hand) — smaller than researcher */}
      <circle
        cx="25"
        cy="21"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="25" cy="21" r="1.8" fill="#E0F2FE" opacity="0.5" />
      <line
        x1="23"
        y1="23.5"
        x2="21.5"
        y2="26"
        stroke="#333"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Small checkmark badge (left shoulder) */}
      <circle
        cx="7"
        cy="22"
        r="2.5"
        fill="#FFF"
        stroke="currentColor"
        strokeWidth="0.8"
      />
      <path
        d="M5.5 22 L6.8 23.5 L8.5 21"
        stroke="currentColor"
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
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

import type { TeamAvatarProps } from './types';

/**
 * Leader Avatar — Kawaii character wearing a crown and holding a baton.
 * Clothes/baton use `currentColor`; skin & outline are fixed.
 */
export function LeaderAvatar({ size, status }: TeamAvatarProps) {
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
      {/* Crown */}
      <path
        d="M8 12 L10 6 L15 10 L20 6 L22 12Z"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.8"
      />
      {/* Crown gems */}
      <circle cx="12" cy="9" r="1" fill="#FFF" opacity="0.6" />
      <circle cx="18" cy="9" r="1" fill="#FFF" opacity="0.6" />

      {/* Head */}
      <circle
        cx="15"
        cy="19"
        r="7"
        fill="#FFD7B5"
        stroke="#333"
        strokeWidth="1"
      />
      {/* Eyes */}
      <circle cx="12.5" cy="18.5" r="1" fill="#333" />
      <circle cx="17.5" cy="18.5" r="1" fill="#333" />
      {/* Mouth */}
      <path
        d="M13 22 Q15 24 17 22"
        stroke="#333"
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
      />

      {/* Body (trapezoid) */}
      <path
        d="M10 26 L8 40 L22 40 L20 26Z"
        fill="currentColor"
        stroke="#333"
        strokeWidth="1"
        strokeLinejoin="round"
      />

      {/* Baton (right hand) */}
      <line
        x1="23"
        y1="28"
        x2="28"
        y2="20"
        stroke="#333"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle
        cx="28"
        cy="19"
        r="1.5"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.6"
      />

      {/* Legs */}
      <line
        x1="12"
        y1="40"
        x2="11"
        y2="47"
        stroke="#333"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="40"
        x2="19"
        y2="47"
        stroke="#333"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Shoes */}
      <ellipse cx="10" cy="47.5" rx="2.5" ry="1.5" fill="#333" />
      <ellipse cx="20" cy="47.5" rx="2.5" ry="1.5" fill="#333" />
    </svg>
  );
}

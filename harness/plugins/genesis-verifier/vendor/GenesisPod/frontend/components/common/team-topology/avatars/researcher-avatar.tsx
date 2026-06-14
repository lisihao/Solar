import type { TeamAvatarProps } from './types';

/**
 * Researcher Avatar — Kawaii character holding a magnifying glass.
 */
export function ResearcherAvatar({ size, status }: TeamAvatarProps) {
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
      {/* Hair tuft */}
      <path
        d="M11 7 Q13 4 15 7 Q17 4 19 7"
        stroke="#333"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />
      {/* Eyes */}
      <circle cx="12.5" cy="12.5" r="1" fill="#333" />
      <circle cx="17.5" cy="12.5" r="1" fill="#333" />
      {/* Mouth */}
      <path
        d="M13.5 16 Q15 17.5 16.5 16"
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

      {/* Magnifying glass (right hand) */}
      <circle
        cx="24"
        cy="18"
        r="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="24" cy="18" r="2.5" fill="#E0F2FE" opacity="0.6" />
      <line
        x1="21.5"
        y1="21.5"
        x2="20"
        y2="25"
        stroke="#333"
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

import type { TeamAvatarProps } from './types';

/**
 * Editor Avatar — Kawaii character holding a paintbrush.
 */
export function EditorAvatar({ size, status }: TeamAvatarProps) {
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
      {/* Short bangs */}
      <path
        d="M9 10 Q12 6 15 9 Q18 6 21 10"
        fill="#333"
        stroke="#333"
        strokeWidth="0.5"
      />
      {/* Eyes */}
      <circle cx="12.5" cy="13" r="1" fill="#333" />
      <circle cx="17.5" cy="13" r="1" fill="#333" />
      {/* Smile */}
      <path
        d="M13 16 Q15 18 17 16"
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

      {/* Paintbrush (right hand) */}
      <line
        x1="22"
        y1="23"
        x2="28"
        y2="15"
        stroke="#8B6914"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Brush tip */}
      <path
        d="M27.5 16 L29 13 L28 12.5"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.5"
      />

      {/* Left arm holding palette hint */}
      <line
        x1="8"
        y1="24"
        x2="5"
        y2="28"
        stroke="#333"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <ellipse
        cx="4.5"
        cy="29"
        rx="2.5"
        ry="2"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.6"
        opacity="0.7"
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

'use client';

interface ViewModeOption {
  key: string;
  label?: string;
  icon: React.ReactNode;
}

interface ViewModeToggleProps {
  modes: ViewModeOption[];
  activeMode: string;
  onModeChange: (mode: string) => void;
}

export function ViewModeToggle({
  modes,
  activeMode,
  onModeChange,
}: ViewModeToggleProps) {
  return (
    <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {modes.map((mode) => (
        <button
          key={mode.key}
          onClick={() => onModeChange(mode.key)}
          className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
            activeMode === mode.key
              ? 'bg-white font-medium text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          title={mode.label}
        >
          {mode.icon}
        </button>
      ))}
    </div>
  );
}

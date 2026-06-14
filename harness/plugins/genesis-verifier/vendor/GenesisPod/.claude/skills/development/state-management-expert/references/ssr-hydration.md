# SSR Hydration Guide

## The Problem

When using Next.js with Zustand's persist middleware, there's a hydration mismatch:

- Server renders with default state
- Client hydrates from localStorage
- Mismatch causes React hydration errors

## Solution 1: Hydration Provider

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/stores/domain/useUserStore';

export function HydrationProvider({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Wait for Zustand stores to hydrate from localStorage
    const unsubscribe = useUserStore.persist.onFinishHydration(() => {
      setIsHydrated(true);
    });

    // If already hydrated
    if (useUserStore.persist.hasHydrated()) {
      setIsHydrated(true);
    }

    return unsubscribe;
  }, []);

  if (!isHydrated) {
    return <LoadingScreen />;
  }

  return children;
}
```

## Solution 2: useHydrated Hook

```typescript
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}

// Usage in component
function ThemeToggle() {
  const hydrated = useHydrated();
  const theme = useUserStore((state) => state.preferences.theme);

  if (!hydrated) {
    return <Skeleton className="w-20 h-8" />;
  }

  return <Button>{theme}</Button>;
}
```

## Solution 3: Skip SSR for Persisted Values

```typescript
function UserPreferences() {
  const hydrated = useHydrated();
  const preferences = useUserStore((state) => state.preferences);

  // Show skeleton during hydration
  if (!hydrated) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ThemeSelector value={preferences.theme} />
      <LanguageSelector value={preferences.language} />
    </div>
  );
}
```

## Solution 4: Suppress Hydration Warning

For non-critical UI elements where mismatch is acceptable:

```tsx
function ThemeIndicator() {
  const theme = useUserStore((state) => state.preferences.theme);

  return <span suppressHydrationWarning>{theme}</span>;
}
```

## Multiple Stores Hydration

```typescript
export function useAllStoresHydrated() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const checkHydration = () => {
      const userHydrated = useUserStore.persist.hasHydrated();
      const settingsHydrated = useSettingsStore.persist.hasHydrated();

      if (userHydrated && settingsHydrated) {
        setHydrated(true);
      }
    };

    // Check immediately
    checkHydration();

    // Subscribe to hydration events
    const unsub1 = useUserStore.persist.onFinishHydration(checkHydration);
    const unsub2 = useSettingsStore.persist.onFinishHydration(checkHydration);

    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  return hydrated;
}
```

## Best Practices

| Scenario                    | Solution                    |
| --------------------------- | --------------------------- |
| Critical UI (theme, layout) | HydrationProvider           |
| Individual components       | useHydrated hook + skeleton |
| Non-critical display        | suppressHydrationWarning    |
| Multiple persisted stores   | Combined hydration check    |

'use client';

import { Globe } from 'lucide-react';
import { useTranslation, type Locale } from '@/lib/i18n';

interface LanguageSwitcherProps {
  variant?: 'icon' | 'full' | 'compact' | 'sidebar';
  className?: string;
}

// Simple toggle between EN and 中文
export default function LanguageSwitcher({
  variant = 'icon',
  className = '',
}: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useTranslation();

  // Toggle between en and zh
  const handleToggle = () => {
    setLocale(locale === 'en' ? 'zh' : 'en');
  };

  // Get display text for the OTHER language (what you'll switch to)
  const nextLang = locale === 'en' ? '中文' : 'EN';

  // Sidebar variant - matches sidebar navigation item style
  if (variant === 'sidebar') {
    return (
      <button
        onClick={handleToggle}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 ${className}`}
        title={t('profile.language')}
      >
        <Globe className="h-5 w-5 flex-shrink-0" />
        <span className="flex-1 text-left">{nextLang}</span>
      </button>
    );
  }

  // Icon only variant (for collapsed sidebar)
  if (variant === 'icon') {
    return (
      <button
        onClick={handleToggle}
        className={`flex h-8 w-full items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 ${className}`}
        title={`${t('profile.language')}: ${nextLang}`}
        aria-label={t('profile.language')}
      >
        <Globe className="h-5 w-5" />
      </button>
    );
  }

  // Compact variant
  if (variant === 'compact') {
    return (
      <button
        onClick={handleToggle}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 ${className}`}
        title={t('profile.language')}
      >
        <Globe className="h-5 w-5 flex-shrink-0" />
        <span className="flex-1 text-left">{nextLang}</span>
      </button>
    );
  }

  // Full variant (shows current language with button style)
  return (
    <button
      onClick={handleToggle}
      className={`flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 ${className}`}
      title={t('profile.language')}
    >
      <Globe className="h-4 w-4" />
      <span>{nextLang}</span>
    </button>
  );
}

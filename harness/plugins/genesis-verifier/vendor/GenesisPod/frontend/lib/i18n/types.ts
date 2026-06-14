/**
 * i18n Types
 */

export type Locale = 'en' | 'zh';

export type TranslationKey = string;

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isLoading: boolean;
}

// Type for nested translation objects
export type TranslationValue = string | { [key: string]: TranslationValue };

export type Translations = {
  [key: string]: TranslationValue;
};

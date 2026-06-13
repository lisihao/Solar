/**
 * i18n - Internationalization System
 *
 * A lightweight i18n solution for Next.js 14 App Router
 * Supports: English (default), Chinese
 *
 * Usage:
 *   import { useTranslation } from '@/lib/i18n';
 *   const { t, locale, setLocale } = useTranslation();
 *   <p>{t('common.save')}</p>
 */

export { I18nProvider, useI18n, useTranslation } from './i18n-context';
export type { Locale, TranslationKey } from './types';

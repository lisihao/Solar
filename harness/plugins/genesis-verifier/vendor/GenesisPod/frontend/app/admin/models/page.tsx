'use client';

import { redirect } from 'next/navigation';

/**
 * Redirect legacy /admin/models → /admin/ai/models
 */
export default function AdminModelsRedirect() {
  redirect('/admin/ai/models');
}

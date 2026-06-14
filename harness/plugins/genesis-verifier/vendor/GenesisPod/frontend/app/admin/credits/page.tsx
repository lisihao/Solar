'use client';

import { redirect } from 'next/navigation';

/**
 * Redirect legacy /admin/credits → /admin/access/credits
 */
export default function AdminCreditsRedirect() {
  redirect('/admin/access/credits');
}

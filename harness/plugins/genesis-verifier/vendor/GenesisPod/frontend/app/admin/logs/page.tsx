'use client';

import { redirect } from 'next/navigation';

/**
 * Redirect legacy /admin/logs → /admin/system/logs
 */
export default function AdminLogsRedirect() {
  redirect('/admin/system/logs');
}

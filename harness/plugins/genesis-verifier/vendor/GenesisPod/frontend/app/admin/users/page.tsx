'use client';

import { redirect } from 'next/navigation';

/**
 * Redirect legacy /admin/users → /admin/access/users
 */
export default function AdminUsersRedirect() {
  redirect('/admin/access/users');
}

import { redirect } from 'next/navigation';

/**
 * 已并入用户管理（Wave 4A, 2026-05-11）。
 * 计费明细现在以用户表行内 [计费] 按钮形式提供。
 *
 * 旧 URL 保留为 redirect，避免破坏外链与书签。
 */
export default function BillingPageRedirect() {
  redirect('/admin/access/users?from=billing');
}

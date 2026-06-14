import { redirect } from 'next/navigation';

/**
 * 已并入密钥管理（Wave 4B, 2026-05-11）。
 * 密钥申请审批现在以 /admin/access/secrets 页面的 [申请] Tab 提供。
 *
 * 旧 URL 保留为 redirect，避免破坏外链与书签。
 */
export default function KeyRequestsPageRedirect() {
  redirect('/admin/access/secrets?tab=requests&from=key-requests');
}

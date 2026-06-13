import { redirect } from 'next/navigation';

/**
 * 已并入用户管理（Wave 4A, 2026-05-11）。
 * 原"管理员晋升/降级"功能现在以用户表行内 [权限] 按钮的形式提供。
 *
 * 旧 URL 保留为 redirect，避免破坏外链与书签。
 */
export default function PermissionsPageRedirect() {
  redirect('/admin/access/users?from=permissions');
}

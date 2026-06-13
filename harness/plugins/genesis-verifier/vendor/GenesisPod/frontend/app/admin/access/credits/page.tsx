import { redirect } from 'next/navigation';

/**
 * 已并入用户管理（Wave 4A, 2026-05-11）。
 * 账户余额 / 发放 / 冻结 / 交易记录现在以用户表行内 [积分] 按钮形式提供。
 * CreditRule 全局配置规则保留在用户管理页顶部 actions。
 *
 * 旧 URL 保留为 redirect，避免破坏外链与书签。
 */
export default function CreditsPageRedirect() {
  redirect('/admin/access/users?from=credits');
}

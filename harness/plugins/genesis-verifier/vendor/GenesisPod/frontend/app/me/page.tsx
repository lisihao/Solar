import { redirect } from 'next/navigation';

/**
 * /me → /me/account。旧 4 卡片 hub 由整页左导航个人中心取代（设计 §4）。
 */
export default function MePage() {
  redirect('/me/account');
}

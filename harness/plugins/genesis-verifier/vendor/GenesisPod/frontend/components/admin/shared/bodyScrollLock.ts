/**
 * Body scroll lock with module-level counter
 *
 * 解决 AdminModal / AdminDrawer 嵌套场景的 scroll lock 错乱问题：
 * 当一个 dialog 打开嵌套另一个 dialog，内层关闭时不能把外层的 overflow:hidden
 * 恢复成 ''（原始值是内层 mount 时已经被外层改成 'hidden' 的状态）。
 *
 * 计数器保证只有 lockCount === 0 → 1 时才存储原始 overflow，
 * 只有 lockCount → 0 时才恢复。
 */

let lockCount = 0;
let originalOverflow: string | null = null;

export function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount++;
}

export function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) return; // defensive
  lockCount--;
  if (lockCount === 0) {
    document.body.style.overflow = originalOverflow ?? '';
    originalOverflow = null;
  }
}

/** Test helper — reset counter between tests. Do NOT call in app code. */
export function __resetBodyScrollLock(): void {
  lockCount = 0;
  originalOverflow = null;
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
}

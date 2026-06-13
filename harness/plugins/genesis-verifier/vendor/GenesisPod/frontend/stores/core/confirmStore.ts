import { create } from 'zustand';

export type ConfirmType = 'danger' | 'warning' | 'info' | 'success';

export interface ConfirmOptions {
  title: string;
  description?: string;
  type?: ConfirmType;
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  current: ConfirmRequest | null;
  request: (opts: ConfirmOptions) => Promise<boolean>;
  close: (ok: boolean) => void;
}

/**
 * 全局确认弹窗 store（镜像 toastStore 的命令式模式）。
 * 配套 <ConfirmDialogContainer/>（已在 providers 挂载）+ 命令式 `confirm()`。
 * 取代散落的原生 window.confirm()——后者无障碍差、无法主题化、阻塞主线程。
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,

  request: (opts) =>
    new Promise<boolean>((resolve) => {
      // 已有未决请求 → 旧的按取消处理，避免悬挂 promise
      const prev = get().current;
      if (prev) prev.resolve(false);
      set({ current: { ...opts, resolve } });
    }),

  close: (ok) => {
    const cur = get().current;
    if (cur) cur.resolve(ok);
    set({ current: null });
  },
}));

/**
 * 命令式确认弹窗：`const ok = await confirm({ title, description, type: 'danger' })`
 * 返回 Promise<boolean>——用户点「确认」resolve(true)，取消/关闭 resolve(false)。
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(options);
}

'use client';

/**
 * SecretComboBox —— 可见按钮触发的下拉 + 自由输入组合框。
 *
 * 之前用 <datalist> 用户截图反馈"根本没有下拉框"：datalist 必须 focus + 打字
 * 才浮，点击没反应，看起来跟普通输入框一样。本组件用 button + 受控 popover：
 *  - 输入框：随便输（手输新名称走这里）
 *  - 右侧 ▼ 按钮：点击立刻展开候选列表
 *  - 候选列表：高亮当前匹配项，键盘 ↑↓ Enter 也可选
 *  - 列表项点击：填入输入框 + 关闭
 *  - 点击外面：关闭
 *
 * 候选数据由父组件传 `suggestions`，本组件不拉接口（数据源 / UI 分离）。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Loader2 } from 'lucide-react';

interface SecretComboBoxProps {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  loading?: boolean;
  placeholder?: string;
  inputName: string;
}

export function SecretComboBox({
  value,
  onChange,
  suggestions,
  loading,
  placeholder,
  inputName,
}: SecretComboBoxProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filtered = (() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter((s) => s.toLowerCase().includes(q));
  })();

  return (
    <div ref={rootRef} className="relative flex-1">
      <div className="flex items-stretch">
        <input
          type="search"
          name={inputName}
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore="true"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="font-mono w-full rounded-l-lg border border-r-0 border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center justify-center rounded-r-lg border border-gray-300 bg-gray-50 px-2 text-gray-600 hover:bg-gray-100"
          aria-label="展开秘钥列表"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${
                open ? 'rotate-180' : ''
              }`}
            />
          )}
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-gray-500">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-gray-500">
              {suggestions.length === 0
                ? '暂无可选秘钥；可在 Secret Manager 先创建，或直接手输新名称'
                : `没有匹配 "${value}" 的秘钥；可手输新名称`}
            </div>
          ) : (
            filtered.map((s) => {
              const selected = s === value;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                  className={`font-mono flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-blue-50 ${
                    selected ? 'bg-blue-50 text-blue-700' : 'text-gray-800'
                  }`}
                >
                  <span className="truncate">{s}</span>
                  {selected && (
                    <Check className="ml-2 h-3.5 w-3.5 text-blue-600" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

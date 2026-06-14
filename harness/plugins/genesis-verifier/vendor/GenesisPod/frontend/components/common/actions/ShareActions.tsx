'use client';

import { useState, useRef, useEffect } from 'react';
import { Star, StarOff, Mail, Link2, MoreHorizontal } from 'lucide-react';
import { CopyButton } from '@/components/ui/primitives/CopyButton';

interface ShareActionsProps {
  title: string;
  summary: string;
  detailUrl: string;
  onFavorite?: () => Promise<void>;
  isFavorited?: boolean;
  onCopySuccess?: () => void;
  className?: string;
}

export function ShareActions({
  title,
  summary,
  detailUrl,
  onFavorite,
  isFavorited = false,
  onCopySuccess,
  className,
}: ShareActionsProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const handleEmail = () => {
    const body = encodeURIComponent(`${summary}\n\n${detailUrl}`);
    const subject = encodeURIComponent(title);
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const handleCopyLink = async () => {
    const text = `${title}\n\n${summary}\n\n${detailUrl}`;
    await navigator.clipboard.writeText(text);
    onCopySuccess?.();
  };

  const handleFavorite = () => {
    if (onFavorite) void onFavorite();
  };

  return (
    <div className={className}>
      {/* md+: flat three-button row */}
      <div className="hidden items-center gap-2 md:flex">
        {onFavorite && (
          <button
            onClick={handleFavorite}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            aria-label={isFavorited ? 'unfavorite' : 'favorite'}
          >
            {isFavorited ? (
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            ) : (
              <StarOff className="h-4 w-4" />
            )}
            收藏
          </button>
        )}
        <button
          onClick={handleEmail}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          aria-label="email share"
        >
          <Mail className="h-4 w-4" />
          转发邮件
        </button>
        <CopyButton
          value={`${title}\n\n${summary}\n\n${detailUrl}`}
          label="复制链接"
          onCopied={onCopySuccess}
        />
      </div>

      {/* sm: collapsed dropdown */}
      <div ref={ref} className="relative flex md:hidden">
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          aria-label="share actions"
          aria-haspopup="true"
          aria-expanded={dropdownOpen}
        >
          <MoreHorizontal className="h-4 w-4" />
          分享
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 z-20 mt-9 min-w-[140px] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            {onFavorite && (
              <button
                onClick={() => {
                  handleFavorite();
                  setDropdownOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {isFavorited ? (
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                ) : (
                  <StarOff className="h-4 w-4" />
                )}
                收藏
              </button>
            )}
            <button
              onClick={() => {
                handleEmail();
                setDropdownOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Mail className="h-4 w-4" />
              转发邮件
            </button>
            <button
              onClick={() => {
                void handleCopyLink();
                setDropdownOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Link2 className="h-4 w-4" />
              复制链接
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

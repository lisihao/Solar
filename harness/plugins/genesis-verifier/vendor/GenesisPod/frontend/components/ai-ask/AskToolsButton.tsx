'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Wrench, ImageIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n/i18n-context';

export default function AskToolsButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left,
      });
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const tools = [
    {
      id: 'image',
      icon: ImageIcon,
      label: t('aiAsk.tools.image'),
      description: t('aiAsk.tools.image.description'),
      onClick: () => {
        setIsOpen(false);
        router.push('/ai-image/create');
      },
    },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
          isOpen
            ? 'bg-gray-200 text-gray-700'
            : 'text-gray-500 hover:bg-gray-100'
        }`}
        title={t('aiAsk.tools')}
        aria-label={t('aiAsk.tools')}
      >
        <Wrench className="h-4 w-4" />
        <span className="whitespace-nowrap">{t('aiAsk.tools')}</span>
      </button>

      {isOpen &&
        mounted &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[9999] w-56 -translate-y-full rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
            style={{ top: position.top, left: position.left }}
          >
            <div className="mb-1 px-2 py-1 text-xs font-medium text-gray-400">
              {t('aiAsk.tools')}
            </div>
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={tool.onClick}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pink-50 text-pink-500">
                  <tool.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-700">
                    {tool.label}
                  </div>
                  <div className="text-xs text-gray-400">
                    {tool.description}
                  </div>
                </div>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

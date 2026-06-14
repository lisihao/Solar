'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Link2, FileUp, X } from 'lucide-react';

interface ImportSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUrl: () => void;
  onSelectFile: () => void;
  anchorEl?: HTMLElement | null;
}

export function ImportSelector({
  isOpen,
  onClose,
  onSelectUrl,
  onSelectFile,
  anchorEl,
}: ImportSelectorProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Menu */}
      <div
        ref={menuRef}
        className="absolute z-50 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        style={{
          top: anchorEl ? anchorEl.getBoundingClientRect().bottom + 8 : '50%',
          left: anchorEl ? anchorEl.getBoundingClientRect().left : '50%',
          transform: anchorEl ? 'none' : 'translate(-50%, -50%)',
        }}
      >
        {/* Header */}
        <div className="border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              Import Resource
            </h3>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/50 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">Choose import method</p>
        </div>

        {/* Options */}
        <div className="p-2">
          {/* URL Option */}
          <button
            onClick={() => {
              onSelectUrl();
              onClose();
            }}
            className="group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-all hover:bg-blue-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 transition-colors group-hover:bg-blue-200">
              <Link2 size={20} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">From URL</p>
              <p className="text-xs text-gray-500">Import from a web link</p>
            </div>
            <svg
              className="h-5 w-5 text-gray-300 transition-colors group-hover:text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>

          {/* File Option */}
          <button
            onClick={() => {
              onSelectFile();
              onClose();
            }}
            className="group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-all hover:bg-green-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 transition-colors group-hover:bg-green-200">
              <FileUp size={20} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Upload File</p>
              <p className="text-xs text-gray-500">PDF, HTML documents</p>
            </div>
            <svg
              className="h-5 w-5 text-gray-300 transition-colors group-hover:text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        {/* Footer hint */}
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
          <p className="text-center text-xs text-gray-400">
            Supported: PDF, HTML • Max 50MB
          </p>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { X, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { CopyButton } from '@/components/ui/primitives/CopyButton';

interface SecretValueModalProps {
  secretName: string;
  displayName: string;
  onClose: () => void;
  getSecretValue: (name: string) => Promise<string | null>;
}

export function SecretValueModal({
  secretName,
  displayName,
  onClose,
  getSecretValue,
}: SecretValueModalProps) {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [autoHideTimer, setAutoHideTimer] = useState<number>(30);

  // Fetch secret value on mount
  useEffect(() => {
    const fetchValue = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getSecretValue(secretName);
        if (result) {
          setValue(result);
        } else {
          setError('Failed to fetch secret value');
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to fetch secret value'
        );
      } finally {
        setLoading(false);
      }
    };
    fetchValue();
  }, [secretName, getSecretValue]);

  // Auto-hide countdown when revealed
  useEffect(() => {
    if (!revealed || !value) return;

    const interval = setInterval(() => {
      setAutoHideTimer((prev) => {
        if (prev <= 1) {
          setRevealed(false);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [revealed, value]);

  // Reset timer when hiding
  useEffect(() => {
    if (!revealed) {
      setAutoHideTimer(30);
    }
  }, [revealed]);

  const handleAutoClearClipboard = (copiedValue: string) => {
    // Auto-clear clipboard after 30 seconds for security
    setTimeout(async () => {
      try {
        const currentClipboard = await navigator.clipboard.readText();
        if (currentClipboard === copiedValue) {
          await navigator.clipboard.writeText('');
        }
      } catch {
        // Clipboard access denied, ignore
      }
    }, 30000);
  };

  const maskValue = (val: string) => {
    if (val.length <= 8) return '*'.repeat(val.length);
    return (
      val.slice(0, 4) + '*'.repeat(Math.min(val.length - 8, 20)) + val.slice(-4)
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl ">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 ">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 ">
              Secret Value
            </h3>
            <p className="text-sm text-gray-500 ">{displayName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-gray-100 "
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 ">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <span className="text-red-700 ">{error}</span>
            </div>
          ) : value ? (
            <div className="space-y-4">
              {/* Value display */}
              <div className="relative">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 ">
                  <code className="font-mono block break-all text-sm text-gray-900 ">
                    {revealed ? value : maskValue(value)}
                  </code>
                </div>

                {/* Reveal timer indicator */}
                {revealed && (
                  <div className="absolute right-2 top-2 rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-700 ">
                    Auto-hide in {autoHideTimer}s
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setRevealed(!revealed)}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 "
                >
                  {revealed ? (
                    <>
                      <EyeOff className="h-4 w-4" />
                      Hide
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" />
                      Reveal
                    </>
                  )}
                </button>

                <CopyButton
                  value={value}
                  label="Copy to Clipboard"
                  copiedLabel="Copied!"
                  onCopied={() => handleAutoClearClipboard(value)}
                  className="rounded-lg border-0 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                />
              </div>

              {/* Security notice */}
              <p className="text-xs text-gray-500 ">
                Clipboard will be automatically cleared after 30 seconds for
                security.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

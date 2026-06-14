'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Zap, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils/common';

export interface TestResult {
  success: boolean;
  message?: string;
  latency?: number;
}

interface ConnectionTestButtonProps {
  testFn: () => Promise<TestResult>;
  label?: string;
  onResult?: (result: TestResult) => void;
  className?: string;
  variant?: 'default' | 'compact' | 'icon';
  showLatency?: boolean;
}

export default function ConnectionTestButton({
  testFn,
  label = 'Test Connection',
  onResult,
  className,
  variant = 'default',
  showLatency = true,
}: ConnectionTestButtonProps) {
  const [status, setStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle');
  const [result, setResult] = useState<TestResult | null>(null);

  const handleTest = async () => {
    setStatus('testing');
    setResult(null);

    const startTime = Date.now();
    try {
      const testResult = await testFn();
      const latency = testResult.latency ?? Date.now() - startTime;
      const finalResult = { ...testResult, latency };

      setResult(finalResult);
      setStatus(testResult.success ? 'success' : 'error');
      onResult?.(finalResult);

      // Reset to idle after 5 seconds
      setTimeout(() => {
        setStatus('idle');
      }, 5000);
    } catch (error) {
      const errorResult: TestResult = {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        latency: Date.now() - startTime,
      };
      setResult(errorResult);
      setStatus('error');
      onResult?.(errorResult);

      setTimeout(() => {
        setStatus('idle');
      }, 5000);
    }
  };

  if (variant === 'icon') {
    return (
      <button
        onClick={handleTest}
        disabled={status === 'testing'}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
          status === 'idle' &&
            'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
          status === 'testing' && 'text-blue-500',
          status === 'success' && 'text-green-500',
          status === 'error' && 'text-red-500',
          className
        )}
        title={label}
      >
        {status === 'testing' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : status === 'success' ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : status === 'error' ? (
          <XCircle className="h-4 w-4" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
      </button>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={handleTest}
        disabled={status === 'testing'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          status === 'idle' && 'bg-gray-100 text-gray-600 hover:bg-gray-200',
          status === 'testing' && 'bg-blue-100 text-blue-700',
          status === 'success' && 'bg-green-100 text-green-700',
          status === 'error' && 'bg-red-100 text-red-700',
          className
        )}
      >
        {status === 'testing' ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Testing...
          </>
        ) : status === 'success' ? (
          <>
            <CheckCircle2 className="h-3 w-3" />
            OK{showLatency && result?.latency && ` (${result.latency}ms)`}
          </>
        ) : status === 'error' ? (
          <>
            <XCircle className="h-3 w-3" />
            Failed
          </>
        ) : (
          <>
            <Zap className="h-3 w-3" />
            Test
          </>
        )}
      </button>
    );
  }

  // Default variant
  return (
    <div className={cn('space-y-2', className)}>
      <button
        onClick={handleTest}
        disabled={status === 'testing'}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
          status === 'idle' && 'bg-gray-100 text-gray-700 hover:bg-gray-200',
          status === 'testing' && 'bg-blue-100 text-blue-700',
          status === 'success' && 'bg-green-100 text-green-700',
          status === 'error' && 'bg-red-100 text-red-700',
          status === 'testing' && 'cursor-not-allowed'
        )}
      >
        {status === 'testing' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Testing connection...
          </>
        ) : status === 'success' ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Connection successful
            {showLatency && result?.latency && (
              <span className="text-green-600">({result.latency}ms)</span>
            )}
          </>
        ) : status === 'error' ? (
          <>
            <XCircle className="h-4 w-4" />
            Connection failed
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4" />
            {label}
          </>
        )}
      </button>

      {/* Error message */}
      {status === 'error' && result?.message && (
        <p className="text-sm text-red-600">{result.message}</p>
      )}
    </div>
  );
}

// Utility function to create test functions for common scenarios
export function createApiTestFn(
  endpoint: string,
  options?: RequestInit
): () => Promise<TestResult> {
  return async () => {
    const startTime = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        ...options,
      });
      const latency = Date.now() - startTime;

      if (response.ok) {
        return { success: true, latency };
      } else {
        return {
          success: false,
          message: `HTTP ${response.status}: ${response.statusText}`,
          latency,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Network error',
        latency: Date.now() - startTime,
      };
    }
  };
}

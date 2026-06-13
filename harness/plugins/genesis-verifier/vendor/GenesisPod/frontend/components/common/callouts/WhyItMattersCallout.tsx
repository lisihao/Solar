'use client';

import { ReactNode } from 'react';

interface WhyItMattersCalloutProps {
  children: ReactNode;
  className?: string;
}

export function WhyItMattersCallout({
  children,
  className,
}: WhyItMattersCalloutProps) {
  if (children == null) return null;

  return (
    <div
      className={`border-l-4 border-violet-500 bg-violet-50 p-3 md:p-4 ${className ?? ''}`}
      role="note"
    >
      {children}
    </div>
  );
}

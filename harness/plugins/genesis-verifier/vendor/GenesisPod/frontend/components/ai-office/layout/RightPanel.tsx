'use client';

/**
 * 右侧文档编辑器面板
 * 简洁容器，所有功能由DocumentEditor组件负责
 */

import React from 'react';
import DocumentEditor from '../document/DocumentEditor';

interface RightPanelProps {
  children?: React.ReactNode;
}

export default function RightPanel({ children }: RightPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden">
      <DocumentEditor />
    </div>
  );
}

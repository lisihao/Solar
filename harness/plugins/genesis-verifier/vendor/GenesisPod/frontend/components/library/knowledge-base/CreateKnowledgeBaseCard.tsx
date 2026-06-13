'use client';

import { CreateCard } from '@/components/ui/cards/CreateCard';

interface CreateKnowledgeBaseCardProps {
  title: string;
  description: string;
  onClick: () => void;
}

/**
 * 网格首格的"新建"占位卡（虚线 → hover 实化）
 * 薄包装 CreateCard，保留原有对外签名不变。
 */
export default function CreateKnowledgeBaseCard({
  title,
  description,
  onClick,
}: CreateKnowledgeBaseCardProps) {
  return (
    <CreateCard title={title} description={description} onClick={onClick} />
  );
}

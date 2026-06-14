/**
 * AssetCard 内置图标
 * 使用 Lucide React（项目规范禁止 emoji，统一用 Lucide）
 */

import { Edit3, Globe, Lock, Share2, Trash2 } from 'lucide-react';

export const AssetEditIcon = ({ className }: { className?: string }) => (
  <Edit3 className={className} />
);

export const AssetDeleteIcon = ({ className }: { className?: string }) => (
  <Trash2 className={className} />
);

export const AssetShareIcon = ({ className }: { className?: string }) => (
  <Share2 className={className} />
);

export const AssetLockIcon = ({ className }: { className?: string }) => (
  <Lock className={className} />
);

export const AssetGlobeIcon = ({ className }: { className?: string }) => (
  <Globe className={className} />
);

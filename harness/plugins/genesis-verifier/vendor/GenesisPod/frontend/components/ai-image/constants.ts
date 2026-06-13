// Constants for AI Image Generator

export const SUPPORTED_FILE_TYPES = [
  'text/plain',
  'text/markdown',
  'text/html',
  'application/json',
  'application/pdf',
  'text/vtt',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export const SUPPORTED_FILE_EXTENSIONS = [
  '.txt',
  '.md',
  '.html',
  '.json',
  '.pdf',
  '.srt',
  '.vtt',
];

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3'] as const;

export const TEMPLATE_LAYOUTS = [
  'auto',
  'cards',
  'center_visual',
  'timeline',
  'comparison',
  'pyramid',
  'radial',
  'statistics',
  'checklist',
  'funnel',
  'matrix',
  'ranking',
] as const;

export const TEMPLATE_CAPACITY: Record<string, { max: number; type: string }> =
  {
    statistics: { max: 12, type: '指标' },
    cards: { max: 15, type: '卡片' },
    auto: { max: 15, type: '卡片' },
    timeline: { max: 5, type: '阶段' },
    ranking: { max: 15, type: '排名项' },
  };

export const FILE_ACCEPT_STRING = '.txt,.md,.html,.json,.pdf,.srt,.vtt,image/*';

export const ASPECT_RATIO_STORAGE_KEY = 'ai-image-aspect-ratio';
export const STYLE_STORAGE_KEY = 'ai-image-style';

/**
 * Image style options for generation
 */
export const IMAGE_STYLES = [
  { value: '', label: 'Auto (自动)' },
  // 写实类
  { value: 'realistic', label: '📷 Realistic (照片写实)' },
  { value: 'cinematic', label: '🎬 Cinematic (电影风格)' },
  { value: 'portrait', label: '👤 Portrait (人像摄影)' },
  // 艺术类
  { value: 'artistic', label: '🎨 Artistic (艺术绘画)' },
  { value: 'watercolor', label: '💧 Watercolor (水彩)' },
  { value: 'oil-painting', label: '🖼️ Oil Painting (油画)' },
  { value: 'impressionist', label: '🌸 Impressionist (印象派)' },
  // 数字艺术
  { value: 'anime', label: '✨ Anime (动漫)' },
  { value: '3d', label: '🎮 3D Render (3D渲染)' },
  { value: 'digital-art', label: '💻 Digital Art (数字艺术)' },
  { value: 'pixel-art', label: '👾 Pixel Art (像素风)' },
  // 素描类
  { value: 'sketch', label: '✏️ Sketch (素描)' },
  { value: 'ink-wash', label: '🖌️ Ink Wash (水墨)' },
  { value: 'lineart', label: '📐 Line Art (线稿)' },
  // 特殊风格
  { value: 'minimalist', label: '⬜ Minimalist (极简)' },
  { value: 'vintage', label: '📻 Vintage (复古)' },
  { value: 'fantasy', label: '🧙 Fantasy (奇幻)' },
  { value: 'sci-fi', label: '🚀 Sci-Fi (科幻)' },
] as const;

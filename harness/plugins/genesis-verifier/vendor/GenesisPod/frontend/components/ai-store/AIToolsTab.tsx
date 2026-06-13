'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  Sparkles,
  MessageSquare,
  Palette,
  Film,
  Code,
  PenTool,
  BarChart3,
  Zap,
  Star,
  Search,
  Bot,
  Brain,
  ImageIcon,
  Monitor,
  Keyboard,
  FileText,
  Wand2,
  Video,
  Mic,
  Globe,
  Presentation,
  Gem,
  Theater,
  Wrench,
  Music,
  type LucideIcon,
} from 'lucide-react';

// Category icon mapping
const categoryIcons: Record<string, LucideIcon> = {
  all: Sparkles,
  chat: MessageSquare,
  image: Palette,
  video: Film,
  code: Code,
  writing: PenTool,
  data: BarChart3,
  productivity: Zap,
};

// Tool icon mapping
const toolIcons: Record<string, LucideIcon> = {
  '1': Bot,
  '2': Brain,
  '3': Palette,
  '4': ImageIcon,
  '5': Monitor,
  '6': Keyboard,
  '7': FileText,
  '8': Wand2,
  '9': Video,
  '10': Mic,
  '11': Search,
  '12': Presentation,
  '13': Gem,
  '14': Theater,
  '15': Wrench,
  '16': Music,
};

function ToolIcon({
  toolId,
  className,
}: {
  toolId: string;
  className?: string;
}) {
  const Icon = toolIcons[toolId] || Bot;
  return <Icon className={className} />;
}

function CategoryIcon({
  categoryId,
  className,
}: {
  categoryId: string;
  className?: string;
}) {
  const Icon = categoryIcons[categoryId] || Sparkles;
  return <Icon className={className} />;
}

// AI工具分类
const categories = [
  { id: 'all', color: 'bg-gray-100' },
  { id: 'chat', color: 'bg-blue-100' },
  { id: 'image', color: 'bg-purple-100' },
  { id: 'video', color: 'bg-pink-100' },
  { id: 'code', color: 'bg-green-100' },
  { id: 'writing', color: 'bg-amber-100' },
  { id: 'data', color: 'bg-cyan-100' },
  { id: 'productivity', color: 'bg-orange-100' },
];

// AI工具数据
const aiTools = [
  {
    id: '1',
    name: 'ChatGPT',
    description: 'OpenAI的对话式AI助手，支持多轮对话、代码生成、文本创作',
    category: 'chat',
    rating: 4.9,
    users: '100M+',
    tags: ['对话', 'GPT-4', '免费试用'],
    featured: true,
    url: 'https://chat.openai.com',
    pricing: 'Freemium',
  },
  {
    id: '2',
    name: 'Claude',
    description: 'Anthropic的AI助手，擅长长文本理解、代码分析、创意写作',
    category: 'chat',
    rating: 4.8,
    users: '50M+',
    tags: ['对话', 'Claude 3.5', '长上下文'],
    featured: true,
    url: 'https://claude.ai',
    pricing: 'Freemium',
  },
  {
    id: '3',
    name: 'Midjourney',
    description: '顶级AI图像生成工具，创造惊艳的艺术作品和设计',
    category: 'image',
    rating: 4.9,
    users: '16M+',
    tags: ['图像生成', '艺术', 'Discord'],
    featured: true,
    url: 'https://midjourney.com',
    pricing: 'Paid',
  },
  {
    id: '4',
    name: 'DALL-E 3',
    description: 'OpenAI的文本到图像生成模型，支持精确的提示词控制',
    category: 'image',
    rating: 4.7,
    users: '10M+',
    tags: ['图像生成', 'OpenAI', 'ChatGPT集成'],
    featured: false,
    url: 'https://openai.com/dall-e-3',
    pricing: 'Paid',
  },
  {
    id: '5',
    name: 'GitHub Copilot',
    description: 'AI代码助手，实时代码补全和建议，支持多种编程语言',
    category: 'code',
    rating: 4.8,
    users: '1.8M+',
    tags: ['代码补全', 'IDE集成', 'GPT-4'],
    featured: true,
    url: 'https://github.com/features/copilot',
    pricing: 'Paid',
  },
  {
    id: '6',
    name: 'Cursor',
    description: 'AI原生代码编辑器，将AI深度集成到编码工作流中',
    category: 'code',
    rating: 4.7,
    users: '500K+',
    tags: ['代码编辑器', 'AI原生', 'VSCode兼容'],
    featured: false,
    url: 'https://cursor.sh',
    pricing: 'Freemium',
  },
  {
    id: '7',
    name: 'Notion AI',
    description: '在Notion中使用AI辅助写作、总结、翻译和头脑风暴',
    category: 'writing',
    rating: 4.6,
    users: '30M+',
    tags: ['写作助手', 'Notion', '团队协作'],
    featured: false,
    url: 'https://notion.so/product/ai',
    pricing: 'Paid',
  },
  {
    id: '8',
    name: 'Jasper',
    description: '企业级AI内容创作平台，支持营销文案、博客、社媒内容',
    category: 'writing',
    rating: 4.5,
    users: '100K+',
    tags: ['营销内容', '企业级', '模板'],
    featured: false,
    url: 'https://jasper.ai',
    pricing: 'Paid',
  },
  {
    id: '9',
    name: 'Runway',
    description: '专业AI视频生成和编辑工具，支持文本到视频、图像到视频',
    category: 'video',
    rating: 4.7,
    users: '2M+',
    tags: ['视频生成', 'Gen-2', '专业级'],
    featured: true,
    url: 'https://runway.ml',
    pricing: 'Freemium',
  },
  {
    id: '10',
    name: 'ElevenLabs',
    description: '最自然的AI语音合成，支持多语言、声音克隆',
    category: 'video',
    rating: 4.8,
    users: '1M+',
    tags: ['语音合成', 'TTS', '声音克隆'],
    featured: false,
    url: 'https://elevenlabs.io',
    pricing: 'Freemium',
  },
  {
    id: '11',
    name: 'Perplexity',
    description: 'AI搜索引擎，实时联网搜索并给出引用来源的答案',
    category: 'data',
    rating: 4.7,
    users: '10M+',
    tags: ['AI搜索', '实时联网', '引用来源'],
    featured: true,
    url: 'https://perplexity.ai',
    pricing: 'Freemium',
  },
  {
    id: '12',
    name: 'Gamma',
    description: 'AI生成演示文稿、文档和网页，一键创建专业内容',
    category: 'productivity',
    rating: 4.6,
    users: '5M+',
    tags: ['PPT生成', '文档', '一键创建'],
    featured: false,
    url: 'https://gamma.app',
    pricing: 'Freemium',
  },
  {
    id: '13',
    name: 'Gemini',
    description: 'Google的多模态AI助手，支持文本、图像、代码理解',
    category: 'chat',
    rating: 4.6,
    users: '50M+',
    tags: ['Google', '多模态', '免费'],
    featured: false,
    url: 'https://gemini.google.com',
    pricing: 'Freemium',
  },
  {
    id: '14',
    name: 'Stable Diffusion',
    description: '开源图像生成模型，可本地部署，高度可定制',
    category: 'image',
    rating: 4.6,
    users: '10M+',
    tags: ['开源', '本地部署', '可定制'],
    featured: false,
    url: 'https://stability.ai',
    pricing: 'Free',
  },
  {
    id: '15',
    name: 'Dify',
    description: '开源LLM应用开发平台，快速构建AI应用和Agent',
    category: 'code',
    rating: 4.5,
    users: '100K+',
    tags: ['开源', 'LLM平台', 'Agent'],
    featured: false,
    url: 'https://dify.ai',
    pricing: 'Freemium',
  },
  {
    id: '16',
    name: 'Suno',
    description: 'AI音乐生成，用文字描述创作完整歌曲',
    category: 'video',
    rating: 4.7,
    users: '5M+',
    tags: ['音乐生成', '歌曲创作', '免费'],
    featured: false,
    url: 'https://suno.ai',
    pricing: 'Freemium',
  },
];

export default function AIToolsTab() {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'rating' | 'users' | 'name'>('rating');

  // 过滤和排序工具
  const filteredTools = aiTools
    .filter((tool) => {
      const matchesCategory =
        selectedCategory === 'all' || tool.category === selectedCategory;
      const matchesSearch =
        tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tool.tags.some((tag) =>
          tag.toLowerCase().includes(searchQuery.toLowerCase())
        );
      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'rating') return b.rating - a.rating;
      if (sortBy === 'users') {
        const parseUsers = (u: string) =>
          parseFloat(u.replace(/[^0-9.]/g, '')) *
          (u.includes('M') ? 1000000 : u.includes('K') ? 1000 : 1);
        return parseUsers(b.users) - parseUsers(a.users);
      }
      return a.name.localeCompare(b.name);
    });

  const featuredTools = aiTools.filter((tool) => tool.featured);

  return (
    <div className="px-8 py-6">
      {/* Search Bar */}
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t('aiStore.search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) =>
            setSortBy(e.target.value as 'rating' | 'users' | 'name')
          }
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
        >
          <option value="rating">{t('aiStore.sort.byRating')}</option>
          <option value="users">{t('aiStore.sort.byUsers')}</option>
          <option value="name">{t('aiStore.sort.byName')}</option>
        </select>
      </div>

      {/* Featured Section */}
      {selectedCategory === 'all' && !searchQuery && (
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Star className="h-5 w-5 text-amber-400" /> {t('aiStore.featured')}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {featuredTools.slice(0, 6).map((tool) => (
              <a
                key={tool.id}
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="absolute right-3 top-3">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {t('aiStore.featuredBadge')}
                  </span>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-gray-50 to-gray-100">
                    <ToolIcon
                      toolId={tool.id}
                      className="h-6 w-6 text-gray-600"
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 group-hover:text-cyan-600">
                      {tool.name}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                      {tool.description}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      {tool.rating}
                    </span>
                    <span>
                      {tool.users} {t('aiStore.users')}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      tool.pricing === 'Free'
                        ? 'bg-green-100 text-green-700'
                        : tool.pricing === 'Freemium'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {tool.pricing}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Categories */}
      <section className="mb-8">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                selectedCategory === category.id
                  ? 'bg-cyan-600 text-white shadow-md'
                  : `${category.color} text-gray-700 hover:shadow-sm`
              }`}
            >
              <CategoryIcon categoryId={category.id} className="h-4 w-4" />
              <span>{t(`aiStore.categories.${category.id}`)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Tools Grid */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {t(`aiStore.categories.${selectedCategory}`)}
            <span className="ml-2 text-sm font-normal text-gray-500">
              {t('aiStore.toolCount', { count: filteredTools.length })}
            </span>
          </h2>
        </div>

        {filteredTools.length === 0 ? (
          <EmptyState
            type="search"
            title={t('aiStore.empty.title')}
            description={t('aiStore.empty.description')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredTools.map((tool) => (
              <a
                key={tool.id}
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-gray-50 to-gray-100">
                    <ToolIcon
                      toolId={tool.id}
                      className="h-5 w-5 text-gray-600"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium text-gray-900 group-hover:text-cyan-600">
                      {tool.name}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="flex items-center gap-0.5">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        {tool.rating}
                      </span>
                      <span className="text-gray-300">&bull;</span>
                      <span>{tool.users}</span>
                    </div>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-gray-500">
                  {tool.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tool.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-gray-50 pt-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      tool.pricing === 'Free'
                        ? 'bg-green-100 text-green-700'
                        : tool.pricing === 'Freemium'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {tool.pricing}
                  </span>
                  <span className="text-xs text-gray-400 group-hover:text-cyan-500">
                    {t('aiStore.visit')} →
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Submit Tool CTA */}
      <section className="mt-12 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 p-8 text-center text-white">
        <h2 className="text-xl font-bold">{t('aiStore.submit.title')}</h2>
        <p className="mt-2 text-cyan-100">{t('aiStore.submit.description')}</p>
        <button className="mt-4 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-cyan-600 transition-all hover:bg-cyan-50 hover:shadow-lg">
          {t('aiStore.submit.button')}
        </button>
      </section>
    </div>
  );
}

'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { streamAskMessage } from '@/lib/api/ai-ask-stream';
import { SelfDrivenStream } from '@/components/ai-ask/SelfDrivenStream';
import { useSelfDrivenChat } from '@/components/ai-ask/useSelfDrivenChat';

// W4-byok 2026-05-05: 提到共享组件，让所有用到 BYOK 标识的地方走同一来源
// 2026-05-06 截图 40：ModelKeyMeta 让 AI Ask 模型行也走 KeyRound/Server lucide 图标
import {
  ModelBadges,
  ModelKeyMeta,
} from '@/components/common/badges/ModelBadges';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useAIModels, pickPreferredModel, userHasBYOK, AIModel } from '@/hooks';
import { BYOKRequiredBanner } from '@/components/common/byok/BYOKRequiredBanner';
import { config } from '@/lib/utils/config';
import { KnowledgeBaseSelector } from '@/components/common/selectors';
import AskToolsButton from '@/components/ai-ask/AskToolsButton';
import AskTeamsButton from '@/components/ai-ask/AskTeamsButton';

import {
  ActionCards,
  type SuggestedAction,
} from '@/components/ai-ask/ActionCards';
import AppShell from '@/components/layout/AppShell';
import SessionSidebar from '@/components/ai-ask/SessionSidebar';
import MessageContextMenu from '@/components/ai-ask/MessageContextMenu';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { KATEX_OPTIONS } from '@/lib/markdown/katexOptions';
import { CollapsibleBlockquote } from '@/components/ui/collapsible/CollapsibleBlockquote';
import { CollapsibleMessage } from '@/components/ui/collapsible/CollapsibleMessage';
import { CollapsibleRagSources } from '@/components/ui/collapsible/CollapsibleRagSources';
import MermaidDiagram from '@/components/ui/viewers/MermaidDiagram';
import { useThemeStore } from '@/stores';
import { useI18n } from '@/lib/i18n/i18n-context';
import { sanitizeSvg } from '@/lib/utils/sanitize';

import { logger } from '@/lib/utils/logger';
// Inspirational quotes data with bilingual support
interface Quote {
  textZh: string;
  textEn: string;
  authorZh: string;
  authorEn: string;
  source?: string;
  bgImage: string; // Unsplash image keyword for background
}

// Curated background images by theme (Unsplash)
const BG = {
  // 山峰/攀登 - 挑战、目标、坚持
  mountain:
    'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
  mountainSunrise:
    'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=80',
  mountainPeak:
    'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=800&q=80',
  // 道路/旅程 - 人生道路、旅程、方向
  road: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80',
  path: 'https://images.unsplash.com/photo-1510797215324-95aa89f43c33?w=800&q=80',
  journey:
    'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800&q=80',
  // 海洋/水 - 宽广、深度、平静
  ocean:
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
  wave: 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=800&q=80',
  calm: 'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=800&q=80',
  // 日出/光明 - 希望、新开始、未来
  sunrise:
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80',
  light:
    'https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?w=800&q=80',
  dawn: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=800&q=80',
  // 星空/宇宙 - 梦想、无限可能、想象
  stars:
    'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=80',
  galaxy:
    'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&q=80',
  universe:
    'https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3?w=800&q=80',
  // 森林/自然 - 成长、生命、自然
  forest:
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&q=80',
  tree: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=800&q=80',
  bamboo:
    'https://images.unsplash.com/photo-1545468800-85cc9bc6ecf7?w=800&q=80',
  // 天空/云 - 自由、广阔、超越
  sky: 'https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6?w=800&q=80',
  clouds:
    'https://images.unsplash.com/photo-1534088568595-a066f410bcda?w=800&q=80',
  eagle:
    'https://images.unsplash.com/photo-1611689342806-0863700ce1e4?w=800&q=80',
  // 书籍/智慧 - 学习、知识、智慧
  books:
    'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&q=80',
  library:
    'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=800&q=80',
  // 灯塔/指引 - 方向、引导、领导
  lighthouse:
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
  compass:
    'https://images.unsplash.com/photo-1490730141103-6cac27abb37f?w=800&q=80',
  // 火/激情 - 热情、能量、动力
  fire: 'https://images.unsplash.com/photo-1475070929565-c985b496cb9f?w=800&q=80',
  spark:
    'https://images.unsplash.com/photo-1492552181161-62217fc3076d?w=800&q=80',
  // 城市/现代 - 创新、商业、成功
  city: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800&q=80',
  skyline:
    'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80',
  // 花/绽放 - 美、成长、绽放
  flower:
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800&q=80',
  lotus:
    'https://images.unsplash.com/photo-1474557157379-8aa74a6ef541?w=800&q=80',
  // 桥/连接 - 沟通、合作、连接
  bridge:
    'https://images.unsplash.com/photo-1513415756790-2ac1db1297d0?w=800&q=80',
  // 瀑布/力量 - 力量、势能、突破
  waterfall:
    'https://images.unsplash.com/photo-1494472155656-f34e81b17ddc?w=800&q=80',
};

const INSPIRATIONAL_QUOTES: Quote[] = [
  // ===== 梦想与未来 (星空/日出) =====
  {
    textZh: '未来属于那些相信自己梦想之美的人。',
    textEn:
      'The future belongs to those who believe in the beauty of their dreams.',
    authorZh: '埃莉诺·罗斯福',
    authorEn: 'Eleanor Roosevelt',
    bgImage: BG.sunrise,
  },
  {
    textZh: '去追逐你的梦想吧，即使它看起来遥不可及。',
    textEn:
      'Go confidently in the direction of your dreams. Live the life you have imagined.',
    authorZh: '亨利·大卫·梭罗',
    authorEn: 'Henry David Thoreau',
    bgImage: BG.stars,
  },
  {
    textZh: '梦想不会逃跑，逃跑的永远是自己。',
    textEn: 'Dreams do not run away. It is always yourself that runs away.',
    authorZh: '星野道夫',
    authorEn: 'Michio Hoshino',
    bgImage: BG.galaxy,
  },
  {
    textZh: '最好的预测未来的方法就是创造未来。',
    textEn: 'The best way to predict the future is to create it.',
    authorZh: '彼得·德鲁克',
    authorEn: 'Peter Drucker',
    bgImage: BG.dawn,
  },
  {
    textZh: '心之所向，素履以往。',
    textEn: 'Where your heart leads, follow with simple steps.',
    authorZh: '七堇年',
    authorEn: 'Qi Jinnian',
    bgImage: BG.universe,
  },

  // ===== 坚持与毅力 (山峰) =====
  {
    textZh: '成功不是终点，失败也不是终结，重要的是继续前行的勇气。',
    textEn:
      'Success is not final, failure is not fatal: it is the courage to continue that counts.',
    authorZh: '温斯顿·丘吉尔',
    authorEn: 'Winston Churchill',
    bgImage: BG.mountain,
  },
  {
    textZh: '人生最大的荣耀不在于从不跌倒，而在于每次跌倒后都能爬起来。',
    textEn:
      'The greatest glory in living lies not in never falling, but in rising every time we fall.',
    authorZh: '纳尔逊·曼德拉',
    authorEn: 'Nelson Mandela',
    bgImage: BG.mountainPeak,
  },
  {
    textZh: '天行健，君子以自强不息。',
    textEn:
      'As heaven maintains vigor through movements, a gentleman should constantly strive for self-improvement.',
    authorZh: '《周易》',
    authorEn: 'I Ching',
    source: '乾卦',
    bgImage: BG.mountainSunrise,
  },
  {
    textZh: '宝剑锋从磨砺出，梅花香自苦寒来。',
    textEn:
      'The sharpness of a sword comes from grinding; the fragrance of plum blossoms comes from bitter cold.',
    authorZh: '《警世贤文》',
    authorEn: 'Chinese Proverb',
    bgImage: BG.mountain,
  },
  {
    textZh: '只有那些疯狂到以为自己能够改变世界的人，才能真正改变世界。',
    textEn:
      'The people who are crazy enough to think they can change the world are the ones who do.',
    authorZh: '史蒂夫·乔布斯',
    authorEn: 'Steve Jobs',
    bgImage: BG.mountainPeak,
  },
  {
    textZh: '锲而不舍，金石可镂。',
    textEn: 'With perseverance, even metal and stone can be carved.',
    authorZh: '荀子',
    authorEn: 'Xunzi',
    source: '《劝学》',
    bgImage: BG.mountainSunrise,
  },

  // ===== 旅程与道路 (道路/路径) =====
  {
    textZh: '千里之行，始于足下。',
    textEn: 'A journey of a thousand miles begins with a single step.',
    authorZh: '老子',
    authorEn: 'Lao Tzu',
    source: '《道德经》',
    bgImage: BG.road,
  },
  {
    textZh: '不积跬步，无以至千里；不积小流，无以成江海。',
    textEn:
      'Without accumulating small steps, one cannot travel a thousand miles; without gathering small streams, one cannot form rivers and seas.',
    authorZh: '荀子',
    authorEn: 'Xunzi',
    source: '《劝学》',
    bgImage: BG.path,
  },
  {
    textZh: '路漫漫其修远兮，吾将上下而求索。',
    textEn: 'The road ahead is long and winding; I shall search high and low.',
    authorZh: '屈原',
    authorEn: 'Qu Yuan',
    source: '《离骚》',
    bgImage: BG.journey,
  },
  {
    textZh: '世上本没有路，走的人多了，也便成了路。',
    textEn:
      'There was no road in the world at first, but when many people walk on it, it becomes a road.',
    authorZh: '鲁迅',
    authorEn: 'Lu Xun',
    bgImage: BG.road,
  },
  {
    textZh: '人生就像骑自行车，要保持平衡就得不断前行。',
    textEn:
      'Life is like riding a bicycle. To keep your balance, you must keep moving.',
    authorZh: '阿尔伯特·爱因斯坦',
    authorEn: 'Albert Einstein',
    bgImage: BG.path,
  },
  {
    textZh: '两条路在树林里分岔，我选择了人迹罕至的那条。',
    textEn:
      'Two roads diverged in a wood, and I took the one less traveled by.',
    authorZh: '罗伯特·弗罗斯特',
    authorEn: 'Robert Frost',
    bgImage: BG.forest,
  },

  // ===== 学习与智慧 (书籍/图书馆) =====
  {
    textZh: '学而不思则罔，思而不学则殆。',
    textEn:
      'Learning without thinking leads to confusion; thinking without learning leads to danger.',
    authorZh: '孔子',
    authorEn: 'Confucius',
    source: '《论语》',
    bgImage: BG.books,
  },
  {
    textZh: '知之者不如好之者，好之者不如乐之者。',
    textEn:
      'Those who know it are not as good as those who love it; those who love it are not as good as those who enjoy it.',
    authorZh: '孔子',
    authorEn: 'Confucius',
    source: '《论语》',
    bgImage: BG.library,
  },
  {
    textZh: '博观而约取，厚积而薄发。',
    textEn:
      'Read extensively but absorb selectively; accumulate deeply but express sparingly.',
    authorZh: '苏轼',
    authorEn: 'Su Shi',
    bgImage: BG.books,
  },
  {
    textZh: '吾生也有涯，而知也无涯。',
    textEn: 'Life is finite, but knowledge is infinite.',
    authorZh: '庄子',
    authorEn: 'Zhuangzi',
    bgImage: BG.library,
  },
  {
    textZh: '读万卷书，行万里路。',
    textEn: 'Read ten thousand books, travel ten thousand miles.',
    authorZh: '董其昌',
    authorEn: 'Dong Qichang',
    bgImage: BG.books,
  },
  {
    textZh: '三人行，必有我师焉。',
    textEn:
      'When three people walk together, one of them must be able to teach me.',
    authorZh: '孔子',
    authorEn: 'Confucius',
    source: '《论语》',
    bgImage: BG.library,
  },

  // ===== 创新与想象 (天空/宇宙) =====
  {
    textZh: '想象力比知识更重要。',
    textEn: 'Imagination is more important than knowledge.',
    authorZh: '阿尔伯特·爱因斯坦',
    authorEn: 'Albert Einstein',
    bgImage: BG.universe,
  },
  {
    textZh: '创新区分领袖和追随者。',
    textEn: 'Innovation distinguishes between a leader and a follower.',
    authorZh: '史蒂夫·乔布斯',
    authorEn: 'Steve Jobs',
    bgImage: BG.sky,
  },
  {
    textZh: '简单是终极的复杂。',
    textEn: 'Simplicity is the ultimate sophistication.',
    authorZh: '列奥纳多·达·芬奇',
    authorEn: 'Leonardo da Vinci',
    bgImage: BG.clouds,
  },
  {
    textZh: '逻辑会把你从A带到B，想象力能带你去任何地方。',
    textEn:
      'Logic will get you from A to B. Imagination will take you everywhere.',
    authorZh: '阿尔伯特·爱因斯坦',
    authorEn: 'Albert Einstein',
    bgImage: BG.galaxy,
  },
  {
    textZh: '要想飞得更高，就要忘记地平线。',
    textEn: 'To fly higher, forget the horizon.',
    authorZh: '沃尔特·迪士尼',
    authorEn: 'Walt Disney',
    bgImage: BG.eagle,
  },

  // ===== 行动与实践 (瀑布/火) =====
  {
    textZh: '机会总是留给有准备的人。',
    textEn: 'Fortune favors the prepared mind.',
    authorZh: '路易·巴斯德',
    authorEn: 'Louis Pasteur',
    bgImage: BG.spark,
  },
  {
    textZh: '知行合一。',
    textEn: 'Unity of knowledge and action.',
    authorZh: '王阳明',
    authorEn: 'Wang Yangming',
    bgImage: BG.fire,
  },
  {
    textZh: '纸上得来终觉浅，绝知此事要躬行。',
    textEn:
      'What you learn from paper is shallow; true understanding comes from practice.',
    authorZh: '陆游',
    authorEn: 'Lu You',
    bgImage: BG.waterfall,
  },
  {
    textZh: '种一棵树最好的时间是十年前，其次是现在。',
    textEn:
      'The best time to plant a tree was 20 years ago. The second best time is now.',
    authorZh: '中国谚语',
    authorEn: 'Chinese Proverb',
    bgImage: BG.tree,
  },
  {
    textZh: '与其临渊羡鱼，不如退而结网。',
    textEn:
      'Rather than standing by the water longing for fish, go home and weave a net.',
    authorZh: '《汉书》',
    authorEn: 'Book of Han',
    bgImage: BG.ocean,
  },

  // ===== 合作与团队 (桥/连接) =====
  {
    textZh: '如果你想走得快，就一个人走；如果你想走得远，就一起走。',
    textEn:
      'If you want to go fast, go alone. If you want to go far, go together.',
    authorZh: '非洲谚语',
    authorEn: 'African Proverb',
    bgImage: BG.bridge,
  },
  {
    textZh: '独行快，众行远。',
    textEn: 'Walk alone to go fast, walk together to go far.',
    authorZh: '中国谚语',
    authorEn: 'Chinese Proverb',
    bgImage: BG.journey,
  },
  {
    textZh: '众人拾柴火焰高。',
    textEn: 'When everyone gathers firewood, the flame rises high.',
    authorZh: '中国谚语',
    authorEn: 'Chinese Proverb',
    bgImage: BG.fire,
  },
  {
    textZh: '一个人可以走得很快，一群人可以走得很远。',
    textEn: 'One person can walk fast, but a group can walk far.',
    authorZh: '非洲谚语',
    authorEn: 'African Proverb',
    bgImage: BG.bridge,
  },

  // ===== 自然与生命 (森林/花) =====
  {
    textZh: '岁寒，然后知松柏之后凋也。',
    textEn:
      'Only when winter comes do we know that the pine and cypress are the last to fade.',
    authorZh: '孔子',
    authorEn: 'Confucius',
    source: '《论语》',
    bgImage: BG.forest,
  },
  {
    textZh: '出淤泥而不染，濯清涟而不妖。',
    textEn:
      'Growing from mud but not stained, washed by clear water yet not seductive.',
    authorZh: '周敦颐',
    authorEn: 'Zhou Dunyi',
    source: '《爱莲说》',
    bgImage: BG.lotus,
  },
  {
    textZh: '问渠那得清如许？为有源头活水来。',
    textEn:
      'How can the water be so clear? Because fresh water flows from the source.',
    authorZh: '朱熹',
    authorEn: 'Zhu Xi',
    bgImage: BG.calm,
  },
  {
    textZh: '宁静致远，淡泊明志。',
    textEn:
      'Tranquility leads to far-reaching goals; simplicity reveals true aspirations.',
    authorZh: '诸葛亮',
    authorEn: 'Zhuge Liang',
    bgImage: BG.bamboo,
  },
  {
    textZh: '野火烧不尽，春风吹又生。',
    textEn:
      'Wildfire cannot burn them out; spring breeze will bring them back.',
    authorZh: '白居易',
    authorEn: 'Bai Juyi',
    bgImage: BG.flower,
  },

  // ===== 方向与选择 (灯塔/指南针) =====
  {
    textZh: '生活中最重要的事情不是我们身处何处，而是我们朝着什么方向走。',
    textEn:
      'The most important thing in life is not where we stand but in what direction we are moving.',
    authorZh: '奥利弗·温德尔·霍姆斯',
    authorEn: 'Oliver Wendell Holmes',
    bgImage: BG.compass,
  },
  {
    textZh: '选择比努力更重要。',
    textEn: 'Choice is more important than effort.',
    authorZh: '比尔·盖茨',
    authorEn: 'Bill Gates',
    bgImage: BG.lighthouse,
  },
  {
    textZh: '你无法在回顾时串连人生，只能在展望时连点成线。',
    textEn:
      'You cannot connect the dots looking forward; you can only connect them looking backwards.',
    authorZh: '史蒂夫·乔布斯',
    authorEn: 'Steve Jobs',
    bgImage: BG.road,
  },

  // ===== 时间与当下 (日出/光) =====
  {
    textZh: '昨日种种，皆成今我；今日种种，皆成新我。',
    textEn:
      'All of yesterday has made me who I am today; all of today will make me who I become.',
    authorZh: '曾国藩',
    authorEn: 'Zeng Guofan',
    bgImage: BG.sunrise,
  },
  {
    textZh: '逝者如斯夫，不舍昼夜。',
    textEn: 'Time flows on like this, never ceasing day or night.',
    authorZh: '孔子',
    authorEn: 'Confucius',
    source: '《论语》',
    bgImage: BG.wave,
  },
  {
    textZh: '莫等闲，白了少年头，空悲切。',
    textEn:
      'Do not idle away your time; when your hair turns gray, you will only feel empty regret.',
    authorZh: '岳飞',
    authorEn: 'Yue Fei',
    source: '《满江红》',
    bgImage: BG.light,
  },
  {
    textZh: '及时当勉励，岁月不待人。',
    textEn: 'Strive while you can; time waits for no one.',
    authorZh: '陶渊明',
    authorEn: 'Tao Yuanming',
    bgImage: BG.dawn,
  },

  // ===== 心态与境界 (平静水面/天空) =====
  {
    textZh: '海纳百川，有容乃大；壁立千仞，无欲则刚。',
    textEn:
      'The sea embraces all rivers and is vast; the cliff stands firm because it seeks nothing.',
    authorZh: '林则徐',
    authorEn: 'Lin Zexu',
    bgImage: BG.ocean,
  },
  {
    textZh: '不以物喜，不以己悲。',
    textEn: 'Do not rejoice over possessions, nor grieve over personal losses.',
    authorZh: '范仲淹',
    authorEn: 'Fan Zhongyan',
    source: '《岳阳楼记》',
    bgImage: BG.calm,
  },
  {
    textZh: '静水流深。',
    textEn: 'Still waters run deep.',
    authorZh: '英国谚语',
    authorEn: 'English Proverb',
    bgImage: BG.calm,
  },
  {
    textZh: '心若冰清，天塌不惊。',
    textEn:
      'With a clear mind like ice, even if the sky falls, one remains calm.',
    authorZh: '中国古语',
    authorEn: 'Chinese Saying',
    bgImage: BG.sky,
  },

  // ===== 成功与商业 (城市) =====
  {
    textZh: '成功的秘诀在于坚持自己的目标和信念。',
    textEn: 'The secret of success is constancy to purpose.',
    authorZh: '本杰明·迪斯雷利',
    authorEn: 'Benjamin Disraeli',
    bgImage: BG.city,
  },
  {
    textZh: '你的时间有限，不要浪费在过别人的生活上。',
    textEn:
      "Your time is limited, so do not waste it living someone else's life.",
    authorZh: '史蒂夫·乔布斯',
    authorEn: 'Steve Jobs',
    bgImage: BG.skyline,
  },
  {
    textZh: '在正确的时间做正确的事。',
    textEn: 'Do the right thing at the right time.',
    authorZh: '彼得·德鲁克',
    authorEn: 'Peter Drucker',
    bgImage: BG.city,
  },
  {
    textZh: '如果你不能简单地解释它，你就没有真正理解它。',
    textEn:
      'If you cannot explain it simply, you do not understand it well enough.',
    authorZh: '阿尔伯特·爱因斯坦',
    authorEn: 'Albert Einstein',
    bgImage: BG.light,
  },

  // ===== 勇气与突破 (瀑布/浪) =====
  {
    textZh: '长风破浪会有时，直挂云帆济沧海。',
    textEn:
      'There will come a time when the wind breaks the waves; then I shall set my cloud-like sails to cross the boundless sea.',
    authorZh: '李白',
    authorEn: 'Li Bai',
    bgImage: BG.wave,
  },
  {
    textZh: '勇气不是没有恐惧，而是战胜恐惧。',
    textEn: 'Courage is not the absence of fear, but the triumph over it.',
    authorZh: '纳尔逊·曼德拉',
    authorEn: 'Nelson Mandela',
    bgImage: BG.waterfall,
  },
  {
    textZh: '大鹏一日同风起，扶摇直上九万里。',
    textEn:
      'One day, the great roc rises with the wind, soaring ninety thousand miles into the sky.',
    authorZh: '李白',
    authorEn: 'Li Bai',
    bgImage: BG.eagle,
  },
  {
    textZh: '破釜沉舟，百二秦关终属楚。',
    textEn:
      'Break the cauldrons and sink the boats; all the Qin passes will belong to Chu.',
    authorZh: '项羽',
    authorEn: 'Xiang Yu',
    bgImage: BG.fire,
  },
];

// Quote Card Component - Redesigned with background image and bilingual support
function QuoteCard({ quote }: { quote: Quote }) {
  const { locale } = useI18n();
  const isEn = locale === 'en';
  return (
    <div className="mx-4 mb-4">
      <div
        className="relative overflow-hidden rounded-2xl shadow-md shadow-black/10 transition-all duration-300"
        style={{ minHeight: '140px' }}
      >
        {/* Background image with overlay */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${quote.bgImage})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/40" />

        {/* Content */}
        <div className="relative z-10 flex h-full flex-col justify-between p-6">
          {/* Quote mark */}
          <div className="font-serif absolute left-4 top-3 select-none text-4xl text-white/20">
            "
          </div>

          {/* Quote text - bilingual */}
          <div className="space-y-2 pl-6 pr-4">
            <p className="text-lg font-medium leading-relaxed text-white md:text-xl">
              {isEn ? quote.textEn : quote.textZh}
            </p>
            <p className="text-sm italic leading-relaxed text-white/70">
              {isEn ? quote.textZh : quote.textEn}
            </p>
          </div>

          {/* Author info - right aligned */}
          <div className="mt-4 text-right">
            <p className="text-sm font-medium text-white/90">
              —— {isEn ? quote.authorEn : quote.authorZh}
              <span className="ml-2 text-white/60">
                {isEn ? quote.authorZh : quote.authorEn}
              </span>
            </p>
            {quote.source && (
              <p className="mt-0.5 text-xs text-white/50">{quote.source}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Mermaid diagram keywords for detection
const MERMAID_KEYWORDS = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'gitGraph',
  'journey',
];

// Helper function to detect if code is a Mermaid diagram
function isMermaidDiagram(code: string, language?: string): boolean {
  // Check if language is explicitly set to 'mermaid'
  if (language === 'mermaid') return true;

  // Check if code starts with any Mermaid keyword
  const trimmedCode = code.trim();
  return MERMAID_KEYWORDS.some((keyword) => trimmedCode.startsWith(keyword));
}

// Helper function to detect if code is SVG
function isSvgCode(code: string, language?: string): boolean {
  if (language === 'svg' || language === 'xml') {
    const trimmed = code.trim();
    return trimmed.startsWith('<svg') || trimmed.includes('<svg');
  }
  // Auto-detect SVG even without language hint
  const trimmed = code.trim();
  return trimmed.startsWith('<svg') && trimmed.endsWith('</svg>');
}

// SVG Renderer component
function SvgRenderer({ svgCode }: { svgCode: string }) {
  // Use DOMPurify for comprehensive XSS protection
  const sanitizedSvg = sanitizeSvg(svgCode);

  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-gray-200 bg-white p-4">
      <div
        className="mx-auto"
        style={{ maxWidth: '100%' }}
        dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
      />
    </div>
  );
}

// Custom code renderer for ReactMarkdown that supports Mermaid and SVG
// Note: react-markdown v9+ no longer passes 'inline' prop, need to detect differently
// Code block component for assistant messages (light theme)
interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
  [key: string]: unknown;
}

function CodeBlock({ className, children, node, ...props }: CodeBlockProps) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');

  // Detect if this is inline code:
  // - Block code has className with language-* OR contains newlines OR is wrapped in <pre>
  // - In react-markdown v9+, block code's parent is <pre>, inline code has no <pre> parent
  const hasLanguage = !!match;
  const hasNewlines = codeString.includes('\n');
  const isInline = !hasLanguage && !hasNewlines;

  // Check if this is a Mermaid diagram
  if (!isInline && isMermaidDiagram(codeString, language)) {
    return <MermaidDiagram chart={codeString} className="my-4" />;
  }

  // Check if this is SVG code
  if (!isInline && isSvgCode(codeString, language)) {
    return <SvgRenderer svgCode={codeString} />;
  }

  // Inline code rendering
  if (isInline) {
    return (
      <code
        className="font-mono rounded bg-gray-100 px-1.5 py-0.5 text-sm text-red-600"
        {...props}
      >
        {children}
      </code>
    );
  }

  // Block code rendering
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4">
      <code className={className} {...props}>
        {children}
      </code>
    </pre>
  );
}

// Toast notification component
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 transform rounded-lg bg-gray-800 px-4 py-2 text-sm text-white shadow-lg">
      {message}
    </div>
  );
}

interface RagSource {
  documentTitle: string;
  excerpt: string;
  score: number;
  metadata?: {
    source?: 'wiki' | 'chunk';
    kbId?: string;
    slug?: string;
    oneLiner?: string;
    category?: string;
    [k: string]: unknown;
  };
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  modelName?: string;
  createdAt: string;
  ragSources?: RagSource[];
  streamStatus?: 'thinking' | 'rag' | 'generating';
}

interface MixtureResponse {
  model: string;
  modelId: string;
  content: string;
  isCollapsed: boolean;
}

// Provider to local icon path mapping
const PROVIDER_ICONS: Record<string, string> = {
  openai: '/icons/ai/openai.svg',
  google: '/icons/ai/gemini.svg',
  anthropic: '/icons/ai/claude.svg',
  xai: '/icons/ai/grok.svg',
  deepseek: '/icons/ai/deepseek.svg',
  alibaba: '/icons/ai/qwen.svg',
  bytedance: '/icons/ai/doubao.svg',
  zhipu: '/icons/ai/zhipu.svg',
  moonshot: '/icons/ai/kimi.svg',
};

// Helper: render model icon using local SVG files
function ModelIcon({
  model,
  size = 20,
}: {
  model: AIModel | { icon?: string; iconUrl?: string; provider?: string };
  size?: number;
}) {
  const icon = model.icon || '';
  const iconUrl = 'iconUrl' in model ? model.iconUrl : undefined;
  const provider = (
    'provider' in model ? model.provider || '' : ''
  ).toLowerCase();

  // Priority 1: Use iconUrl if it starts with /icons/ (local path)
  if (iconUrl && iconUrl.startsWith('/icons/')) {
    return (
      <Image
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className="rounded"
      />
    );
  }

  // Priority 2: Use icon if it starts with /icons/ (local path)
  if (icon && icon.startsWith('/icons/')) {
    return (
      <Image src={icon} alt="" width={size} height={size} className="rounded" />
    );
  }

  // Priority 3: Use iconUrl if it's a valid URL (starts with http)
  if (iconUrl && iconUrl.startsWith('http')) {
    return (
      <Image
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className="rounded"
      />
    );
  }

  // Priority 4: Map provider to local icon
  const providerIcon = PROVIDER_ICONS[provider];
  if (providerIcon) {
    return (
      <Image
        src={providerIcon}
        alt=""
        width={size}
        height={size}
        className="rounded"
      />
    );
  }

  // Priority 5: Check if icon is emoji
  const isEmoji = icon && /\p{Emoji}/u.test(icon) && !icon.startsWith('/');
  if (isEmoji) {
    return <span style={{ fontSize: size }}>{icon}</span>;
  }

  // Fallback: default icon
  return (
    <span
      style={{ fontSize: size }}
      className="flex items-center justify-center"
    >
      🤖
    </span>
  );
}

export default function AskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processedParamsRef = useRef(false);
  const processedSessionRef = useRef(false);
  const { user, accessToken: token } = useAuth();
  const { t, locale } = useI18n();
  const { userMessageStyle, aiMessageStyle } = useThemeStore();
  const { models, loading: modelsLoading } = useAIModels();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamStage, setStreamStage] = useState<
    'thinking' | 'rag' | 'generating' | null
  >(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  // Time-of-day greeting is computed client-side only. Rendering it during SSR
  // would mismatch the client (server tz=UTC vs browser local tz can land in a
  // different hour bucket), tripping React hydration errors #418/#423.
  const [greeting, setGreeting] = useState<string>('');
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(
      hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    );
  }, []);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<
    string[]
  >([]);
  const [mixtureResponses, setMixtureResponses] = useState<MixtureResponse[]>(
    []
  );
  const selfDriven = useSelfDrivenChat({
    appendUser: (m) => setMessages((prev) => [...prev, m]),
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    message: Message;
    position: { x: number; y: number };
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<
    Array<{ file: File; preview?: string }>
  >([]);
  const [isDragging, setIsDragging] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState<{
    content: string;
    preview: string;
  } | null>(null);
  const [messageSuggestions, setMessageSuggestions] = useState<
    Map<string, SuggestedAction[]>
  >(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debug: Log knowledge base selection changes
  useEffect(() => {
    logger.debug(
      '[AiAsk] selectedKnowledgeBases changed:',
      selectedKnowledgeBases
    );
  }, [selectedKnowledgeBases]);

  // ?q=xxx — pre-fill input from Global AI Bar or ActionCards
  useEffect(() => {
    if (processedParamsRef.current) return;
    const q = searchParams?.get('q');
    if (q?.trim()) {
      processedParamsRef.current = true;
      setInput(q.trim());
    }
  }, [searchParams]); // searchParams may be null on first SSR render, re-run when populated

  // Random quote selection - changes on page load
  const randomQuote = useMemo(() => {
    const randomIndex = Math.floor(Math.random() * INSPIRATIONAL_QUOTES.length);
    return INSPIRATIONAL_QUOTES[randomIndex];
  }, []);

  // Create preview URLs for image files
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
  const addFilesWithPreviews = useCallback((files: File[]) => {
    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
    const validSized = files.filter((f) => f.size <= MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setToastMessage(`${oversized.length} 个文件超过 10MB 限制，已跳过`);
    }
    const filesWithPreviews = validSized.map((file) => {
      if (file.type.startsWith('image/')) {
        return { file, preview: URL.createObjectURL(file) };
      }
      return { file };
    });
    setAttachedFiles((prev) => [...prev, ...filesWithPreviews].slice(0, 5));
  }, []);

  // Cleanup preview URLs when files are removed
  useEffect(() => {
    return () => {
      attachedFiles.forEach((item) => {
        if (item.preview) {
          URL.revokeObjectURL(item.preview);
        }
      });
    };
  }, [attachedFiles]);

  // Handle file drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const codeExtensions = [
        '.py',
        '.js',
        '.ts',
        '.tsx',
        '.jsx',
        '.csv',
        '.xml',
        '.yaml',
        '.yml',
      ];
      const validFiles = files.filter((file) => {
        const validTypes = [
          'image/',
          'application/pdf',
          'text/',
          'application/json',
        ];
        const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
        return (
          validTypes.some((type) => file.type.startsWith(type)) ||
          codeExtensions.includes(ext)
        );
      });

      if (validFiles.length > 0) {
        addFilesWithPreviews(validFiles);
        setToastMessage(`已添加 ${validFiles.length} 个文件`);
      } else if (files.length > 0) {
        setToastMessage('不支持的文件类型');
      }
    },
    [addFilesWithPreviews]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const item = prev[index];
      if (item?.preview) {
        URL.revokeObjectURL(item.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Read file content as base64 or text
  const readFileContent = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
      }
    });
  }, []);

  // Filter CHAT and CHAT_FAST models for the selector
  // CHAT_FAST includes models like Gemini Flash, GPT-4o-mini, Claude Haiku
  const chatModels = (models || []).filter(
    (m) => m.modelType === 'CHAT' || m.modelType === 'CHAT_FAST'
  );

  // Set default model — uses shared pickPreferredModel
  // Priority: BYOK > System default > First available
  useEffect(() => {
    if (chatModels.length > 0 && !selectedModel) {
      const preferred = pickPreferredModel(chatModels);
      if (preferred) setSelectedModel(preferred.id);
    }
  }, [chatModels, selectedModel]);

  const selectedModelInfo = chatModels.find((m) => m.id === selectedModel);
  const isMixtureMode = selectedModel === 'mixture';
  const isSelfDrivenMode = selectedModel === 'self-driven-team';

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, mixtureResponses]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelSelectorRef.current &&
        !modelSelectorRef.current.contains(event.target as Node)
      ) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  // Create a new session
  const createSession = useCallback(async (): Promise<string | null> => {
    if (!token) {
      logger.warn('Cannot create session: no auth token');
      return null;
    }

    try {
      const response = await fetch(`${config.apiUrl}/ask/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          modelId: selectedModel !== 'mixture' ? selectedModel : undefined,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: { id: ... } }
        const session = result?.data ?? result;
        return session.id;
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.error('Failed to create session:', {
          status: response.status,
          error: errorData,
        });
      }
    } catch (error) {
      logger.error('Failed to create session:', error);
    }
    return null;
  }, [token, selectedModel]);

  // Send message to session（流式 SSE）
  const sendMessageToSession = useCallback(
    async (
      sessionId: string,
      content: string,
      modelId?: string,
      onChunk?: (
        accumulated: string,
        sources?: Array<{
          documentTitle: string;
          excerpt: string;
          score: number;
        }>
      ) => void,
      onStatus?: (stage: 'rag' | 'generating') => void
    ) => {
      if (!token) {
        logger.warn('Cannot send message: no auth token');
        return {
          ok: false as const,
          error: '登录状态已过期，请重新登录后再试。',
        };
      }

      // Build request body with optional knowledgeBaseIds
      const requestBody: {
        content: string;
        modelId?: string;
        webSearch: boolean;
        knowledgeBaseIds?: string[];
      } = {
        content,
        modelId:
          modelId || (selectedModel !== 'mixture' ? selectedModel : undefined),
        webSearch: webSearchEnabled,
      };

      // Add knowledge base IDs if any are selected
      if (selectedKnowledgeBases.length > 0) {
        requestBody.knowledgeBaseIds = selectedKnowledgeBases;
      }

      logger.debug('[AiAsk] sendMessageToSession:', {
        sessionId,
        contentLength: content.length,
        knowledgeBaseIds: requestBody.knowledgeBaseIds,
      });

      // 2026-05-10 §4：SSE 解析 + result 构造拆到 lib/api/ai-ask-stream.ts
      // 避免本文件突破 god-class +50 行 pre-push 阈值
      return streamAskMessage(sessionId, token, requestBody, onChunk, onStatus);
    },
    [token, selectedModel, webSearchEnabled, selectedKnowledgeBases]
  );

  // Load session messages
  const loadSession = useCallback(
    async (sessionId: string) => {
      if (!token) return;

      try {
        const response = await fetch(
          `${config.apiUrl}/ask/sessions/${sessionId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: { messages: [...] } }
          const data = result?.data ?? result;
          // 2026-05-08（screenshot 40）：会话历史里的"AI 团队房间"被错误地以
          // SOLO 单模型 UI 加载，导致用户看不到团队对话。session.mode='ROOM'
          // 时跳转到团队房间路由 /ai-ask/rooms/{id}。
          // 后端返回结构：{ session: { mode, ... }, messages: [...] }（见
          // backend/src/modules/ai-app/ask/ai-ask.service.ts getSession）。
          if (data?.session?.mode === 'ROOM') {
            router.push(`/ai-ask/rooms/${sessionId}`);
            return;
          }
          setCurrentSessionId(sessionId);
          setMessages(
            (data.messages || []).map((m: unknown) => {
              const msg = m as Record<string, unknown>;
              return {
                id: msg.id as string,
                role: msg.role as 'user' | 'assistant',
                content: msg.content as string,
                modelId: msg.modelId as string | undefined,
                modelName: msg.modelName as string | undefined,
                createdAt: msg.createdAt as string,
              };
            })
          );
          setMixtureResponses([]);
          setMessageSuggestions(new Map());
        }
      } catch (error) {
        logger.error('Failed to load session:', error);
      }
    },
    [token, router]
  );

  // ?sessionId=xxx — auto-load session from Global AI Bar "继续对话" link
  useEffect(() => {
    if (processedSessionRef.current) return;
    const sessionId = searchParams?.get('sessionId');
    if (sessionId && token) {
      processedSessionRef.current = true;
      void loadSession(sessionId);
    }
  }, [searchParams, token, loadSession]);

  // Handle new session
  const handleNewSession = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setMixtureResponses([]);
    selfDriven.reset();
    setMessageSuggestions(new Map());
    setInput('');
  }, []);

  // Call real backend AI API with optional context (for mixture mode and fallback)
  const callAIChat = async (
    modelName: string,
    message: string,
    enableWebSearch: boolean = false,
    contextMessages?: Message[],
    signal?: AbortSignal
  ): Promise<{ content: string; ragSources?: RagSource[] }> => {
    // Build messages array with context
    const apiMessages = contextMessages
      ? [
          ...contextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: 'user' as const, content: message },
        ]
      : undefined;

    // Build request body
    const requestBody = {
      message,
      messages: apiMessages,
      model: modelName,
      stream: false,
      webSearch: enableWebSearch,
      knowledgeBaseIds:
        selectedKnowledgeBases.length > 0 ? selectedKnowledgeBases : undefined,
    };

    // Debug: Log request before sending
    logger.debug('[AiAsk] Sending request:', {
      url: `${config.apiUrl}/ai/simple-chat`,
      knowledgeBaseIds: requestBody.knowledgeBaseIds,
      model: requestBody.model,
      messageLength: message.length,
    });

    const response = await fetch(`${config.apiUrl}/ai/simple-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // BYOK: Pass auth token so backend can use user's personal API key
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      // BYOK 错误：发布全局事件让 GlobalByokErrorModal 弹出引导卡片，
      // 同时抛一个带 __byok 标记的 Error，让外层 catch 知道这是
      // BYOK 错误，不要再把文案渲染成 assistant 消息。
      const BYOK_CODES = [
        'NO_AVAILABLE_KEY',
        'NO_SYSTEM_KEY',
        'QUOTA_EXCEEDED',
        'INVALID_API_KEY',
        'KEY_EXPIRED',
      ];
      if (
        response.status === 403 &&
        typeof error.code === 'string' &&
        BYOK_CODES.includes(error.code)
      ) {
        const { publishByokError } = await import('@/lib/byok/event-bus');
        publishByokError({
          code: error.code,
          message: error.message,
          details: error,
        } as unknown);
        const byokErr = new Error(error.message || 'BYOK error') as Error & {
          __byok: true;
        };
        byokErr.__byok = true;
        throw byokErr;
      }
      throw new Error(error.message || `API Error: ${response.status}`);
    }

    const result = await response.json();
    // Handle wrapped API response { success: true, data: T }
    const data = result?.data ?? result;
    logger.debug('[AiAsk] Response data:', {
      hasContent: !!data.content,
      usedKnowledgeBase: data.usedKnowledgeBase,
      ragSourcesCount: data.ragSources?.length || 0,
    });
    return {
      content: data.content || 'No response',
      ragSources: data.ragSources,
    };
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // Allow sending with just files even without text, or with quoted message
    if (
      (!input.trim() && attachedFiles.length === 0 && !quotedMessage) ||
      isLoading
    )
      return;

    // Build message content with quoted content and file attachments
    let userContent = input.trim();
    const currentFiles = [...attachedFiles];
    const currentQuote = quotedMessage;

    // Read file contents and append to message
    if (currentFiles.length > 0) {
      const fileDescriptions: string[] = [];
      // Sanitize filename to prevent markdown injection
      const sanitizeFileName = (name: string) =>
        name.replace(/[[\](){}*_~`#>!|\\]/g, '');
      for (const item of currentFiles) {
        const safeName = sanitizeFileName(item.file.name);
        try {
          const content = await readFileContent(item.file);
          if (item.file.type.startsWith('image/')) {
            // For images, include base64 data
            fileDescriptions.push(`[图片: ${safeName}]\n${content}`);
          } else {
            // For text files, include content
            const truncatedContent =
              content.length > 5000
                ? content.substring(0, 5000) + '...(内容已截断)'
                : content;
            fileDescriptions.push(
              `[文件: ${safeName}]\n\`\`\`\n${truncatedContent}\n\`\`\``
            );
          }
        } catch (err) {
          logger.error(`Failed to read file ${item.file.name}:`, err);
          fileDescriptions.push(`[文件: ${safeName}] (读取失败)`);
        }
      }

      if (fileDescriptions.length > 0) {
        userContent = userContent
          ? `${userContent}\n\n---\n附件内容:\n${fileDescriptions.join('\n\n')}`
          : `请分析以下内容:\n${fileDescriptions.join('\n\n')}`;
      }
    }

    // Add quoted content at the beginning if present
    // displayContent is for UI display (truncated), userContent is for AI (full)
    let displayContent = userContent;
    if (currentQuote?.content) {
      // Full content for AI
      const quotedBlock = `> 引用内容:\n> ${currentQuote.content.split('\n').join('\n> ')}\n\n`;
      userContent = userContent
        ? `${quotedBlock}${userContent}`
        : `${quotedBlock}请针对以上引用内容进行回复`;

      // Truncated content for display (max 100 chars)
      const truncatedQuote =
        currentQuote.content.length > 100
          ? currentQuote.content.substring(0, 100).replace(/\n/g, ' ') + '...'
          : currentQuote.content.replace(/\n/g, ' ');
      const displayQuoteBlock = `> 引用: ${truncatedQuote}\n\n`;
      displayContent = displayContent
        ? `${displayQuoteBlock}${displayContent}`
        : `${displayQuoteBlock}请针对以上引用内容进行回复`;
    }

    setInput('');
    setAttachedFiles([]);
    setQuotedMessage(null);
    setIsLoading(true);
    setStreamStage(webSearchEnabled ? 'rag' : 'thinking');
    setMixtureResponses([]);
    selfDriven.reset();

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      if (isSelfDrivenMode) {
        if (!token) return;
        setStreamStage(null);
        await selfDriven.run({
          prompt: userContent,
          token,
          signal,
          language: locale,
        });
      } else if (isMixtureMode) {
        // Mixture mode: call multiple models in parallel (legacy behavior)
        if (chatModels.length === 0) {
          setToastMessage('No models available for Mixture mode');
          return;
        }

        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          content: displayContent,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage]);

        const modelsToCall = chatModels.slice(0, 4);
        const responses: MixtureResponse[] = modelsToCall.map((m) => ({
          model: m.name,
          modelId: m.id,
          content: '',
          isCollapsed: false,
        }));
        setMixtureResponses(responses);

        await Promise.all(
          modelsToCall.map(async (model, index) => {
            try {
              const result = await callAIChat(
                model.modelName,
                userContent,
                webSearchEnabled,
                undefined,
                signal
              );
              setMixtureResponses((prev) => {
                const newResponses = [...prev];
                newResponses[index] = {
                  ...newResponses[index],
                  content: result.content,
                };
                return newResponses;
              });
            } catch (error) {
              if ((error as Error).name === 'AbortError') return;
              // BYOK 错误：全局 Modal 已处理，给 mixture 槽位一个简短状态
              const isByok = (error as Error & { __byok?: boolean }).__byok;
              setMixtureResponses((prev) => {
                const newResponses = [...prev];
                newResponses[index] = {
                  ...newResponses[index],
                  content: isByok
                    ? '—'
                    : `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
                };
                return newResponses;
              });
            }
          })
        );
      } else {
        // Single model mode with session
        let sessionId = currentSessionId;

        // Create session if needed
        if (!sessionId) {
          sessionId = await createSession();
          if (sessionId) {
            setCurrentSessionId(sessionId);
          }
        }

        if (sessionId) {
          // 2026-05-10 §4 流式（v2 修 UI 错位）：
          //   - 只先注入 temp user（用户消息立即可见）
          //   - assistant 消息**懒注入**：第一个 chunk 到达时才创建（避免空 bubble
          //     渲染 action toolbar 与原 "is thinking..." 占位重叠错位）
          //   - 后续 chunk 更新该 assistant 消息内容
          const tempUserId = 'temp-user-' + Date.now();
          const tempUserMessage: Message = {
            id: tempUserId,
            role: 'user',
            content: displayContent,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, tempUserMessage]);

          let tempAssistantId: string | null = null;

          const result = await sendMessageToSession(
            sessionId,
            userContent,
            undefined,
            (accumulated, sources) => {
              setStreamStage(null);
              if (tempAssistantId === null) {
                // 第一个 chunk：lazy 注入 assistant bubble
                tempAssistantId = 'temp-assistant-' + Date.now();
                const id = tempAssistantId;
                setMessages((prev) => [
                  ...prev,
                  {
                    id,
                    role: 'assistant',
                    content: accumulated,
                    createdAt: new Date().toISOString(),
                    ragSources: sources,
                  } as Message,
                ]);
              } else {
                const id = tempAssistantId;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === id
                      ? { ...m, content: accumulated, ragSources: sources }
                      : m
                  )
                );
              }
            },
            (stage) => setStreamStage(stage)
          );

          if (result.ok) {
            // 流式结束：把 temp IDs 换成真实 IDs
            const finalAssistantTempId = tempAssistantId;
            setMessages((prev) => {
              let updated = prev.map((m) => {
                if (m.id === tempUserId) {
                  return {
                    ...m,
                    id: result.userMessage.id,
                    content: result.userMessage.content,
                    modelId: result.userMessage.modelId,
                    modelName: result.userMessage.modelName,
                    createdAt: result.userMessage.createdAt,
                  };
                }
                if (finalAssistantTempId && m.id === finalAssistantTempId) {
                  return {
                    ...m,
                    id: result.assistantMessage.id,
                    content: result.assistantMessage.content,
                    modelId: result.assistantMessage.modelId,
                    modelName: result.assistantMessage.modelName,
                    createdAt: result.assistantMessage.createdAt,
                    ragSources: result.ragSources,
                  };
                }
                return m;
              });
              // 兜底：极快模型可能直接 done 而无 chunk → assistant bubble
              // 还没创建 → 这里追加上
              if (!finalAssistantTempId && result.assistantMessage.content) {
                updated = [
                  ...updated,
                  {
                    id: result.assistantMessage.id,
                    role: 'assistant',
                    content: result.assistantMessage.content,
                    modelId: result.assistantMessage.modelId,
                    modelName: result.assistantMessage.modelName,
                    createdAt: result.assistantMessage.createdAt,
                    ragSources: result.ragSources,
                  } as Message,
                ];
              }
              return updated;
            });
            // 注：suggestedActions / IntentRouter 链路 2026-04-30 已删（backend
            // ai-ask.service.ts:46-48 注释），前端这里也不再消费。
          } else {
            if (result.byok) {
              return;
            }
            // 2026-05-10 §4 流式失败：保留 user 气泡，把 thinking 占位替换为
            // **inline 错误气泡**。原"silent filter 双气泡"路径会让用户看见
            // "thinking..." 几秒后整个会话突然变空 → 误以为被登出（screenshot 19）。
            const failedAssistantTempId = tempAssistantId;
            const errorBubble: Message = {
              id: 'error-' + Date.now(),
              role: 'assistant',
              content:
                (result.partialContent
                  ? `${result.partialContent}\n\n---\n\n`
                  : '') + `⚠ ${result.error}`,
              modelId: selectedModel,
              createdAt: new Date().toISOString(),
            };
            setMessages((prev) => {
              if (failedAssistantTempId) {
                return prev.map((m) =>
                  m.id === failedAssistantTempId ? errorBubble : m
                );
              }
              return [...prev, errorBubble];
            });
          }
        } else {
          // Fallback to simple chat if session creation fails
          // Still maintain context from current conversation
          const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: displayContent,
            createdAt: new Date().toISOString(),
          };

          // Get current messages for context before adding new user message
          const currentMessages = messages;
          setMessages((prev) => [...prev, userMessage]);

          const modelName = selectedModelInfo?.modelName || 'gemini';
          // Pass context messages (last 20) for memory
          const contextForAI = currentMessages.slice(-20);
          // Send full content to AI
          const result = await callAIChat(
            modelName,
            userContent,
            webSearchEnabled,
            contextForAI,
            signal
          );

          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: result.content,
              modelId: selectedModel,
              createdAt: new Date().toISOString(),
              ragSources: result.ragSources,
            },
          ]);
        }
      }
    } catch (error) {
      // Ignore abort errors (user stopped generation)
      if ((error as Error).name === 'AbortError') {
        return;
      }
      // BYOK 错误：不往聊天区渲染，全局 Modal 已处理
      if ((error as Error & { __byok?: boolean }).__byok) {
        return;
      }
      logger.error('Error:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'An error occurred'}`,
          modelId: selectedModel,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
      setStreamStage(null);
    }
  };

  const toggleMixtureCollapse = (index: number) => {
    setMixtureResponses((prev) => {
      const newResponses = [...prev];
      newResponses[index] = {
        ...newResponses[index],
        isCollapsed: !newResponses[index].isCollapsed,
      };
      return newResponses;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Stop generation handler
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setStreamStage(null);
  };

  // Build model options: 只呈现「默认聊天 Key」+ Mixture + Self-Driven Team。
  // 默认 Key = pickPreferredModel(chatModels)（用户 BYOK 里 isDefault 的 CHAT/CHAT_FAST 模型）。
  // 其余具体模型不在下拉罗列；默认 Key 不可用时由后端内部自主切换（TaskProfile/选举/fallback）兜底。
  // 注：chatModels 本身保持完整，Mixture 仍按需并发调用多个模型。
  const defaultChatModel = pickPreferredModel(chatModels);
  const modelOptions = [
    ...(defaultChatModel ? [defaultChatModel] : []),
    {
      id: 'mixture',
      name: 'Mixture',
      provider: 'Multi-Model',
      icon: '🔀',
      modelType: 'CHAT' as const,
      isMixture: true,
    },
    {
      id: 'self-driven-team',
      name: t('aiAsk.selfDriven.teamName'),
      provider: 'Agent Harness',
      icon: '',
      modelType: 'CHAT' as const,
      isSelfDriven: true,
    },
  ];

  return (
    <AppShell>
      {/* Session Sidebar */}
      <SessionSidebar
        currentSessionId={currentSessionId || undefined}
        onSelectSession={loadSession}
        onNewSession={handleNewSession}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* BYOK Required Banner — 严格 BYOK 模式下没配 key 调用必败 */}
        {token && chatModels.length > 0 && !userHasBYOK(chatModels) && (
          <div className="px-4 pt-3">
            <BYOKRequiredBanner compact />
          </div>
        )}
        {messages.length === 0 ? (
          /* Welcome Screen */
          <div className="flex flex-1 flex-col">
            {/* Main content area - centered */}
            <div className="flex flex-1 items-center justify-center px-4">
              <div className="w-full max-w-2xl">
                {/* Show login prompt for unauthenticated users */}
                {!token ? (
                  <div className="mb-12 text-center">
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500">
                      <svg
                        className="h-10 w-10 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                    </div>
                    <h1 className="mb-4 text-3xl font-medium text-gray-800 md:text-4xl">
                      {t('aiAsk.login.title')}
                    </h1>
                    <p className="mb-8 text-gray-500">
                      {t('aiAsk.login.description')}
                    </p>
                    <div className="mb-8 flex flex-wrap justify-center gap-3">
                      <span className="rounded-full bg-violet-100 px-3 py-1 text-sm text-violet-700">
                        {t('aiAsk.login.features.multiModel')}
                      </span>
                      <span className="rounded-full bg-purple-100 px-3 py-1 text-sm text-purple-700">
                        {t('aiAsk.login.features.knowledgeBase')}
                      </span>
                      <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-sm text-fuchsia-700">
                        {t('aiAsk.login.features.webSearch')}
                      </span>
                      <span className="rounded-full bg-pink-100 px-3 py-1 text-sm text-pink-700">
                        {t('aiAsk.login.features.sessionHistory')}
                      </span>
                    </div>
                    <button
                      onClick={() => router.push('/login')}
                      className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 px-8 py-3 text-lg font-medium text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
                    >
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                        />
                      </svg>
                      {t('aiAsk.login.button')}
                    </button>
                  </div>
                ) : (
                  <h1 className="mb-12 text-center text-4xl font-light text-gray-800 md:text-5xl">
                    <span className="bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 bg-clip-text text-transparent">
                      {greeting}
                    </span>
                    {user?.username && (
                      <span className="text-gray-700">
                        , {user.username?.split(' ')?.[0] || user.username}
                      </span>
                    )}
                  </h1>
                )}

                {/* Input Box and Quote - Only show when logged in */}
                {token && (
                  <>
                    <div className="relative">
                      <div className="rounded-3xl border border-gray-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all focus-within:border-purple-300 focus-within:shadow-[0_8px_40px_rgba(139,92,246,0.2)] hover:shadow-[0_8px_40px_rgb(0,0,0,0.16)]">
                        <textarea
                          ref={inputRef}
                          value={input}
                          onChange={handleInputChange}
                          onKeyDown={handleKeyDown}
                          placeholder="Ask anything..."
                          rows={2}
                          className="w-full resize-none rounded-t-3xl bg-transparent px-6 py-5 text-lg text-gray-900 placeholder-gray-400 focus:outline-none"
                          disabled={isLoading || modelsLoading}
                        />

                        <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
                          <div className="flex items-center gap-2">
                            {/* Model Selector */}
                            <div className="relative" ref={modelSelectorRef}>
                              <button
                                type="button"
                                onClick={() =>
                                  setShowModelSelector(!showModelSelector)
                                }
                                disabled={modelsLoading}
                                className="flex max-w-[220px] items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
                              >
                                {modelsLoading ? (
                                  <span className="text-gray-400">
                                    Loading...
                                  </span>
                                ) : (
                                  <>
                                    {isMixtureMode ||
                                    isSelfDrivenMode ? null : selectedModelInfo ? (
                                      <ModelIcon
                                        model={selectedModelInfo}
                                        size={16}
                                      />
                                    ) : (
                                      <span>🤖</span>
                                    )}
                                    <span
                                      className="min-w-0 truncate"
                                      title={
                                        isSelfDrivenMode
                                          ? t('aiAsk.selfDriven.teamName')
                                          : isMixtureMode
                                            ? 'Mixture'
                                            : selectedModelInfo?.name
                                      }
                                    >
                                      {isSelfDrivenMode
                                        ? t('aiAsk.selfDriven.teamName')
                                        : isMixtureMode
                                          ? 'Mixture'
                                          : selectedModelInfo?.name || 'Select'}
                                    </span>
                                    <svg
                                      className="h-4 w-4 shrink-0 text-gray-400"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 9l-7 7-7-7"
                                      />
                                    </svg>
                                  </>
                                )}
                              </button>

                              {showModelSelector && (
                                <div className="absolute bottom-full left-0 z-50 mb-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl">
                                  <div className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                    Chat Models
                                  </div>
                                  {modelOptions.map((model) => (
                                    <button
                                      key={model.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedModel(model.id);
                                        setShowModelSelector(false);
                                      }}
                                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-gray-50 ${
                                        selectedModel === model.id
                                          ? 'bg-purple-50'
                                          : ''
                                      }`}
                                    >
                                      <ModelIcon model={model} size={16} />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="truncate text-sm font-medium text-gray-900"
                                            title={model.name}
                                          >
                                            {model.name}
                                          </span>
                                          <ModelBadges model={model} />
                                        </div>
                                        <ModelKeyMeta model={model} />
                                      </div>
                                      {selectedModel === model.id && (
                                        <svg
                                          className="h-4 w-4 shrink-0 text-purple-600"
                                          fill="currentColor"
                                          viewBox="0 0 20 20"
                                        >
                                          <path
                                            fillRule="evenodd"
                                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                            clipRule="evenodd"
                                          />
                                        </svg>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Web Search Toggle */}
                            <button
                              type="button"
                              onClick={() =>
                                setWebSearchEnabled(!webSearchEnabled)
                              }
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                                webSearchEnabled
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'text-gray-500 hover:bg-gray-100'
                              }`}
                              title={
                                webSearchEnabled
                                  ? 'Web search enabled'
                                  : 'Web search disabled'
                              }
                            >
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                                />
                              </svg>
                              <span>{t('aiAsk.webSearch')}</span>
                              {webSearchEnabled && (
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </button>

                            {/* Knowledge Base Selector */}
                            <KnowledgeBaseSelector
                              selectedIds={selectedKnowledgeBases}
                              onSelectionChange={setSelectedKnowledgeBases}
                              multiple={true}
                              maxSelections={3}
                              compact={true}
                              onlyReady={false}
                              disabled={isLoading}
                            />

                            {/* Teams Mode Button (W4 PR6) — 与"知识库"同组，置于工具按钮之前 */}
                            <AskTeamsButton />

                            {/* Tools Button */}
                            <AskToolsButton />
                          </div>

                          {/* Send/Stop Button */}
                          <button
                            type="button"
                            onClick={() =>
                              isLoading
                                ? handleStopGeneration()
                                : handleSubmit()
                            }
                            disabled={
                              !isLoading &&
                              ((!input.trim() &&
                                attachedFiles.length === 0 &&
                                !quotedMessage) ||
                                modelsLoading)
                            }
                            className={`flex h-9 w-9 items-center justify-center rounded-xl text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                              isLoading
                                ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700'
                                : 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700'
                            }`}
                            title={
                              isLoading ? 'Stop generation' : 'Send message'
                            }
                          >
                            {isLoading ? (
                              <svg
                                className="h-5 w-5"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <rect
                                  x="6"
                                  y="6"
                                  width="12"
                                  height="12"
                                  rx="1"
                                />
                              </svg>
                            ) : (
                              <svg
                                className="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                                />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>

                      <p className="mt-3 text-center text-xs text-gray-400">
                        Press Enter to send, Shift+Enter for new line
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Inspirational Quote - Bottom of main content area */}
            {token && (
              <div className="flex-shrink-0">
                <QuoteCard quote={randomQuote} />
              </div>
            )}
          </div>
        ) : (
          /* Chat Messages */
          <div className="relative flex-1 overflow-hidden">
            <div
              className={`h-full overflow-y-auto px-4 pt-6 ${
                isSelfDrivenMode ? 'pb-48' : 'pb-32'
              }`}
            >
              <div
                className={`mx-auto space-y-6 ${
                  isSelfDrivenMode ? 'max-w-6xl' : 'max-w-4xl'
                }`}
              >
                {messages.map((message) => {
                  const messageModel = chatModels.find(
                    (m) => m.id === message.modelId
                  );
                  return (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[90%] rounded-2xl px-4 py-3 ${
                          message.role === 'user'
                            ? userMessageStyle
                            : aiMessageStyle
                        }`}
                        onContextMenu={(e) => {
                          if (message.role === 'assistant') {
                            // 检查是否有选中文本
                            const selection = window.getSelection();
                            const hasSelection =
                              selection &&
                              selection.toString().trim().length > 0;

                            // 如果有选中文本，使用浏览器原生菜单（可以复制选中内容）
                            if (hasSelection) {
                              return;
                            }

                            // 没有选中文本时，显示自定义菜单
                            e.preventDefault();
                            setContextMenu({
                              message,
                              position: { x: e.clientX, y: e.clientY },
                            });
                          }
                        }}
                      >
                        {message.role === 'assistant' &&
                          (message.modelId || message.modelName) && (
                            <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                              {messageModel ? (
                                <ModelIcon model={messageModel} size={14} />
                              ) : (
                                <span>🤖</span>
                              )}
                              <span>
                                {message.modelName ||
                                  messageModel?.name ||
                                  'AI'}
                              </span>
                            </div>
                          )}
                        {message.role === 'assistant' ? (
                          <CollapsibleMessage maxHeight={600}>
                            <div className="prose prose-sm max-w-none">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
                                components={{
                                  blockquote: CollapsibleBlockquote,
                                  code: CodeBlock as React.ComponentType<
                                    React.HTMLAttributes<HTMLElement>
                                  >,
                                }}
                              >
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          </CollapsibleMessage>
                        ) : (
                          <div className="whitespace-pre-wrap break-words">
                            {message.content}
                          </div>
                        )}
                        {/* RAG Sources - 可折叠组件 */}
                        {message.role === 'assistant' &&
                          message.ragSources &&
                          message.ragSources.length > 0 && (
                            <CollapsibleRagSources
                              sources={message.ragSources}
                              maxSources={5}
                              defaultExpanded={false}
                            />
                          )}
                        {/* AI OS Action Cards */}
                        {message.role === 'assistant' &&
                          messageSuggestions.has(message.id) && (
                            <ActionCards
                              actions={messageSuggestions.get(message.id)!}
                            />
                          )}
                        {/* Action buttons for assistant messages */}
                        {message.role === 'assistant' && (
                          <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(message.content);
                                setToastMessage('已复制到剪贴板');
                              }}
                              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                              title="复制内容"
                            >
                              <svg
                                className="h-3.5 w-3.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                              复制
                            </button>
                            <button
                              onClick={() => {
                                // 设置引用消息显示在输入框上方
                                const preview =
                                  message.content
                                    .substring(0, 100)
                                    .replace(/\n/g, ' ') +
                                  (message.content.length > 100 ? '...' : '');
                                setQuotedMessage({
                                  content: message.content,
                                  preview,
                                });
                                inputRef.current?.focus();
                                setToastMessage('已添加引用');
                              }}
                              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                              title="引用回复"
                            >
                              <svg
                                className="h-3.5 w-3.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                                />
                              </svg>
                              引用
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Self-Driven Team stream output */}
                {(selfDriven.events.length > 0 ||
                  (isLoading && isSelfDrivenMode)) && (
                  <div className="flex w-full justify-start">
                    <div className="w-full max-w-[95%] rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100">
                      <SelfDrivenStream
                        events={selfDriven.events}
                        isStreaming={
                          isLoading &&
                          isSelfDrivenMode &&
                          !selfDriven.events.some(
                            (e) => e.type === 'done' || e.type === 'error'
                          )
                        }
                        token={token ?? ''}
                      />
                    </div>
                  </div>
                )}

                {/* Mixture Responses - show when there are responses (loading or completed) */}
                {mixtureResponses.length > 0 && (
                  <div className="space-y-3">
                    {mixtureResponses.map((response, index) => {
                      const modelInfo = chatModels.find(
                        (m) => m.id === response.modelId
                      );
                      return (
                        <div
                          key={index}
                          className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-100"
                        >
                          <button
                            onClick={() => toggleMixtureCollapse(index)}
                            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                          >
                            <div className="flex items-center gap-2">
                              {modelInfo ? (
                                <ModelIcon model={modelInfo} size={20} />
                              ) : (
                                <span className="text-lg">🤖</span>
                              )}
                              <span className="font-medium text-gray-900">
                                {response.model}
                              </span>
                              {!response.content && (
                                <span className="flex items-center gap-1 text-xs text-gray-400">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500" />
                                  Thinking...
                                </span>
                              )}
                            </div>
                            <svg
                              className={`h-5 w-5 text-gray-400 transition-transform ${response.isCollapsed ? '' : 'rotate-180'}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </button>
                          {!response.isCollapsed && response.content && (
                            <div className="border-t border-gray-100 px-4 py-3">
                              <CollapsibleMessage maxHeight={400}>
                                <div className="prose prose-sm max-w-none">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm, remarkMath]}
                                    rehypePlugins={[
                                      [rehypeKatex, KATEX_OPTIONS],
                                    ]}
                                    components={{
                                      blockquote: CollapsibleBlockquote,
                                      code: CodeBlock as React.ComponentType<
                                        React.HTMLAttributes<HTMLElement>
                                      >,
                                    }}
                                  >
                                    {response.content}
                                  </ReactMarkdown>
                                </div>
                              </CollapsibleMessage>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Single model loading — 2026-05-10 §4：流式期间一旦
                    temp-assistant 出现就隐藏，避免与流式 bubble 重叠错位 */}
                {isLoading &&
                  !isMixtureMode &&
                  !isSelfDrivenMode &&
                  !messages.some(
                    (m) =>
                      m.role === 'assistant' &&
                      m.id.startsWith('temp-assistant-')
                  ) && (
                    <div className="flex justify-start">
                      <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <span
                              className="h-2 w-2 animate-bounce rounded-full bg-purple-500"
                              style={{ animationDelay: '0ms' }}
                            />
                            <span
                              className="h-2 w-2 animate-bounce rounded-full bg-purple-500"
                              style={{ animationDelay: '150ms' }}
                            />
                            <span
                              className="h-2 w-2 animate-bounce rounded-full bg-purple-500"
                              style={{ animationDelay: '300ms' }}
                            />
                          </div>
                          <span className="text-sm text-gray-500">
                            {streamStage === 'rag'
                              ? webSearchEnabled
                                ? t('aiAsk.messages.webSearching')
                                : t('aiAsk.messages.knowledgeSearching')
                              : streamStage === 'generating'
                                ? t('aiAsk.messages.generating')
                                : t('aiAsk.messages.thinking')}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Floating Bottom Input */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-gray-50 via-gray-50/95 to-transparent px-4 pb-4 pt-8">
              <div className="pointer-events-auto mx-auto max-w-4xl">
                <form onSubmit={handleSubmit}>
                  <div
                    className={`rounded-2xl border bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all focus-within:border-purple-300 focus-within:shadow-[0_8px_40px_rgba(139,92,246,0.2)] hover:shadow-[0_8px_40px_rgb(0,0,0,0.16)] ${
                      isDragging
                        ? 'border-purple-500 ring-2 ring-purple-200'
                        : 'border-gray-100'
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                  >
                    {/* Drag overlay */}
                    {isDragging && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-purple-50/90">
                        <div className="text-center">
                          <svg
                            className="mx-auto h-10 w-10 text-purple-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                            />
                          </svg>
                          <p className="mt-2 text-sm font-medium text-purple-600">
                            拖放文件到此处
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Quoted message preview - displayed ABOVE the input area */}
                    {quotedMessage && (
                      <div className="flex items-start gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
                        <div className="flex-shrink-0 pt-0.5">
                          <svg
                            className="h-4 w-4 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                            />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-500">
                            引用回复
                          </p>
                          <p className="mt-0.5 truncate text-sm text-gray-700">
                            {quotedMessage.preview}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setQuotedMessage(null)}
                          className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* Attached files preview */}
                    {attachedFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2 px-4 pt-3">
                        {attachedFiles.map((item, index) => (
                          <div key={index} className="group relative">
                            {item.preview ? (
                              /* Image thumbnail */
                              <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
                                <img
                                  src={item.preview}
                                  alt={item.file.name}
                                  className="h-full w-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeFile(index)}
                                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                >
                                  <svg
                                    className="h-3 w-3"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M6 18L18 6M6 6l12 12"
                                    />
                                  </svg>
                                </button>
                              </div>
                            ) : (
                              /* Non-image file */
                              <div className="flex h-16 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3">
                                <svg
                                  className="h-6 w-6 text-blue-500"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                  />
                                </svg>
                                <div className="min-w-0 flex-1">
                                  <p className="max-w-[100px] truncate text-xs font-medium text-gray-700">
                                    {item.file.name}
                                  </p>
                                  <p className="text-[10px] text-gray-400">
                                    {(item.file.size / 1024).toFixed(1)} KB
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeFile(index)}
                                  className="text-gray-400 hover:text-gray-600"
                                >
                                  <svg
                                    className="h-4 w-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M6 18L18 6M6 6l12 12"
                                    />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      maxLength={10000}
                      placeholder={
                        attachedFiles.length > 0
                          ? '添加消息描述这些文件...'
                          : 'Ask anything...'
                      }
                      rows={2}
                      className="w-full resize-none rounded-t-2xl bg-transparent px-4 py-4 text-gray-900 placeholder-gray-400 focus:outline-none"
                      disabled={isLoading}
                    />

                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.txt,.json,.md,.py,.js,.ts,.tsx,.jsx,.csv,.xml,.yaml,.yml"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0) {
                          addFilesWithPreviews(files);
                          setToastMessage(`已添加 ${files.length} 个文件`);
                        }
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
                      <div className="flex items-center gap-2">
                        {/* Model selector with dropdown */}
                        <div className="relative" ref={modelSelectorRef}>
                          <button
                            type="button"
                            onClick={() =>
                              setShowModelSelector(!showModelSelector)
                            }
                            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                          >
                            {isMixtureMode ||
                            isSelfDrivenMode ? null : selectedModelInfo ? (
                              <ModelIcon model={selectedModelInfo} size={16} />
                            ) : (
                              <span>🤖</span>
                            )}
                            <span>
                              {isSelfDrivenMode
                                ? t('aiAsk.selfDriven.teamName')
                                : isMixtureMode
                                  ? 'Mixture'
                                  : selectedModelInfo?.name || 'Model'}
                            </span>
                            <svg
                              className="h-4 w-4 text-gray-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </button>

                          {showModelSelector && (
                            <div className="absolute bottom-full left-0 z-50 mb-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl">
                              <div className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                Chat Models
                              </div>
                              {modelOptions.map((model) => (
                                <button
                                  key={model.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedModel(model.id);
                                    setShowModelSelector(false);
                                  }}
                                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-gray-50 ${
                                    selectedModel === model.id
                                      ? 'bg-purple-50'
                                      : ''
                                  }`}
                                >
                                  <ModelIcon model={model} size={16} />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="truncate text-sm font-medium text-gray-900">
                                        {model.name}
                                      </span>
                                      <ModelBadges model={model} />
                                    </div>
                                    <ModelKeyMeta model={model} />
                                  </div>
                                  {selectedModel === model.id && (
                                    <svg
                                      className="h-4 w-4 shrink-0 text-purple-600"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* File Upload Button */}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                            attachedFiles.length > 0
                              ? 'bg-green-50 text-green-600'
                              : 'text-gray-400 hover:bg-gray-100'
                          }`}
                          title="上传文件或图片"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                            />
                          </svg>
                          {attachedFiles.length > 0 && (
                            <span className="rounded-full bg-green-100 px-1.5 text-xs">
                              {attachedFiles.length}
                            </span>
                          )}
                        </button>

                        {/* Web Search Toggle */}
                        <button
                          type="button"
                          onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                            webSearchEnabled
                              ? 'bg-blue-50 text-blue-600'
                              : 'text-gray-500 hover:bg-gray-100'
                          }`}
                          title={
                            webSearchEnabled
                              ? 'Web search enabled'
                              : 'Web search disabled'
                          }
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                            />
                          </svg>
                          <span>{t('aiAsk.webSearch')}</span>
                          {webSearchEnabled && (
                            <svg
                              className="h-3.5 w-3.5"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </button>

                        {/* Knowledge Base Selector */}
                        <KnowledgeBaseSelector
                          selectedIds={selectedKnowledgeBases}
                          onSelectionChange={setSelectedKnowledgeBases}
                          multiple={true}
                          maxSelections={3}
                          compact={true}
                          onlyReady={false}
                          disabled={isLoading}
                        />

                        {/* Teams Mode Button (W4 PR6) — 与"知识库"同组，置于工具按钮之前 */}
                        <AskTeamsButton />

                        {/* Tools Button */}
                        <AskToolsButton />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          if (isLoading) {
                            handleStopGeneration();
                          } else {
                            handleSubmit();
                          }
                        }}
                        disabled={
                          !isLoading &&
                          !input.trim() &&
                          attachedFiles.length === 0 &&
                          !quotedMessage
                        }
                        className={`flex h-9 w-9 items-center justify-center rounded-xl text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                          isLoading
                            ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700'
                            : 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700'
                        }`}
                        title={isLoading ? 'Stop generation' : 'Send message'}
                      >
                        {isLoading ? (
                          <svg
                            className="h-5 w-5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                          </svg>
                        ) : (
                          <svg
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Context Menu */}
      {contextMenu && (
        <MessageContextMenu
          message={contextMenu.message}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onCopy={() => {
            navigator.clipboard.writeText(contextMenu.message.content);
            setContextMenu(null);
            setToastMessage('已复制到剪贴板');
          }}
          onQuote={() => {
            // 设置引用消息显示在输入框上方
            const preview =
              contextMenu.message.content
                .substring(0, 100)
                .replace(/\n/g, ' ') +
              (contextMenu.message.content.length > 100 ? '...' : '');
            setQuotedMessage({ content: contextMenu.message.content, preview });
            setContextMenu(null);
            inputRef.current?.focus();
            setToastMessage('已添加引用');
          }}
          onSave={() => {
            setContextMenu(null);
            setToastMessage('收藏功能即将推出');
          }}
        />
      )}

      {/* Toast notification */}
      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </AppShell>
  );
}

/**
 * PPT模板配置
 * 参考业界最佳实践：Genspark, Gamma, Canva, Adobe Express
 * V2.0 - 增强版：深色主题 + 卡片式布局 + 丰富装饰元素
 */

export interface PPTTemplate {
  id: string;
  name: string;
  nameCn: string;
  description: string;
  descriptionCn: string;
  category:
    | 'corporate'
    | 'minimal'
    | 'modern'
    | 'creative'
    | 'academic'
    | 'premium';
  // 增强的颜色体系 - 支持深色主题和多层次文字
  colors: {
    primary: string; // 主色
    secondary: string; // 辅色
    accent: string; // 强调色
    accentSecondary?: string; // 第二强调色（用于渐变）
    background: string; // 背景色
    backgroundGradient?: string; // 背景渐变（CSS渐变语法）
    backgroundOverlay?: string; // 背景覆盖层（半透明渐变）
    text: string; // 主文字色
    textLight: string; // 浅色文字（用于深色背景）
    textSecondary: string; // 次要文字
    textTertiary: string; // 三级文字（最浅）
    decorative: string; // 装饰色（装饰条、强调线等）
    cardBackground?: string; // 卡片背景色
    glow?: string; // 光晕颜色
    border?: string; // 边框颜色
  };
  fonts: {
    heading: string; // 标题字体
    body: string; // 正文字体
    mono?: string; // 等宽字体（代码/数据）
  };
  // 文字大小层次体系（单位：pt）
  typography: {
    title: number; // 主标题 (26-36pt)
    titleWeight?: number; // 标题字重
    titleLetterSpacing?: string; // 标题字间距
    subtitle: number; // 副标题 (18-24pt)
    heading1: number; // 一级标题 (16pt)
    heading2: number; // 二级标题 (13-15pt)
    body: number; // 正文 (12pt)
    bodyLineHeight?: number; // 正文行高
    caption: number; // 说明文字 (10-11pt)
    small: number; // 小字/页码 (9pt)
  };
  // 装饰元素配置（增强版）
  decorations: {
    showTopBar: boolean; // 顶部装饰条
    showBottomBar: boolean; // 底部装饰条
    showTitleUnderline: boolean; // 标题下划线
    showCardBorder: boolean; // 卡片左侧边框
    useCardLayout: boolean; // 使用卡片式布局
    // 高级装饰选项
    enableGlowEffects?: boolean; // 启用光晕效果
    enableGradientBars?: boolean; // 渐变装饰条
    enableCornerAccents?: boolean; // 角落装饰
    enableGeometricShapes?: boolean; // 几何装饰图形
    topBarHeight?: string; // 顶部条高度
    cornerGlowSize?: string; // 角落光晕大小
    cornerGlowOpacity?: number; // 角落光晕透明度
  };
  style: {
    borderRadius: string; // 圆角大小
    spacing: 'compact' | 'normal' | 'spacious'; // 间距
    imageStyle: 'rounded' | 'sharp' | 'circle'; // 图片样式
    layoutStyle: 'light' | 'dark'; // 明暗风格
    // 高级样式选项
    cardShadow?: string; // 卡片阴影
    cardBorderRadius?: string; // 卡片圆角
    contentPadding?: string; // 内容内边距
  };
}

/**
 * 预定义模板库
 */
export const PPT_TEMPLATES: Record<string, PPTTemplate> = {
  // 1. 企业商务模板 - 专业深色 Genspark风格
  corporate: {
    id: 'corporate',
    name: 'Corporate Professional',
    nameCn: '企业商务',
    description: 'Professional dark theme inspired by Genspark',
    descriptionCn: '专业深色风格，适合商务演示、财务报告、企业汇报',
    category: 'corporate',
    colors: {
      primary: '#0A2B4E', // 深海军蓝 (Genspark背景色)
      secondary: '#164577', // 中蓝
      accent: '#3B82F6', // 亮蓝色强调
      background: '#0A2B4E', // 深色背景
      backgroundOverlay: 'rgba(22, 69, 119, 0.5)', // 半透明覆盖层
      text: '#E5E7EB', // 浅灰正文
      textLight: '#FFFFFF', // 白色标题
      textSecondary: '#93C5FD', // 浅蓝副标题
      textTertiary: '#9CA3AF', // 灰色次要文字
      decorative: '#3B82F6', // 蓝色装饰
      cardBackground: 'rgba(255, 255, 255, 0.1)', // 10%透明白色卡片
    },
    fonts: {
      heading: 'Noto Sans SC, Inter, system-ui, sans-serif',
      body: 'Noto Sans SC, Inter, system-ui, sans-serif',
    },
    typography: {
      title: 36, // 主标题
      subtitle: 22, // 副标题
      heading1: 16, // 一级标题
      heading2: 15, // 二级标题
      body: 12, // 正文
      caption: 11, // 说明
      small: 10, // 小字
    },
    decorations: {
      showTopBar: false,
      showBottomBar: true, // 底部蓝色装饰条
      showTitleUnderline: true, // 标题下划线
      showCardBorder: true, // 卡片左侧边框
      useCardLayout: true, // 使用卡片布局
    },
    style: {
      borderRadius: '8px',
      spacing: 'normal',
      imageStyle: 'rounded',
      layoutStyle: 'dark', // 深色风格
    },
  },

  // 2. 简约现代模板 - 黑白极简
  minimal: {
    id: 'minimal',
    name: 'Minimal Clean',
    nameCn: '简约现代',
    description: 'Clean monochrome design with minimal distractions',
    descriptionCn: '黑白极简，适合产品发布、设计展示、创意提案',
    category: 'minimal',
    colors: {
      primary: '#000000', // 纯黑
      secondary: '#374151', // 深灰
      accent: '#10B981', // 翠绿强调
      background: '#FFFFFF', // 白色背景
      backgroundOverlay: 'rgba(0, 0, 0, 0.02)', // 微妙灰色覆盖
      text: '#111827', // 深灰黑
      textLight: '#FFFFFF', // 白色
      textSecondary: '#6B7280', // 中灰
      textTertiary: '#9CA3AF', // 浅灰
      decorative: '#000000', // 黑色装饰
      cardBackground: 'rgba(0, 0, 0, 0.03)', // 浅灰卡片
    },
    fonts: {
      heading: 'system-ui, -apple-system, sans-serif',
      body: 'system-ui, -apple-system, sans-serif',
    },
    typography: {
      title: 40,
      subtitle: 24,
      heading1: 18,
      heading2: 14,
      body: 12,
      caption: 10,
      small: 9,
    },
    decorations: {
      showTopBar: false,
      showBottomBar: false,
      showTitleUnderline: false,
      showCardBorder: true, // 细黑色左边框
      useCardLayout: false, // 极简不用卡片
    },
    style: {
      borderRadius: '2px', // 极小圆角
      spacing: 'spacious',
      imageStyle: 'sharp', // 锐利边缘
      layoutStyle: 'light',
    },
  },

  // 3. 现代渐变模板 - 时尚活力
  modern: {
    id: 'modern',
    name: 'Modern Gradient',
    nameCn: '现代渐变',
    description: 'Contemporary design with vibrant gradients',
    descriptionCn: '现代时尚，适合科技产品、创业路演、趋势分析',
    category: 'modern',
    colors: {
      primary: '#6366F1', // 靛蓝
      secondary: '#8B5CF6', // 紫色
      accent: '#EC4899', // 粉红
      background: '#F9FAFB', // 浅灰背景
      backgroundOverlay:
        'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1))',
      text: '#1F2937', // 深灰
      textLight: '#FFFFFF', // 白色
      textSecondary: '#8B5CF6', // 紫色
      textTertiary: '#9CA3AF', // 浅灰
      decorative: '#6366F1', // 靛蓝装饰
      cardBackground: 'rgba(255, 255, 255, 0.8)', // 半透明白卡片
    },
    fonts: {
      heading: 'Poppins, Inter, sans-serif',
      body: 'Inter, system-ui, sans-serif',
    },
    typography: {
      title: 38,
      subtitle: 22,
      heading1: 17,
      heading2: 14,
      body: 12,
      caption: 11,
      small: 9,
    },
    decorations: {
      showTopBar: true, // 渐变顶部条
      showBottomBar: false,
      showTitleUnderline: false,
      showCardBorder: true, // 渐变左边框
      useCardLayout: true,
    },
    style: {
      borderRadius: '12px',
      spacing: 'normal',
      imageStyle: 'rounded',
      layoutStyle: 'light',
    },
  },

  // 4. 创意活泼模板 - 多彩个性
  creative: {
    id: 'creative',
    name: 'Creative Vibrant',
    nameCn: '创意活泼',
    description: 'Colorful and expressive design',
    descriptionCn: '色彩丰富，适合创意设计、营销策划、品牌宣传',
    category: 'creative',
    colors: {
      primary: '#F59E0B', // 橙色
      secondary: '#EF4444', // 红色
      accent: '#8B5CF6', // 紫色
      background: '#FFFBEB', // 浅黄背景
      backgroundOverlay: 'rgba(245, 158, 11, 0.05)',
      text: '#1F2937', // 深灰
      textLight: '#FFFFFF', // 白色
      textSecondary: '#F59E0B', // 橙色
      textTertiary: '#9CA3AF', // 浅灰
      decorative: '#EF4444', // 红色装饰
      cardBackground: 'rgba(255, 255, 255, 0.9)',
    },
    fonts: {
      heading: 'Montserrat, sans-serif',
      body: 'Open Sans, sans-serif',
    },
    typography: {
      title: 36,
      subtitle: 20,
      heading1: 16,
      heading2: 14,
      body: 12,
      caption: 10,
      small: 9,
    },
    decorations: {
      showTopBar: true,
      showBottomBar: true, // 多彩装饰条
      showTitleUnderline: true,
      showCardBorder: true,
      useCardLayout: true,
    },
    style: {
      borderRadius: '16px', // 大圆角
      spacing: 'normal',
      imageStyle: 'rounded',
      layoutStyle: 'light',
    },
  },

  // 5. 学术专业模板 - 严谨清晰
  academic: {
    id: 'academic',
    name: 'Academic Professional',
    nameCn: '学术专业',
    description: 'Formal design for academic presentations',
    descriptionCn: '严谨清晰，适合学术报告、研究成果、教学演示',
    category: 'academic',
    colors: {
      primary: '#1E3A8A', // 深蓝
      secondary: '#0F766E', // 青色
      accent: '#059669', // 绿色
      background: '#FFFFFF', // 白色背景
      backgroundOverlay: 'rgba(30, 58, 138, 0.02)',
      text: '#374151', // 深灰
      textLight: '#FFFFFF', // 白色
      textSecondary: '#1E3A8A', // 深蓝
      textTertiary: '#9CA3AF', // 浅灰
      decorative: '#1E3A8A', // 深蓝装饰
      cardBackground: 'rgba(30, 58, 138, 0.05)', // 浅蓝卡片
    },
    fonts: {
      heading: 'Georgia, serif',
      body: 'system-ui, sans-serif',
    },
    typography: {
      title: 34,
      subtitle: 20,
      heading1: 16,
      heading2: 14,
      body: 12,
      caption: 10,
      small: 9,
    },
    decorations: {
      showTopBar: false,
      showBottomBar: true, // 细蓝色底部线
      showTitleUnderline: true,
      showCardBorder: false,
      useCardLayout: false, // 学术风格不用卡片
    },
    style: {
      borderRadius: '4px',
      spacing: 'normal',
      imageStyle: 'sharp',
      layoutStyle: 'light',
    },
  },

  // 6. 科技蓝模板 - 科技专业
  tech: {
    id: 'tech',
    name: 'Tech Blue',
    nameCn: '科技蓝',
    description: 'Modern tech-focused blue design',
    descriptionCn: '科技感十足，适合技术分享、产品演示、数据分析',
    category: 'modern',
    colors: {
      primary: '#0EA5E9', // 天蓝
      secondary: '#0284C7', // 深蓝
      accent: '#06B6D4', // 青色
      background: '#F8FAFC', // 浅蓝灰
      backgroundOverlay: 'rgba(14, 165, 233, 0.05)',
      text: '#0F172A', // 深蓝黑
      textLight: '#FFFFFF', // 白色
      textSecondary: '#0EA5E9', // 天蓝
      textTertiary: '#64748B', // 灰蓝
      decorative: '#06B6D4', // 青色装饰
      cardBackground: 'rgba(255, 255, 255, 0.8)',
    },
    fonts: {
      heading: 'Roboto, sans-serif',
      body: 'Roboto, sans-serif',
    },
    typography: {
      title: 36,
      subtitle: 22,
      heading1: 16,
      heading2: 14,
      body: 12,
      caption: 10,
      small: 9,
    },
    decorations: {
      showTopBar: true, // 蓝色顶部线
      showBottomBar: false,
      showTitleUnderline: true,
      showCardBorder: true,
      useCardLayout: true,
    },
    style: {
      borderRadius: '8px',
      spacing: 'normal',
      imageStyle: 'rounded',
      layoutStyle: 'light',
    },
  },

  // 🆕 7. 文献综述模板 - 学术研究专用
  'literature-review': {
    id: 'literature-review',
    name: 'Literature Review',
    nameCn: '文献综述',
    description: 'Academic literature review with citation focus',
    descriptionCn: '学术文献综述专用，强调引用和证据链',
    category: 'academic',
    colors: {
      primary: '#1E40AF', // 学术蓝
      secondary: '#3B82F6', // 中蓝
      accent: '#F59E0B', // 金色强调（重要发现）
      background: '#FFFFFF', // 白色背景
      backgroundOverlay: 'rgba(30, 64, 175, 0.03)',
      text: '#1F2937', // 深灰
      textLight: '#FFFFFF', // 白色
      textSecondary: '#1E40AF', // 学术蓝
      textTertiary: '#6B7280', // 灰色
      decorative: '#F59E0B', // 金色装饰
      cardBackground: 'rgba(59, 130, 246, 0.05)',
    },
    fonts: {
      heading: 'Noto Serif SC, Georgia, serif', // 衬线字体更学术
      body: 'Noto Sans SC, system-ui, sans-serif',
    },
    typography: {
      title: 32,
      subtitle: 20,
      heading1: 16,
      heading2: 14,
      body: 11, // 略小，适合文献内容
      caption: 10,
      small: 9,
    },
    decorations: {
      showTopBar: false,
      showBottomBar: true, // 金色底部线
      showTitleUnderline: true,
      showCardBorder: true, // 左侧金色边框
      useCardLayout: true,
    },
    style: {
      borderRadius: '4px', // 较小圆角，更正式
      spacing: 'compact', // 紧凑间距，容纳更多内容
      imageStyle: 'sharp',
      layoutStyle: 'light',
    },
  },

  // 🆕 8. 学术会议模板 - 演讲展示
  conference: {
    id: 'conference',
    name: 'Academic Conference',
    nameCn: '学术会议',
    description: 'Conference presentation with clear structure',
    descriptionCn: '学术会议演讲，结构清晰、数据突出',
    category: 'academic',
    colors: {
      primary: '#064E3B', // 深绿（严谨）
      secondary: '#059669', // 翠绿
      accent: '#DC2626', // 红色强调（关键数据）
      background: '#F9FAFB', // 浅灰背景
      backgroundOverlay: 'rgba(6, 78, 59, 0.03)',
      text: '#111827', // 深黑
      textLight: '#FFFFFF', // 白色
      textSecondary: '#059669', // 绿色
      textTertiary: '#6B7280', // 灰色
      decorative: '#DC2626', // 红色装饰
      cardBackground: '#FFFFFF',
    },
    fonts: {
      heading: 'Noto Sans SC, Helvetica, sans-serif',
      body: 'Noto Sans SC, Helvetica, sans-serif',
    },
    typography: {
      title: 34,
      subtitle: 21,
      heading1: 17,
      heading2: 15,
      body: 12,
      caption: 10,
      small: 9,
    },
    decorations: {
      showTopBar: true, // 绿色顶部线
      showBottomBar: true, // 双线装饰
      showTitleUnderline: false,
      showCardBorder: true,
      useCardLayout: true,
    },
    style: {
      borderRadius: '6px',
      spacing: 'normal',
      imageStyle: 'rounded',
      layoutStyle: 'light',
    },
  },

  // 🆕 9. 系统架构设计模板 - 技术架构
  architecture: {
    id: 'architecture',
    name: 'System Architecture',
    nameCn: '系统架构',
    description: 'Technical architecture design with diagrams',
    descriptionCn: '系统架构设计，强调流程图和模块关系',
    category: 'corporate',
    colors: {
      primary: '#1F2937', // 深灰（技术感）
      secondary: '#374151', // 中灰
      accent: '#8B5CF6', // 紫色强调（架构重点）
      background: '#FFFFFF', // 白色背景
      backgroundOverlay: 'rgba(31, 41, 55, 0.02)',
      text: '#111827', // 深黑
      textLight: '#FFFFFF', // 白色
      textSecondary: '#8B5CF6', // 紫色
      textTertiary: '#6B7280', // 灰色
      decorative: '#8B5CF6', // 紫色装饰
      cardBackground: 'rgba(139, 92, 246, 0.05)',
    },
    fonts: {
      heading: 'Fira Code, Consolas, monospace', // 等宽字体（代码风格）
      body: 'Roboto, system-ui, sans-serif',
    },
    typography: {
      title: 32,
      subtitle: 20,
      heading1: 16,
      heading2: 14,
      body: 11,
      caption: 10,
      small: 9,
    },
    decorations: {
      showTopBar: true, // 紫色顶部线
      showBottomBar: false,
      showTitleUnderline: true,
      showCardBorder: true,
      useCardLayout: true,
    },
    style: {
      borderRadius: '8px',
      spacing: 'spacious', // 宽松间距，适合图表
      imageStyle: 'sharp', // 架构图用锐角
      layoutStyle: 'light',
    },
  },

  // 🆕 10. 代码审查模板 - 技术评审
  'code-review': {
    id: 'code-review',
    name: 'Code Review',
    nameCn: '代码审查',
    description: 'Technical code review and analysis',
    descriptionCn: '代码审查/技术评审，突出问题和建议',
    category: 'corporate',
    colors: {
      primary: '#0F172A', // 深蓝黑（代码编辑器风格）
      secondary: '#1E293B', // 中蓝黑
      accent: '#F97316', // 橙色强调（问题标记）
      background: '#F8FAFC', // 浅蓝灰
      backgroundOverlay: 'rgba(15, 23, 42, 0.03)',
      text: '#0F172A', // 深蓝黑
      textLight: '#FFFFFF', // 白色
      textSecondary: '#3B82F6', // 蓝色（代码）
      textTertiary: '#64748B', // 灰蓝
      decorative: '#F97316', // 橙色装饰
      cardBackground: '#FFFFFF',
    },
    fonts: {
      heading: 'JetBrains Mono, Fira Code, monospace',
      body: 'Inter, system-ui, sans-serif',
    },
    typography: {
      title: 30,
      subtitle: 19,
      heading1: 15,
      heading2: 13,
      body: 11,
      caption: 10,
      small: 9,
    },
    decorations: {
      showTopBar: false,
      showBottomBar: true, // 橙色底部线
      showTitleUnderline: false,
      showCardBorder: true, // 左侧橙色边框（问题标记）
      useCardLayout: true,
    },
    style: {
      borderRadius: '4px',
      spacing: 'compact',
      imageStyle: 'sharp',
      layoutStyle: 'light',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌟 PREMIUM THEMES - 高级主题（对标 Genspark 专业级设计）
  // ═══════════════════════════════════════════════════════════════════════════

  // 🌟 11. Genspark Pro - 专业深蓝渐变 + 光效
  'genspark-pro': {
    id: 'genspark-pro',
    name: 'Genspark Pro',
    nameCn: '专业深蓝',
    description: 'Premium dark theme with glow effects, inspired by Genspark',
    descriptionCn: '专业深色主题，渐变光效，对标 Genspark 顶级设计',
    category: 'premium',
    colors: {
      primary: '#0A1628', // 深海军蓝
      secondary: '#1E3A5F', // 中蓝
      accent: '#00D4FF', // 青色高亮
      accentSecondary: '#7B68EE', // 紫色渐变
      background: '#0A1628', // 深色背景
      backgroundGradient:
        'linear-gradient(135deg, #0A1628 0%, #1A1A2E 40%, #16213E 70%, #0F0F1A 100%)',
      backgroundOverlay: 'rgba(0, 212, 255, 0.03)', // 微妙青色覆盖
      text: '#E5E7EB', // 浅灰正文
      textLight: '#FFFFFF', // 白色标题
      textSecondary: '#00D4FF', // 青色副标题
      textTertiary: 'rgba(255, 255, 255, 0.6)', // 半透明白
      decorative: '#00D4FF', // 青色装饰
      cardBackground: 'rgba(255, 255, 255, 0.05)', // 玻璃态卡片
      glow: '#00D4FF', // 光晕颜色
      border: 'rgba(0, 212, 255, 0.2)', // 边框颜色
    },
    fonts: {
      heading: 'Inter, SF Pro Display, -apple-system, sans-serif',
      body: 'Inter, SF Pro Text, -apple-system, sans-serif',
      mono: 'SF Mono, Fira Code, monospace',
    },
    typography: {
      title: 48, // 大标题
      titleWeight: 700,
      titleLetterSpacing: '-0.02em',
      subtitle: 24,
      heading1: 20,
      heading2: 16,
      body: 14,
      bodyLineHeight: 1.6,
      caption: 12,
      small: 10,
    },
    decorations: {
      showTopBar: true,
      showBottomBar: false,
      showTitleUnderline: true,
      showCardBorder: true,
      useCardLayout: true,
      // 高级装饰
      enableGlowEffects: true,
      enableGradientBars: true,
      enableCornerAccents: true,
      enableGeometricShapes: false,
      topBarHeight: '3px',
      cornerGlowSize: '300px',
      cornerGlowOpacity: 0.15,
    },
    style: {
      borderRadius: '12px',
      spacing: 'spacious',
      imageStyle: 'rounded',
      layoutStyle: 'dark',
      cardShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      cardBorderRadius: '16px',
      contentPadding: '60px 80px',
    },
  },

  // 🌟 12. Executive White - 商务简约白
  'executive-white': {
    id: 'executive-white',
    name: 'Executive White',
    nameCn: '商务简约',
    description: 'Clean professional white theme for executive presentations',
    descriptionCn: '简约商务白，适合高管汇报、董事会演示',
    category: 'premium',
    colors: {
      primary: '#1A1A1A', // 纯黑
      secondary: '#374151', // 深灰
      accent: '#0066FF', // 商务蓝
      accentSecondary: '#3B82F6', // 浅蓝
      background: '#FFFFFF', // 纯白背景
      backgroundGradient: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
      backgroundOverlay: 'rgba(0, 102, 255, 0.02)',
      text: '#1A1A1A', // 深黑
      textLight: '#FFFFFF', // 白色
      textSecondary: '#0066FF', // 蓝色强调
      textTertiary: '#6B7280', // 中灰
      decorative: '#0066FF', // 蓝色装饰
      cardBackground: '#F8F9FA', // 浅灰卡片
      glow: '#0066FF',
      border: 'rgba(0, 102, 255, 0.1)',
    },
    fonts: {
      heading: 'Inter, SF Pro Display, -apple-system, sans-serif',
      body: 'Inter, SF Pro Text, -apple-system, sans-serif',
      mono: 'SF Mono, monospace',
    },
    typography: {
      title: 44,
      titleWeight: 600,
      titleLetterSpacing: '-0.01em',
      subtitle: 22,
      heading1: 18,
      heading2: 15,
      body: 14,
      bodyLineHeight: 1.7,
      caption: 12,
      small: 10,
    },
    decorations: {
      showTopBar: false,
      showBottomBar: true,
      showTitleUnderline: false,
      showCardBorder: true,
      useCardLayout: true,
      enableGlowEffects: false,
      enableGradientBars: true,
      enableCornerAccents: false,
      enableGeometricShapes: false,
      topBarHeight: '2px',
    },
    style: {
      borderRadius: '8px',
      spacing: 'spacious',
      imageStyle: 'rounded',
      layoutStyle: 'light',
      cardShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      cardBorderRadius: '12px',
      contentPadding: '48px 64px',
    },
  },

  // 🌟 13. Tech Purple - 科技紫渐变
  'tech-purple': {
    id: 'tech-purple',
    name: 'Tech Purple',
    nameCn: '科技紫',
    description: 'Modern tech theme with purple gradient and neon accents',
    descriptionCn: '现代科技紫，渐变背景，霓虹强调色',
    category: 'premium',
    colors: {
      primary: '#1E1B4B', // 深紫
      secondary: '#312E81', // 中紫
      accent: '#A855F7', // 亮紫
      accentSecondary: '#06B6D4', // 青色
      background: '#0F0A1A', // 深紫黑
      backgroundGradient:
        'linear-gradient(135deg, #1E1B4B 0%, #312E81 30%, #1E1B4B 60%, #0F0A1A 100%)',
      backgroundOverlay: 'rgba(168, 85, 247, 0.05)',
      text: '#E5E7EB', // 浅灰
      textLight: '#FFFFFF', // 白色
      textSecondary: '#A855F7', // 紫色
      textTertiary: 'rgba(255, 255, 255, 0.5)',
      decorative: '#A855F7', // 紫色装饰
      cardBackground: 'rgba(168, 85, 247, 0.08)', // 紫色玻璃态
      glow: '#A855F7',
      border: 'rgba(168, 85, 247, 0.3)',
    },
    fonts: {
      heading: 'Inter, SF Pro Display, -apple-system, sans-serif',
      body: 'Inter, SF Pro Text, -apple-system, sans-serif',
      mono: 'JetBrains Mono, Fira Code, monospace',
    },
    typography: {
      title: 46,
      titleWeight: 700,
      titleLetterSpacing: '-0.02em',
      subtitle: 24,
      heading1: 20,
      heading2: 16,
      body: 14,
      bodyLineHeight: 1.6,
      caption: 12,
      small: 10,
    },
    decorations: {
      showTopBar: true,
      showBottomBar: false,
      showTitleUnderline: true,
      showCardBorder: true,
      useCardLayout: true,
      enableGlowEffects: true,
      enableGradientBars: true,
      enableCornerAccents: true,
      enableGeometricShapes: true,
      topBarHeight: '3px',
      cornerGlowSize: '350px',
      cornerGlowOpacity: 0.2,
    },
    style: {
      borderRadius: '16px',
      spacing: 'spacious',
      imageStyle: 'rounded',
      layoutStyle: 'dark',
      cardShadow: '0 8px 32px rgba(168, 85, 247, 0.15)',
      cardBorderRadius: '20px',
      contentPadding: '60px 80px',
    },
  },

  // 🌟 14. Sunset Gradient - 日落渐变（温暖色调）
  'sunset-gradient': {
    id: 'sunset-gradient',
    name: 'Sunset Gradient',
    nameCn: '日落渐变',
    description: 'Warm gradient theme with orange and pink tones',
    descriptionCn: '温暖渐变主题，橙粉色调，适合创意展示',
    category: 'premium',
    colors: {
      primary: '#1F1135', // 深紫红
      secondary: '#2D1B4E', // 中紫
      accent: '#F97316', // 橙色
      accentSecondary: '#EC4899', // 粉色
      background: '#1F1135',
      backgroundGradient:
        'linear-gradient(135deg, #1F1135 0%, #2D1B4E 30%, #1F1135 70%, #0F0A1A 100%)',
      backgroundOverlay: 'rgba(249, 115, 22, 0.05)',
      text: '#F3E8FF', // 浅紫白
      textLight: '#FFFFFF',
      textSecondary: '#F97316', // 橙色
      textTertiary: 'rgba(255, 255, 255, 0.6)',
      decorative: '#EC4899', // 粉色装饰
      cardBackground: 'rgba(236, 72, 153, 0.08)',
      glow: '#F97316',
      border: 'rgba(249, 115, 22, 0.3)',
    },
    fonts: {
      heading: 'Inter, SF Pro Display, sans-serif',
      body: 'Inter, SF Pro Text, sans-serif',
    },
    typography: {
      title: 46,
      titleWeight: 700,
      titleLetterSpacing: '-0.02em',
      subtitle: 24,
      heading1: 20,
      heading2: 16,
      body: 14,
      bodyLineHeight: 1.6,
      caption: 12,
      small: 10,
    },
    decorations: {
      showTopBar: true,
      showBottomBar: false,
      showTitleUnderline: true,
      showCardBorder: true,
      useCardLayout: true,
      enableGlowEffects: true,
      enableGradientBars: true,
      enableCornerAccents: true,
      topBarHeight: '3px',
      cornerGlowSize: '300px',
      cornerGlowOpacity: 0.18,
    },
    style: {
      borderRadius: '16px',
      spacing: 'spacious',
      imageStyle: 'rounded',
      layoutStyle: 'dark',
      cardShadow: '0 8px 32px rgba(249, 115, 22, 0.12)',
      cardBorderRadius: '18px',
      contentPadding: '60px 80px',
    },
  },
};

/**
 * 获取所有模板列表
 */
export function getAllTemplates(): PPTTemplate[] {
  return Object.values(PPT_TEMPLATES);
}

/**
 * 根据ID获取模板
 */
export function getTemplateById(id: string): PPTTemplate {
  return PPT_TEMPLATES[id] || PPT_TEMPLATES.corporate;
}

/**
 * 根据类别获取模板
 */
export function getTemplatesByCategory(
  category: PPTTemplate['category']
): PPTTemplate[] {
  return getAllTemplates().filter((template) => template.category === category);
}

/**
 * 获取模板的CSS样式
 */
export function getTemplateStyles(template: PPTTemplate): string {
  return `
    --template-primary: ${template.colors.primary};
    --template-secondary: ${template.colors.secondary};
    --template-accent: ${template.colors.accent};
    --template-background: ${template.colors.background};
    --template-text: ${template.colors.text};
    --template-text-light: ${template.colors.textLight};
    --template-font-heading: ${template.fonts.heading};
    --template-font-body: ${template.fonts.body};
    --template-border-radius: ${template.style.borderRadius};
  `;
}

# AI Office PPT Template System

## 概述

参考 Genspark AI、Gamma、Canva 等业界最佳实践，为 AI Office 实现了专业的 PPT 模板系统。

## 已完成的功能

### 1. 模板配置系统 (`frontend/lib/ppt-templates.ts`)

定义了 6 种专业模板：

#### 1.1 企业商务 (Corporate Professional)

- **适用场景**: 商务演示、财务报告、企业汇报
- **设计特点**: 专业稳重、深蓝灰色系
- **配色方案**:
  - 主色: #0F172A (深蓝灰)
  - 辅色: #1E40AF (商务蓝)
  - 强调色: #3B82F6 (亮蓝)

#### 1.2 简约现代 (Minimal Clean)

- **适用场景**: 产品发布、设计展示、创意提案
- **设计特点**: 简洁优雅、留白充足
- **配色方案**:
  - 主色: #000000 (纯黑)
  - 辅色: #6B7280 (中灰)
  - 强调色: #10B981 (翠绿)

#### 1.3 现代渐变 (Modern Gradient)

- **适用场景**: 科技产品、创业路演、趋势分析
- **设计特点**: 现代时尚、渐变色彩
- **配色方案**:
  - 主色: #6366F1 (靛蓝)
  - 辅色: #8B5CF6 (紫色)
  - 强调色: #EC4899 (粉红)

#### 1.4 创意活泼 (Creative Vibrant)

- **适用场景**: 创意设计、营销策划、品牌宣传
- **设计特点**: 色彩丰富、个性鲜明
- **配色方案**:
  - 主色: #F59E0B (橙色)
  - 辅色: #EF4444 (红色)
  - 强调色: #8B5CF6 (紫色)

#### 1.5 学术专业 (Academic Professional)

- **适用场景**: 学术报告、研究成果、教学演示
- **设计特点**: 严谨清晰、传统配色
- **配色方案**:
  - 主色: #1E3A8A (深蓝)
  - 辅色: #0F766E (青色)
  - 强调色: #059669 (绿色)

#### 1.6 科技蓝 (Tech Blue)

- **适用场景**: 技术分享、产品演示、数据分析
- **设计特点**: 科技感十足、蓝色系
- **配色方案**:
  - 主色: #0EA5E9 (天蓝)
  - 辅色: #0284C7 (深蓝)
  - 强调色: #06B6D4 (青色)

### 2. 文档导出服务 (`frontend/lib/services/document-export.service.ts`)

- ✅ 支持 Word、PPT、PDF、Markdown 导出
- ✅ 集成模板系统，根据选定模板应用样式
- ✅ PPT 导出使用 pptxgenjs 库
- ✅ Word 导出使用 docx 库
- ✅ 自动应用模板颜色、字体、样式

#### PPT 导出特性：

- 封面幻灯片（应用模板主色）
- 内容幻灯片（应用模板配色）
- 装饰性色块（Modern、Creative 模板）
- 自动页码
- 模板风格标识

### 3. 导出 API 路由 (`frontend/app/api/ai-office/export/route.ts`)

- ✅ Node.js Runtime 支持
- ✅ 接受 `templateId` 参数
- ✅ 调用文档导出服务生成文件
- ✅ 正确的 MIME 类型和文件扩展名

#### API 参数：

```typescript
{
  format: 'word' | 'ppt' | 'pdf' | 'markdown',
  content: string,  // Markdown content
  title: string,
  templateId?: string  // 可选的模板ID
}
```

### 4. 类型定义扩展

- ✅ `PPTTemplate` 接口定义
- ✅ BaseDocument 已有 `template` 字段
- ✅ 模板辅助函数：
  - `getAllTemplates()` - 获取所有模板
  - `getTemplateById(id)` - 根据ID获取模板
  - `getTemplatesByCategory(category)` - 按类别获取模板
  - `getTemplateStyles(template)` - 获取CSS样式变量

## 待实现的功能

### 5. 模板选择器 UI 组件

**位置**: `frontend/components/ai-office/chat/TemplateSelector.tsx`

**功能需求**:

- 展示所有可用模板的网格视图
- 模板预览卡片（显示配色、名称、描述）
- 选中状态标识
- 按类别筛选（Corporate, Minimal, Modern, Creative, Academic）
- 响应式设计

**UI 设计参考**:

```
┌────────────────────────────────────────┐
│ 选择PPT模板                              │
├────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│ │企业 │ │简约 │ │现代 │ │创意 │  ...  │
│ │商务 │ │现代 │ │渐变 │ │活泼 │       │
│ │ ✓  │ │     │ │     │ │     │       │
│ └─────┘ └─────┘ └─────┘ └─────┘       │
└────────────────────────────────────────┘
```

### 6. ChatPanel 集成模板选择

**需要修改**: `frontend/components/ai-office/chat/ChatPanel.tsx`

**实现要点**:

1. 添加模板选择状态：`const [selectedTemplateId, setSelectedTemplateId] = useState('corporate')`
2. 在检测到 PPT 生成请求时，显示模板选择器
3. 创建文档时包含模板ID：

```typescript
const newDocument = {
  // ... other fields
  template: {
    id: selectedTemplateId,
    version: "1.0",
  },
};
```

### 7. DocumentEditor 应用模板样式

**需要修改**: `frontend/components/ai-office/document/DocumentEditor.tsx`

**实现要点**:

1. 从 document 中读取 templateId
2. 使用 `getTemplateById()` 获取模板配置
3. 应用模板 CSS 变量到预览区域：

```typescript
const template = getTemplateById(document?.template?.id || 'corporate');
const styles = getTemplateStyles(template);

<div className="ppt-preview" style={styles}>
  {/* PPT preview content */}
</div>
```

4. 更新 CSS 类使用模板变量：

```css
.slide-title {
  color: var(--template-primary);
  font-family: var(--template-font-heading);
}

.slide-content {
  color: var(--template-text);
  font-family: var(--template-font-body);
}
```

### 8. 导出功能集成模板

**需要修改**: `frontend/components/ai-office/document/DocumentEditor.tsx` 中的 `handleExport` 函数

**实现要点**:

```typescript
const handleExport = async (format: "word" | "pdf" | "ppt" | "markdown") => {
  const response = await fetch("/api/ai-office/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format,
      content,
      title: document?.title || "未命名文档",
      templateId: document?.template?.id, // 传递模板ID
    }),
  });

  // ... 下载文件逻辑
};
```

## 技术栈

- **前端框架**: Next.js 14 (App Router)
- **状态管理**: Zustand
- **样式**: Tailwind CSS + CSS Variables
- **PPT 生成**: pptxgenjs (v4.0.1)
- **Word 生成**: docx (v9.5.1)
- **Markdown 转换**: turndown (v7.2.2)
- **类型安全**: TypeScript

## 使用示例

### 1. 获取所有模板

```typescript
import { getAllTemplates } from "@/lib/ppt-templates";

const templates = getAllTemplates();
// 返回包含 6 个模板的数组
```

### 2. 按类别筛选模板

```typescript
import { getTemplatesByCategory } from "@/lib/ppt-templates";

const modernTemplates = getTemplatesByCategory("modern");
// 返回 Modern Gradient 和 Tech Blue 模板
```

### 3. 应用模板样式

```typescript
import { getTemplateById, getTemplateStyles } from '@/lib/ppt-templates';

const template = getTemplateById('minimal');
const styles = getTemplateStyles(template);

// 应用到组件
<div style={styles}>
  <h1 className="text-[var(--template-primary)]">标题</h1>
  <p className="text-[var(--template-text)]">内容</p>
</div>
```

### 4. 导出带模板的 PPT

```typescript
const response = await fetch("/api/ai-office/export", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    format: "ppt",
    title: "我的演示文稿",
    content: "### Slide 1: 标题\n- 要点1\n- 要点2",
    templateId: "modern",
  }),
});

const blob = await response.blob();
// 下载生成的 PPTX 文件
```

## 下一步优化方向

1. **自定义模板编辑器**
   - 允许用户自定义颜色、字体
   - 保存个人模板

2. **更多预设模板**
   - 行业特定模板（医疗、教育、金融等）
   - 场景特定模板（季度汇报、年度总结等）

3. **AI 智能推荐模板**
   - 根据内容主题推荐合适模板
   - 根据用户历史偏好推荐

4. **模板预览增强**
   - 实时预览不同模板效果
   - 模板切换动画

5. **导出格式增强**
   - PDF 导出使用 Puppeteer 渲染
   - 支持导出为图片格式

## 参考资料

- [Genspark AI Slides](https://www.genspark.ai/agents?type=slides_agent)
- [Gamma - AI Presentation Tool](https://gamma.app/)
- [Canva Presentation Templates](https://www.canva.com/presentations/)
- [PowerPoint Templates Best Practices 2025](https://elements.envato.com/learn/50-best-powerpoint-templates)

## 总结

本模板系统为 AI Office 提供了专业级的 PPT 生成能力，参考业界最佳实践，支持：

✅ **6 种专业模板**，覆盖主要使用场景
✅ **完整的导出功能**，支持 Word、PPT、PDF、Markdown
✅ **类型安全**，完整的 TypeScript 类型定义
✅ **可扩展架构**，易于添加新模板和功能

下一步需要完成 UI 集成，让用户可以在生成 PPT 时选择模板，并在预览和导出时应用相应样式。

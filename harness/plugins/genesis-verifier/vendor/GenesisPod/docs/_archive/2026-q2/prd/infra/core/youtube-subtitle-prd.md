# YouTube 字幕导出功能 - 产品需求文档 (PRD)

## 🎯 产品概览

**功能名称**: 英文字幕+翻译 PDF导出
**产品线**: YouTube学习工具套件
**优先级**: P1 (高优先级)
**目标用户**: 英语学习者、内容创作者、研究人员
**发布目标**: 2025年Q1

---

## 📊 市场分析 & 用户需求

### 用户痛点

1. **学习困难**: 看视频时无法同时记笔记和对照字幕
2. **便携性缺失**: 无法离线学习字幕内容
3. **对比学习**: 需要手动对比英文原文和中文翻译来理解语言细节
4. **资料整理**: 优质视频的字幕难以保存和分类

### 市场现状

- YouTube官方仅支持SRT/VTT格式下载
- 没有同时导出双语字幕的官方方案
- PDF格式易于分享、打印和存档

### 用户价值主张

✅ **一键导出**: 两种语言字幕同时导出为格式化的PDF
✅ **视觉优化**: 专业排版，易于阅读
✅ **离线学习**: 不依赖网络，随时随地学习
✅ **高效对比**: 并排显示英文和翻译，快速理解

---

## 🎨 功能设计

### 1. 导出按钮位置

**位置**: 右上角工具栏（最右侧）
**当前布局**: `Transcript | Chat | Notes | 翻译 | Auto`
**新增布局**: `Transcript | Chat | Notes | 翻译 | Auto | [↓导出] | [⋯更多]`

```
┌─────────────────────────────────────────────────────────┐
│ YouTube 视频标题                                      ⚙️  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Transcript │ Chat │ Notes │ 翻译 │ Auto │ ↓导出 │ ⋯  │
│                                                          │
│  0:00  One hour every day to improve your English...   │
│  0:12  Do you know if the coffee maker is still...     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2. 导出按钮设计

**按钮样式**:

- 图标: ↓ (下载)或 📄 (文档)
- 颜色: 蓝色 (#2563EB)，hover时深蓝
- 大小: 40x40px (与其他工具栏按钮一致)
- 提示文本: "导出字幕为PDF"

**按钮类型**:

```typescript
<button
  aria-label="导出字幕为PDF"
  class="export-subtitle-btn"
  onClick={handleExportSubtitles}
>
  <DownloadIcon size={20} />
</button>
```

### 3. 导出流程（User Journey）

```
用户点击"↓导出"按钮
        ↓
弹出导出选项菜单
├─ 导出格式选择
│  ├─ PDF (默认)
│  ├─ TXT
│  └─ 计划: DOCX, EPUB
│
├─ 语言组合选择
│  ├─ 双语(英文+中文) - 并排
│  ├─ 双语(英文+中文) - 上下
│  ├─ 仅英文
│  └─ 仅翻译
│
├─ 显示选项
│  ├─ ✓ 包含时间戳
│  ├─ ☐ 包含视频URL
│  └─ ☐ 包含视频元信息
│
└─ [导出PDF]按钮
        ↓
后端生成PDF (格式化、优化排版)
        ↓
浏览器下载: video_title_subtitles_20250120.pdf
```

### 4. 导出对话框UI设计

```
┌──────────────────────────────────────────────┐
│  📥 导出字幕为PDF                          ✕  │
├──────────────────────────────────────────────┤
│                                              │
│  📄 导出格式                                 │
│  ○ PDF (推荐)     ○ TXT     ○ DOCX (Soon)  │
│                                              │
│  🌍 语言组合                                 │
│  ○ 双语-并排 (推荐)                          │
│    English | 中文                           │
│  ○ 双语-上下                                 │
│    English                                  │
│    中文                                      │
│  ○ 仅英文         ○ 仅中文                  │
│                                              │
│  ⚙️ 显示选项                                 │
│  ☑ 包含时间戳 (00:12)                       │
│  ☐ 包含视频URL                              │
│  ☐ 包含视频信息 (标题/频道/日期)            │
│                                              │
│         [取消]  [导出PDF] ✓                 │
└──────────────────────────────────────────────┘
```

### 5. PDF样式设计

#### 页面1: 封面

```
╔════════════════════════════════════════════╗
║                                            ║
║           📺 YouTube Subtitles             ║
║                                            ║
║  One hour every day to improve your        ║
║         English listening. 117             ║
║                                            ║
║  Channel: 附中文配音：日常英文听力         ║
║  Length: 41 minutes 23 seconds             ║
║  Video URL: https://youtube.com/watch?... ║
║                                            ║
║  Export Date: 2025-01-20                   ║
║  Format: Bilingual (English + Chinese)     ║
║                                            ║
╚════════════════════════════════════════════╝
```

#### 页面2+: 字幕内容

```
┌────────────────────────────────────────────────┐
│ 0:00                                           │
│ English | One hour every day to improve your  │
│         | English listening.                  │
│ Chinese | 每天一小时提高你的英文听力。        │
│         |                                    │
│ 0:12                                           │
│ English | Do you know if the coffee maker is  │
│         | still working?                      │
│ Chinese | 你知道咖啡机还在工作吗？            │
│         |                                    │
│ 0:21                                           │
│ English | Do you know if the coffee maker is  │
│         | still working?                      │
│ Chinese | 你知道咖啡机还在工作吗？            │
│         |                                    │
└────────────────────────────────────────────────┘
```

---

## 💻 技术实现方案

### 后端API设计

```typescript
// 1. 获取字幕数据接口
GET /api/youtube/subtitles/{videoId}
Response: {
  videoId: "2UGHs1ajLNE",
  title: "One hour every day...",
  channel: "Channel Name",
  duration: 2483,
  subtitles: [
    {
      startTime: 0,
      endTime: 5000,
      text: "One hour every day to improve your English listening.",
      translation: "每天一小时提高你的英文听力。"
    },
    // ... more subtitles
  ]
}

// 2. 导出PDF接口
POST /api/youtube/export-pdf
Request: {
  videoId: "2UGHs1ajLNE",
  format: "pdf",
  languageLayout: "bilingual-side-by-side", // or "bilingual-stacked", "english-only", "translation-only"
  options: {
    includeTimestamp: true,
    includeVideoUrl: true,
    includeVideoMetadata: true
  }
}
Response: {
  downloadUrl: "https://api.example.com/downloads/pdf_xxx.pdf",
  fileName: "video_title_subtitles_20250120.pdf",
  fileSize: "2.5MB",
  generatedAt: "2025-01-20T10:30:00Z"
}

// 3. 导出文本接口（复用同一个，支持多种格式）
POST /api/youtube/export-subtitles
Request: {
  videoId: "2UGHs1ajLNE",
  format: "txt", // "pdf", "txt", "docx"
  languageLayout: "bilingual-side-by-side",
  options: { ... }
}
```

### 前端实现

```typescript
// 1. 导出按钮组件
export function SubtitleExportButton({ videoId, subtitles }) {
  const [showDialog, setShowDialog] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleExport = async (options: ExportOptions) => {
    try {
      setExportState('loading');
      const response = await api.post('/youtube/export-pdf', {
        videoId,
        ...options
      });

      // 下载PDF
      const link = document.createElement('a');
      link.href = response.downloadUrl;
      link.download = response.fileName;
      link.click();

      setExportState('success');
      setTimeout(() => setShowDialog(false), 1000);
    } catch (error) {
      setExportState('error');
    }
  };

  return (
    <>
      <button
        onClick={() => setShowDialog(true)}
        className="export-btn"
        title="导出字幕为PDF"
      >
        <DownloadIcon />
      </button>

      {showDialog && (
        <ExportDialog
          onExport={handleExport}
          onClose={() => setShowDialog(false)}
          state={exportState}
        />
      )}
    </>
  );
}

// 2. 导出对话框组件
export function ExportDialog({ onExport, onClose, state }) {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'pdf',
    languageLayout: 'bilingual-side-by-side',
    options: {
      includeTimestamp: true,
      includeVideoUrl: false,
      includeVideoMetadata: false
    }
  });

  return (
    <Dialog open={true} onClose={onClose}>
      <DialogContent>
        <h2>导出字幕为PDF</h2>

        {/* Format Selection */}
        <FieldGroup label="导出格式">
          <RadioGroup
            value={options.format}
            onChange={(format) => setOptions({ ...options, format })}
          >
            <Radio value="pdf" label="PDF (推荐)" />
            <Radio value="txt" label="TXT" />
            <Radio value="docx" label="DOCX (即将推出)" disabled />
          </RadioGroup>
        </FieldGroup>

        {/* Language Layout */}
        <FieldGroup label="语言组合">
          <RadioGroup
            value={options.languageLayout}
            onChange={(layout) => setOptions({ ...options, languageLayout: layout })}
          >
            <Radio
              value="bilingual-side-by-side"
              label="双语-并排"
              description="English | 中文"
            />
            <Radio
              value="bilingual-stacked"
              label="双语-上下"
              description="English ↓ 中文"
            />
            <Radio value="english-only" label="仅英文" />
            <Radio value="translation-only" label="仅中文" />
          </RadioGroup>
        </FieldGroup>

        {/* Display Options */}
        <FieldGroup label="显示选项">
          <Checkbox
            checked={options.options.includeTimestamp}
            onChange={(checked) => setOptions({
              ...options,
              options: { ...options.options, includeTimestamp: checked }
            })}
            label="包含时间戳 (00:12)"
          />
          <Checkbox
            checked={options.options.includeVideoUrl}
            onChange={(checked) => setOptions({
              ...options,
              options: { ...options.options, includeVideoUrl: checked }
            })}
            label="包含视频URL"
          />
          <Checkbox
            checked={options.options.includeVideoMetadata}
            onChange={(checked) => setOptions({
              ...options,
              options: { ...options.options, includeVideoMetadata: checked }
            })}
            label="包含视频信息"
          />
        </FieldGroup>

        {/* Loading State */}
        {state === 'loading' && <LoadingSpinner />}
        {state === 'error' && <ErrorMessage />}
        {state === 'success' && <SuccessMessage />}

        {/* Actions */}
        <DialogActions>
          <Button onClick={onClose} variant="secondary">取消</Button>
          <Button
            onClick={() => onExport(options)}
            variant="primary"
            disabled={state === 'loading'}
          >
            {state === 'loading' ? '导出中...' : '导出PDF'}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
```

### PDF生成库选择

```typescript
// 推荐方案：使用 jsPDF + html2canvas (前端) 或 pdfkit (后端)

// 方案1: 后端生成 (推荐 - 更好的性能和控制)
import PDFDocument from "pdfkit";
import fs from "fs";

function generateSubtitlePDF(subtitles, options) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
  });

  // 添加封面
  doc.fontSize(24).text("YouTube Subtitles", { align: "center" });
  doc.fontSize(14).text(subtitles[0].videoTitle, { align: "center" });

  // 添加字幕内容
  doc.fontSize(11);
  subtitles.forEach((subtitle) => {
    if (options.includeTimestamp) {
      doc.text(`[${formatTime(subtitle.startTime)}]`, { color: "gray" });
    }

    if (options.languageLayout === "bilingual-side-by-side") {
      doc.text(`English: ${subtitle.text}`);
      doc.text(`Chinese: ${subtitle.translation}`);
    } else if (options.languageLayout === "bilingual-stacked") {
      doc.text(subtitle.text);
      doc.text(subtitle.translation);
    }

    doc.moveDown(0.5);
  });

  return doc;
}

// 方案2: 前端生成 (用于快速原型)
import html2pdf from "html2pdf.js";

function generatePDFClient(subtitles, options) {
  const html = generateSubtitleHTML(subtitles, options);
  const element = document.createElement("div");
  element.innerHTML = html;

  html2pdf()
    .set({
      margin: 10,
      filename: `subtitles_${Date.now()}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { orientation: "portrait", unit: "mm", format: "a4" },
    })
    .save();
}
```

---

## 📈 功能迭代路线图

### Phase 1: MVP (2025年1月)

✅ PDF格式导出
✅ 双语并排显示
✅ 时间戳包含
✅ 基础UI

### Phase 2: 增强 (2025年2月)

- [ ] TXT/DOCX格式支持
- [ ] 高级排版选项 (字体、颜色、间距)
- [ ] 双语模式: 上下布局、交替布局
- [ ] 导出历史和预设

### Phase 3: 高级 (2025年3月)

- [ ] 批量导出 (多个视频)
- [ ] 字幕编辑 (导出前修改)
- [ ] 主题样式 (深色/浅色/学术)
- [ ] 云存储集成
- [ ] 分享功能

---

## 🎯 成功指标 (KPI)

| 指标             | 目标            | 测量方法       |
| ---------------- | --------------- | -------------- |
| **导出使用率**   | >30% 用户尝试   | 点击事件追踪   |
| **下载转化率**   | >70% 点击转下载 | GA事件跟踪     |
| **用户满意度**   | >4.2/5 星       | 导出后反馈问卷 |
| **导出成功率**   | >98% 无错误     | 后端日志监控   |
| **平均等待时间** | <3秒            | 性能监控       |

---

## 🔒 隐私与合规

### 法律合规性

- ✅ 遵守YouTube ToS (字幕用于学习用途)
- ✅ 自动生成的翻译标记清晰
- ✅ 添加"仅供个人学习使用"免责声明
- ✅ 导出的PDF包含原始视频链接

### 用户隐私

- 不存储下载历史
- 不追踪导出内容的分享
- 后端生成的临时文件24小时后自动删除

### 使用条款修改

```
"导出功能仅用于个人学习和研究目的。
用户不得商业使用或转发导出内容。
我们不对翻译的准确性负责。"
```

---

## 🎨 UI/UX最佳实践

### 可访问性 (A11y)

- ARIA标签: `aria-label="导出字幕为PDF"`
- 键盘导航: Tab键可访问导出按钮
- 颜色对比: WCAG AA标准 (4.5:1)

### 响应式设计

- 桌面: 工具栏右上角按钮 40x40px
- 平板: 菜单中的导出选项
- 手机: 底部导出按钮或菜单

### 错误处理

```
常见错误场景：
1. 网络超时 → "导出超时，请重试"
2. 无字幕数据 → "该视频暂无字幕"
3. 翻译缺失 → "部分字幕翻译缺失，仍可导出"
4. 权限受限 → "此视频不允许导出字幕"
```

---

## 📞 相关团队职责

| 角色           | 职责                             |
| -------------- | -------------------------------- |
| **产品经理**   | 需求定义、优先级排序、用户研究   |
| **设计师**     | UI设计、UX流程、可访问性审查     |
| **前端工程师** | 导出对话框、按钮、事件处理       |
| **后端工程师** | PDF生成、API开发、性能优化       |
| **QA工程师**   | 功能测试、浏览器兼容性、边界情况 |
| **法务**       | 合规性审核、ToS更新              |

---

## 附录A: 竞品分析

| 产品           | 导出格式     | 双语支持 | 离线可用 | 价格 |
| -------------- | ------------ | -------- | -------- | ---- |
| **我们的方案** | PDF/TXT/DOCX | ✅       | ✅       | 免费 |
| Subtitle Edit  | SRT/ASS      | ❌       | ✅       | 免费 |
| DownSub        | TXT/SRT      | ❌       | ✅       | 免费 |
| 3Play Media    | 多格式       | ✅       | ❌       | $$   |
| Descript       | 多格式       | ✅       | ❌       | $$$  |

**竞争优势**: 免费+双语+PDF格式+简洁UI

---

## 附录B: 用户测试脚本

```
测试场景: 用户导出YouTube字幕

前置条件:
- 用户已登录
- 打开一个有中文字幕的YouTube视频

任务流程:
1. "请导出这个视频的英文字幕和中文翻译为PDF"
2. 观察用户查找导出按钮的过程
3. 用户打开导出对话框后的交互
4. 用户选择选项的逻辑
5. 用户下载PDF文件
6. 用户打开并查看PDF内容

观察点:
- 是否能快速找到导出按钮?
- 对话框中的选项是否理解?
- PDF的排版是否满足预期?
- 整个流程的耗时?

```

---

## 版本历史

| 版本 | 日期       | 更新内容 | 作者            |
| ---- | ---------- | -------- | --------------- |
| 1.0  | 2025-01-20 | 初始PRD  | Product Manager |
| 1.1  | -          | 待更新   | -               |

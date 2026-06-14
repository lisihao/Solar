# AI Studio Output Components

展示 AI 生成的各种输出类型的组件。

## OutputViewer

主要的输出查看器组件,支持多种输出类型。

### 使用示例

```tsx
import { OutputViewer } from '@/components/ai-studio/outputs';

function MyComponent() {
  const output = {
    id: '123',
    type: 'FAQ',
    title: 'Product FAQ',
    status: 'COMPLETED',
    content: JSON.stringify({
      categories: [
        {
          name: 'General',
          questions: [{ question: 'What is this?', answer: 'This is a demo.' }],
        },
      ],
    }),
    createdAt: new Date().toISOString(),
  };

  const handleRegenerate = () => {
    // Trigger regeneration
  };

  const handleExport = (format: 'markdown' | 'json') => {
    // Handle export
  };

  return (
    <OutputViewer
      output={output}
      onRegenerate={handleRegenerate}
      onExport={handleExport}
    />
  );
}
```

## 支持的输出类型

- **FAQ**: 问答列表,按分类组织
- **STUDY_GUIDE**: 学习指南,包含章节、术语、问题
- **BRIEFING_DOC**: 简报文档,包含摘要、发现、建议
- **TIMELINE**: 时间线,展示事件序列
- **TREND_REPORT**: 趋势报告,包含趋势分析和预测
- **COMPARISON**: 对比矩阵,多维度比较
- **KNOWLEDGE_GRAPH**: 知识图谱,节点和连接
- **AUDIO_OVERVIEW**: 音频脚本,对话式内容

## 数据格式

每种输出类型都有特定的 JSON 格式,详见组件内部的类型定义。

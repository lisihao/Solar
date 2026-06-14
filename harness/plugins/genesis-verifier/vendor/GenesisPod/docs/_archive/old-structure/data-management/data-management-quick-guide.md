# Data Management 快速参考指南

## 📍 页面位置

- **路由**: `http://localhost:3000/data-management`
- **代码**: `frontend/app/data-management/page.tsx`

---

## 🎯 核心特性

### 1️⃣ 保留全局菜单

```
┌─────────────────────────────────┐
│  DeepDive Sidebar  │ Data Mgmt   │
│  ├─ Explore        │   页面内容   │
│  ├─ AI Office      │             │
│  ├─ Data Mgmt ←────┤             │
│  ├─ My Library     │             │
│  └─ ...            │             │
└─────────────────────────────────┘
```

### 2️⃣ 极简风格设计

- 灰色 + 蓝色配色
- 标准化间距
- 清晰的视觉层级
- 无过度装饰

### 3️⃣ 四大管理模块

```
┌────────────────────────────────┐
│  📊 Overview    概览统计数据     │
│  ⚙️  Configuration 采集规则管理  │
│  📈 Monitoring  实时监控任务    │
│  ✅ Quality     数据质量管理    │
└────────────────────────────────┘
```

### 4️⃣ 五种资源类型

- 📄 学术论文 (PAPER)
- 📝 研究博客 (BLOG)
- 📊 商业报告 (REPORT)
- 🎬 YouTube视频 (YOUTUBE_VIDEO)
- 📰 科技新闻 (NEWS)

---

## 🗂️ 文件结构

```
frontend/
├── app/data-management/
│   └── page.tsx                    # 路由入口
└── components/data-management/
    ├── DataManagementDashboard.tsx  # 主容器 (307行)
    ├── ConfigurationView.tsx         # 配置模块 (159行)
    ├── MonitoringView.tsx            # 监控模块 (183行)
    └── QualityView.tsx               # 质量模块 (207行)
```

---

## 🔌 API端点

### Dashboard Summary

```
GET /api/data-management/dashboard/summary
Response: {
  totalResources: number,
  newToday: number,
  successRate: number,
  errorTasks: number,
  pendingTasks: number
}
```

### Recent Tasks

```
GET /api/data-management/dashboard/recent-tasks
Response: [{
  id: string,
  sourceUrl: string,
  status: 'PENDING'|'PROCESSING'|'SUCCESS'|'FAILED'|'CANCELLED',
  createdAt: string,
  errorMessage?: string
}]
```

---

## 🎨 设计系统

### 颜色方案

| 用途 | 颜色 | Hex     |
| ---- | ---- | ------- |
| 主色 | 蓝色 | #2563EB |
| 背景 | 灰色 | #F9FAFB |
| 成功 | 绿色 | #10B981 |
| 警告 | 黄色 | #F59E0B |
| 危险 | 红色 | #EF4444 |

### 间距标准

- xs: 4px
- sm: 8px
- md: 16px
- lg: 24px
- xl: 32px

### 排版

- H1: 2xl font-bold
- H2: xl font-semibold
- H3: lg font-semibold
- Body: sm text-gray-900
- Caption: xs text-gray-500

---

## 💡 组件使用

### 导入DataManagementDashboard

```tsx
import { DataManagementDashboard } from "@/components/data-management/DataManagementDashboard";

// 使用
<DataManagementDashboard />;
```

### 导入子模块

```tsx
import { ConfigurationView } from "@/components/data-management/ConfigurationView";
import { MonitoringView } from "@/components/data-management/MonitoringView";
import { QualityView } from "@/components/data-management/QualityView";
```

---

## 🚀 开发指南

### 添加新的资源类型

1. 在 `RESOURCE_TYPES` 数组中添加
2. 同时更新 `ResourceType` 类型定义
3. 在各View中添加对应的统计数据

```tsx
const RESOURCE_TYPES = [
  // ...现有类型
  {
    id: 'NEW_TYPE',
    name: '新类型',
    icon: '📌',
  }
];

type ResourceType = 'PAPER' | ... | 'NEW_TYPE';
```

### 添加新的管理功能

1. 创建新的View组件
2. 在 `MANAGEMENT_TABS` 中添加标签
3. 在 `DataManagementDashboard` 中添加条件渲染

```tsx
const MANAGEMENT_TABS = [
  // ...现有标签
  {
    id: "newfunction",
    name: "新功能",
    icon: IconComponent,
    description: "功能描述",
  },
];

// 在DataManagementDashboard中
{
  activeTab === "newfunction" && (
    <NewView resourceType={selectedResourceType} />
  );
}
```

### 连接后端API

```tsx
// 例如：获取配置列表
const { data: configurations } = useQuery({
  queryKey: ["configurations", selectedResourceType],
  queryFn: async () => {
    const response = await fetch(
      `/api/data-management/configurations/${selectedResourceType}`,
    );
    return response.json();
  },
});
```

---

## 📊 数据流

```
用户操作
    ↓
前端组件状态更新
    ↓
React Query获取数据
    ↓
调用后端API
    ↓
数据库查询
    ↓
返回JSON响应
    ↓
前端渲染数据
    ↓
UI更新显示
```

---

## 🧪 测试清单

### 功能测试

- [ ] 页面加载正常
- [ ] 资源类型Tab切换正常
- [ ] 功能Tab切换正常
- [ ] Overview显示统计数据
- [ ] Configuration可添加/删除配置
- [ ] Monitoring显示监控数据
- [ ] Quality显示质量数据

### 响应式测试

- [ ] 桌面版(1920px)布局正确
- [ ] 平板版(768px)布局正确
- [ ] 手机版(375px)布局正确

### 兼容性测试

- [ ] Chrome latest
- [ ] Firefox latest
- [ ] Safari latest
- [ ] Edge latest

---

## 🐛 常见问题

### Q: 为什么没有看到数据？

A:

1. 检查后端API是否启动
2. 检查数据库是否有数据
3. 打开浏览器DevTools查看API响应
4. 检查认证token是否有效

### Q: 如何修改配色？

A:

1. 修改 `getQualityColor()` 函数的Tailwind类名
2. 或在各组件中直接修改className

### Q: 如何添加新的统计指标？

A:

1. 在对应View中添加新的卡片
2. 更新后端API返回新的数据字段
3. 在前端显示新字段

---

## 📱 浏览器支持

| 浏览器  | 版本        | 支持 |
| ------- | ----------- | ---- |
| Chrome  | 最新2个版本 | ✅   |
| Firefox | 最新2个版本 | ✅   |
| Safari  | 最新2个版本 | ✅   |
| Edge    | 最新2个版本 | ✅   |
| IE      | 任何版本    | ❌   |

---

## 📚 相关文档

- 📖 [完整实现文档](./data-management-implementation.md)
- ✅ [验证报告](./data-management-validation.md)
- 🧪 [API测试脚本](./test-data-management-api.sh)
- 📋 [PRD文档](./docs/prd/prd-数据采集.md)

---

## 👥 联系方式

- 代码问题: 查看 `/data-management-implementation.md`
- 设计问题: 参考PRD要求
- 功能问题: 查看对应View组件的注释

---

**最后更新**: 2024-11-19
**版本**: 1.0 Released ✅

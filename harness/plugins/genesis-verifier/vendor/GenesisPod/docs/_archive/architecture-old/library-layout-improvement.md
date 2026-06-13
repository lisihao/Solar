# Library 页面布局改进方案

## 当前问题

在"数据源管理 > 概览"中，布局顺序为：

1. RAG 服务状态 (占据顶部较大空间)
2. 数据源概览标题
3. 外部数据源
4. 平台内数据
5. 帮助信息

**问题分析：**

- RAG 服务状态是**技术运维信息**，不是用户日常关注的内容
- 放在最顶部喧宾夺主，用户真正关心的是"我的数据在哪里"
- 违反了"用户优先"的设计原则

---

## 推荐方案：方案 D - 小型状态指示器

### 设计思路

将 RAG 服务状态从主内容区移除，改为**右上角的小型状态指示器**。

### 改进后布局

```
┌──────────────────────────────────────────────────────────────┐
│ 数据源管理                           🟢 RAG 服务正常 [?]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ 外部数据源                                                    │
│ ┌─────────────────┐  ┌─────────────────┐                    │
│ │  Google Drive   │  │     Notion      │                    │
│ │  ✓ 已连接       │  │  ✗ 未连接       │                    │
│ └─────────────────┘  └─────────────────┘                    │
│                                                              │
│ 平台内数据                                                    │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│ │  书签  │ │  笔记  │ │  图片  │ │  上传  │ │  URL   │     │
│ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘     │
│                                                              │
│ 💡 使用提示：                                                 │
│ • 连接外部数据源可以同步云端内容                               │
│ • 点击平台内数据可以浏览已保存的内容                           │
└──────────────────────────────────────────────────────────────┘
```

### 状态指示器交互

- 🟢 绿色 = 所有服务正常
- 🟡 黄色 = 部分服务异常
- 🔴 红色 = 服务不可用
- 点击 [?] 展开详细状态面板

### 代码改动

```tsx
// DataSourcesTab.tsx - renderOverview()

const renderOverview = () => {
  return (
    <div className="space-y-6">
      {/* Header with Status Indicator */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {t('dataSources.overviewTitle')}
          </h3>
          <p className="text-sm text-gray-500">
            {t('dataSources.overviewDesc')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* RAG Status Indicator */}
          <RAGStatusIndicator status={ragServiceStatus} />
          <button onClick={fetchDataSourceStatuses} ...>
            刷新状态
          </button>
        </div>
      </div>

      {/* External Data Sources - 首要位置 */}
      ...

      {/* Internal Data Sources */}
      ...

      {/* Help Section */}
      ...
    </div>
  );
};
```

---

## 备选方案

### 方案 B：折叠式系统状态

```
┌──────────────────────────────────────────────────────────────┐
│ ▶ 系统状态 (点击展开)                              🟢 正常   │
├──────────────────────────────────────────────────────────────┤
│ 数据源概览                                                    │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

**优点：** 保留详细信息，但不干扰主要内容
**缺点：** 仍占据顶部位置，需要额外点击

### 方案 C：移至管理后台

将 RAG 服务状态完全移到"管理后台 > 系统监控"页面。

**优点：** 普通用户无需看到技术细节
**缺点：** 高级用户需要跳转页面查看

---

## 实施建议

### 优先级

1. **P0**: 实施方案 D（小型状态指示器）
2. **P1**: 添加状态异常时的 Toast 通知
3. **P2**: 在管理后台添加详细监控页面

### 新增组件

```
frontend/components/library/
└── RAGStatusIndicator.tsx   # 小型状态指示器组件
```

### 组件设计

```tsx
interface RAGStatusIndicatorProps {
  status: RAGServiceStatus;
  onRefresh?: () => void;
}

function RAGStatusIndicator({ status, onRefresh }: RAGStatusIndicatorProps) {
  const [showDetails, setShowDetails] = useState(false);

  const overallStatus =
    status.embedding.status === "ok" && status.database.status === "ok"
      ? "ok"
      : status.embedding.status === "error" ||
          status.database.status === "error"
        ? "error"
        : "loading";

  return (
    <div className="relative">
      {/* 状态指示器按钮 */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
      >
        {overallStatus === "ok" && (
          <>
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-green-700">RAG 服务正常</span>
          </>
        )}
        {overallStatus === "error" && (
          <>
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-red-700">服务异常</span>
          </>
        )}
        {overallStatus === "loading" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
            <span className="text-gray-500">检查中...</span>
          </>
        )}
      </button>

      {/* 详情下拉面板 */}
      {showDetails && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-lg border bg-white p-4 shadow-lg">
          {/* 嵌入服务状态 */}
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="h-4 w-4" />
            <span>向量嵌入服务</span>
            {status.embedding.status === "ok" ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500 ml-auto" />
            )}
          </div>
          {/* 数据库状态 */}
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            <span>向量数据库</span>
            {status.database.status === "ok" ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500 ml-auto" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 总结

| 方面       | 当前           | 改进后         |
| ---------- | -------------- | -------------- |
| 用户关注点 | 被技术信息分散 | 聚焦数据源管理 |
| RAG 状态   | 占据顶部大区域 | 右上角小指示器 |
| 信息层级   | 技术优先       | 用户优先       |
| 专业度     | 像运维面板     | 像产品化工具   |

**建议立即实施方案 D**，将 RAG 服务状态从主内容区移到右上角小型指示器。

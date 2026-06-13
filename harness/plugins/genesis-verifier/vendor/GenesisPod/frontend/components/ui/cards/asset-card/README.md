# Asset Platform Components

> 「Agent 驱动型资产」前台平台化组件 —— 抽自 Topic Insights 标杆。

## 目录

| 组件                   | 落位                                                 | 职责                                                                    |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `AssetCard`            | `components/common/asset-card/`                      | 列表页通用卡片：图标 / 徽章 / 可见性 / 操作菜单 / stats / 进度 / 时间戳 |
| `AssetDetailLayout`    | `components/common/asset-detail-layout/`             | 详情页双栏骨架：Header + 左折叠面板 + 右内容区                          |
| `SharePermissionModal` | `components/common/dialogs/SharePermissionModal.tsx` | 通用权限/可见性弹窗：可见性切换 + 链接复制 + 协作者插槽                 |
| `useAssetForm`         | `hooks/utils/useAssetForm.ts`                        | 基本信息编辑 Hook：fields / validators / permissionCheck / submit       |

## 核心约定

1. **结构平台化，主题不平台化**。`gradient` / `badges` / `visibilityOptions` 由调用方传入，避免把 Insights 紫、Writing 琥珀强行统一。
2. **业务逻辑通过 slot 注入**。`footerExtra`（如「申请加入」）、`collaboratorsSlot`、`headerActions` 都不在平台层实现，由调用方放具体业务节点。
3. **i18n 走 labels prop**。平台组件不直接依赖某个翻译命名空间，避免和 `topicResearch.*` 等模块文案绑死。
4. **可见性级别可配置**。Topic 用三态、Writing/Research 用两态，统一用 `AssetVisibility` 类型 + 调用方按需提供 `visibilityOptions` / `levels`。
5. **权限检查由调用方提供**。`useAssetForm.permissionCheck` 是一个回调，避免平台层假设权限模型（owner-id 比对 vs 后端 API 检查）。

## 接入示例

### 列表卡片

```tsx
import {
  AssetCard,
  type AssetVisibility,
} from '@/components/common/asset-card';

<AssetCard
  title={project.name}
  description={project.description}
  icon={<MyIcon />}
  gradient="from-amber-500 to-orange-600"
  badges={[{ key: 'type', label: 'Novel' }]}
  visibility={project.visibility as AssetVisibility}
  visibilityOptions={visibilityOptions}
  isOwner={project.userId === currentUserId}
  onEdit={() => openEdit(project.id)}
  onDelete={() => confirmDelete(project.id)}
  onClick={() => router.push(`/ai-writing/${project.id}`)}
  stats={[
    { key: 'words', icon: <FileText />, text: `${project.wordCount} words` },
  ]}
  timestampLabel="Last edited"
  timestamp={project.updatedAt}
/>;
```

### 详情页骨架

```tsx
import { AssetDetailLayout } from '@/components/common/asset-detail-layout';

<AssetDetailLayout
  title={topic.name}
  description={topic.description}
  icon={<MyIcon />}
  gradient="from-blue-500 to-cyan-600"
  onBack={() => router.back()}
  headerActions={<SettingsButton onClick={openSettings} />}
  leftPanel={<MyTeamPanel />}
  leftPanelTitle="Research Team"
  rightPanel={<MyTabsContent />}
  modals={<SettingsDialog open={open} onClose={close} />}
/>;
```

### 权限弹窗

```tsx
import { SharePermissionModal } from '@/components/common/dialogs';

<SharePermissionModal
  open={open}
  onClose={onClose}
  title={`Share「${name}」`}
  visibility={visibility}
  levels={[
    { value: 'PRIVATE', label: 'Private', icon: <Lock /> },
    { value: 'PUBLIC', label: 'Public', icon: <Globe /> },
  ]}
  onVisibilityChange={async (v) => updateVisibility(v)}
  shareUrl={`${origin}/share/topic/${id}`}
  collaboratorsSlot={<CollaboratorsList />} // 协作者业务自实现
/>;
```

### 编辑 Form Hook

```tsx
import { useAssetForm } from '@/hooks/utils/useAssetForm';

const form = useAssetForm({
  fields: {
    name: { defaultValue: '', required: true, minLength: 1, maxLength: 100 },
    description: { defaultValue: '', maxLength: 500 },
  },
  initialValues: { name: topic.name, description: topic.description ?? '' },
  permissionCheck: () => checkEditPermission(topic.id, user.id),
  onSubmit: async (values) => updateTopic(topic.id, values),
});
```

## 落地状态（2026-04-25）

### 平台组件

- ✅ `AssetCard` / `AssetDetailLayout` / `SharePermissionModal` / `useAssetForm` 已落地
- 在 v1.1（同日）为 `AssetCard` 增加 `customSection` slot，承载 Planning 多阶段、Teams 成员头像等域特定可视化

### 已接入 AssetCard 的模块

| 模块                        | 文件                                                | 状态                                                  |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| Topic Insights              | `components/ai-insights/topics/TopicCard.tsx`       | ✅                                                    |
| AI Writing                  | `app/ai-writing/page.tsx`                           | ✅                                                    |
| AI Research                 | `app/ai-research/page.tsx`                          | ✅（同步移除 3-dot menu，统一为 hover 按钮）          |
| AI Planning（AI 策划）      | `app/ai-planning/page.tsx` PlanCard                 | ✅（多阶段进度走 `customSection`，hash-gradient）     |
| AI Teams                    | `app/ai-teams/page.tsx` TopicCard + PublicTopicCard | ✅（成员头像走 `customSection`，未读徽章走 `badges`） |
| AI Simulation（AI 决策）    | `app/ai-simulation/components/ScenarioCardItem.tsx` | ✅（hash-gradient + timestamp）                       |
| AI Office Slides（AI 报告） | `components/ai-office/slides/SlidesGallery.tsx`     | ✅（aspect-video 缩略图走 `media` slot）              |

### media slot 用法（缩略图优先卡片）

`AssetCard` 提供 `media` 槽，传入时会**取代**默认的 icon+padding 模式，
变成「顶部 aspect-video 缩略图 + 下方信息区」的布局。
适用于 Slides / Image 等以视觉预览为核心的资产。

```tsx
<AssetCard
  title={session.title}
  media={
    <div className="aspect-video" style={{ background: themeBg }}>
      {/* 缩略图内容 */}
    </div>
  }
  badges={[statusBadge]}
  isOwner
  onEdit={handleRename}
  onDelete={handleDelete}
  onClick={handleOpen}
  timestamp={session.updatedAt}
/>
```

### 不接入 AssetCard 的模块（设计差异）

| 模块              | 原因                                                   |
| ----------------- | ------------------------------------------------------ |
| AI Image          | 图片缩略图优先 + overlay actions，独立交互模式         |
| AI Social         | Tab 化后台页（Connections / Contents），无列表卡片场景 |
| AI Ask            | 会话界面，无资产列表                                   |
| Library / Explore | 专项浏览结构                                           |

### 待迭代

- ⏳ `TopicResearchLayout` 替换为 `AssetDetailLayout`（详情页骨架归一）
- ⏳ `TopicSharingModal` 协作者邀请部分迁移到 `SharePermissionModal.collaboratorsSlot`
- ⏳ AI Writing / Research 详情页骨架接入 `AssetDetailLayout`

## 不要做的事

- 不要在平台层硬编码颜色/品牌主题
- 不要在 SharePermissionModal 里实现协作者邀请的业务逻辑（差异大，业务侧实现）
- 不要尝试做「一个万能 Team 拓扑组件」—— 走预设拓扑库（leader-radial / sequential-phase / horizontal-row）的路线
- 不要替换 TopicSharingModal 的协作者邀请部分（业务复杂，先保留）
- 不要把 AI Image 的图片缩略图卡强行套 AssetCard —— 它是 image-first 范式，AssetCard 是 icon+text-first 范式

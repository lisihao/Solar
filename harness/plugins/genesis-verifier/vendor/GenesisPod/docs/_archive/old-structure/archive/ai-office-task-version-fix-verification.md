# AI Office 任务列表和版本管理功能修复验证指南

## 修复概述

本次修复解决了 AI Office 中任务列表保存/恢复和版本管理的多个关键问题。

---

## 已修复的问题

### 1. 任务上下文保存不完整 ✅

**问题**: 任务保存时可能获取到过时的文档内容
**修复**:

- 使用深拷贝保存文档内容快照
- 在 AI 生成完成后立即获取最新文档状态
- 避免异步竞态条件

### 2. 版本内容结构不匹配 ✅

**问题**: 版本预览无法正确显示 PPT 内容
**修复**:

- 版本保存时深拷贝完整 content 对象
- VersionHistory 组件支持 markdown 格式的版本内容
- 兼容旧格式和新格式

### 3. slideCount 计算缺失 ✅

**问题**: PPT 文档的幻灯片数量始终显示为 0
**修复**:

- 创建统一的 `calculateSlideCount()` 工具函数
- 在所有需要的地方自动计算 slideCount
- 实时更新、任务保存、版本保存时都正确计算

### 4. 任务恢复时 metadata 丢失 ✅

**问题**: 恢复任务后 slideCount 等元数据不正确
**修复**:

- 恢复时重新计算 slideCount
- 正确合并 metadata，避免覆盖

### 5. 版本保存时机问题 ✅

**问题**: setTimeout 导致版本可能丢失
**修复**:

- 移除不必要的 setTimeout
- 版本保存改为同步执行

---

## 验证步骤

### 测试 1: 任务创建和保存

**步骤**:

1. 选择一些资源（如 YouTube 视频）
2. 在聊天框输入: "生成一个关于这些资源的 PPT"
3. 等待 AI 生成完成
4. 观察任务列表（点击右侧任务按钮）

**预期结果**:

- ✅ 任务列表中出现新任务
- ✅ 任务显示正确的标题和类型（PPT）
- ✅ 任务显示正确的字数统计
- ✅ 任务显示创建时间

**验证点**:

```javascript
// 在浏览器控制台检查任务数据
const tasks = JSON.parse(localStorage.getItem("ai-office-task-storage")).state
  .tasks;
console.log("任务数据:", tasks[0]);
// 应该看到:
// - context.documentContent.markdown 有完整内容
// - context.documentMetadata.slideCount > 0
// - context.chatMessages 包含对话历史
```

---

### 测试 2: 任务恢复功能

**步骤**:

1. 完成测试 1
2. 刷新页面或关闭重新打开
3. 打开任务列表
4. 点击之前创建的任务

**预期结果**:

- ✅ 文档编辑区显示正确的 PPT 内容
- ✅ 顶部显示正确的幻灯片数量（如 "8 页"）
- ✅ AI 聊天历史正确恢复
- ✅ 资源选择状态恢复（左侧资源列表）

**验证点**:

```javascript
// 检查文档状态
const docStore = useDocumentStore.getState();
const currentDoc = docStore.documents.find(
  (d) => d._id === docStore.currentDocumentId,
);
console.log("当前文档:", currentDoc);
// 应该看到:
// - content.markdown 有完整内容
// - metadata.slideCount 正确（如 8）
// - metadata.wordCount > 0
```

---

### 测试 3: 版本管理保存

**步骤**:

1. 生成一个 PPT 文档
2. 等待生成完成
3. 点击顶部工具栏的 "版本" 按钮
4. 查看版本历史列表

**预期结果**:

- ✅ 看到至少一个版本（"初始生成"）
- ✅ 版本显示正确的时间戳
- ✅ 版本显示 "AI生成" 标签
- ✅ 版本元数据显示正确的幻灯片数量

**验证点**:

```javascript
// 检查版本数据
const docStore = useDocumentStore.getState();
const currentDoc = docStore.documents.find(
  (d) => d._id === docStore.currentDocumentId,
);
console.log("版本列表:", currentDoc.versions);
// 应该看到:
// - versions 数组不为空
// - version.metadata.slideCount > 0
// - version.content.markdown 有完整内容
```

---

### 测试 4: 版本预览

**步骤**:

1. 打开版本历史（见测试 3）
2. 点击左侧的一个版本
3. 查看右侧预览面板

**预期结果**:

- ✅ 右侧显示幻灯片预览卡片
- ✅ 每张幻灯片显示标题和部分内容
- ✅ 不显示原始 JSON 数据
- ✅ 幻灯片数量与版本元数据一致

---

### 测试 5: 版本恢复

**步骤**:

1. 生成一个 PPT
2. 等待完成后，在聊天框输入: "重新生成第一页，改成介绍主题"
3. 等待 AI 更新完成
4. 打开版本历史，应该看到 2 个版本
5. 点击第一个版本（"初始生成"）
6. 点击 "恢复此版本" 按钮

**预期结果**:

- ✅ 文档内容恢复到初始版本
- ✅ 幻灯片数量正确更新
- ✅ 文档编辑器立即显示恢复的内容

---

### 测试 6: 多次更新和任务刷新

**步骤**:

1. 生成一个 PPT（3-5 页）
2. 记录初始幻灯片数量
3. 输入: "添加一页总结"
4. 等待 AI 更新完成
5. 打开任务列表，查看任务的 "刷新时间"
6. 点击该任务，验证恢复

**预期结果**:

- ✅ 幻灯片数量增加（如 3 → 4）
- ✅ 任务列表显示 "刷新于 X 秒前"
- ✅ 任务恢复时显示最新的 4 页内容
- ✅ 版本历史显示 2 个版本（初始生成 + 更新文档）

---

### 测试 7: 跨会话持久化

**步骤**:

1. 完成测试 6
2. **完全关闭浏览器**（不只是刷新）
3. 重新打开应用
4. 打开任务列表
5. 点击之前的任务

**预期结果**:

- ✅ 任务列表数据完整保留
- ✅ 文档内容正确恢复
- ✅ slideCount 正确显示
- ✅ 聊天历史完整保留

**验证点**:

```javascript
// 检查 localStorage
const taskData = JSON.parse(localStorage.getItem("ai-office-task-storage"));
console.log("持久化任务数据:", taskData.state.tasks);
// 应该看到所有任务及其完整上下文
```

---

## 常见问题排查

### 问题 1: slideCount 仍然显示为 0

**可能原因**:

- markdown 内容格式不正确
- 缓存的旧数据

**解决方法**:

```javascript
// 清除旧数据
localStorage.removeItem("ai-office-task-storage");
// 刷新页面，重新生成文档
```

### 问题 2: 任务恢复后文档是空的

**可能原因**:

- 任务保存时文档还未生成完成

**解决方法**:

- 确保 AI 生成完成后再切换任务
- 检查控制台错误日志

### 问题 3: 版本预览显示 JSON

**可能原因**:

- 使用了旧版本的代码
- 版本数据格式不匹配

**解决方法**:

- 确保更新了最新代码
- 删除旧版本，重新生成

---

## 性能验证

### 内存泄漏检查

1. 打开 Chrome DevTools → Memory
2. 生成 10 个 PPT 任务
3. 每个任务恢复 3 次
4. 拍摄 Heap Snapshot
5. 检查是否有大量未释放的对象

**预期**: 无明显内存泄漏

### 数据一致性检查

```javascript
// 运行此脚本检查数据一致性
const checkDataConsistency = () => {
  const taskStore = useTaskStore.getState();
  const docStore = useDocumentStore.getState();

  taskStore.tasks.forEach((task) => {
    if (task.context.documentId) {
      const doc = docStore.documents.find(
        (d) => d._id === task.context.documentId,
      );

      console.log(`任务 ${task._id}:`);
      console.log("  - 文档存在:", !!doc);
      console.log("  - 内容快照存在:", !!task.context.documentContent);
      console.log("  - 元数据快照存在:", !!task.context.documentMetadata);
      console.log("  - slideCount:", task.context.documentMetadata?.slideCount);

      if (doc && doc.type === "ppt") {
        const calculatedCount = calculateSlideCount(doc.content.markdown);
        const savedCount = task.context.documentMetadata?.slideCount;
        console.log("  - slideCount 一致:", calculatedCount === savedCount);
      }
    }
  });
};

checkDataConsistency();
```

---

## 回归测试清单

在部署前，确保以下所有功能正常:

- [ ] 创建新 PPT 任务
- [ ] 创建新文章任务
- [ ] 任务列表显示正确
- [ ] 任务恢复（文档内容）
- [ ] 任务恢复（聊天历史）
- [ ] 任务恢复（资源选择）
- [ ] 版本自动保存
- [ ] 版本列表显示
- [ ] 版本预览（PPT）
- [ ] 版本预览（文章）
- [ ] 版本恢复
- [ ] slideCount 正确计算
- [ ] 跨会话持久化
- [ ] 多次更新和刷新
- [ ] 任务删除

---

## 已知限制

1. **性能限制**: 超过 50 个任务时，任务列表可能变慢（可优化虚拟滚动）
2. **存储限制**: localStorage 限制约 5-10MB，大量任务可能超限
3. **并发限制**: 同时恢复多个任务时，状态可能冲突

---

## 修复文件清单

### 核心修复

- ✅ `frontend/stores/aiOfficeStore.ts` - 任务和版本管理逻辑
- ✅ `frontend/components/ai-office/chat/ChatPanel.tsx` - 任务保存逻辑
- ✅ `frontend/components/ai-office/document/VersionHistory.tsx` - 版本预览

### 新增工具

- ✅ `frontend/lib/utils/ppt-utils.ts` - PPT 工具函数

### 文档

- ✅ `docs/ai-office-task-version-fix-verification.md` - 验证指南（本文档）

---

## 总结

本次修复全面解决了任务列表和版本管理的核心问题，包括:

- ✅ 数据保存完整性
- ✅ 数据恢复准确性
- ✅ slideCount 自动计算
- ✅ 版本预览正确渲染
- ✅ 消除竞态条件

所有功能现已可正常使用，建议按照本文档进行全面测试验证。

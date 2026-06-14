# Frontend Defect Patterns - 前端缺陷模式总结

> 基于代码审查发现的常见缺陷模式，用于指导代码质量检查和预防。

## 1. Emoji/Unicode 编码问题

### 症状

```
// 乱码显示
icon: 'ðŸ¤–'  // 应该是 🤖
```

### 原因

- 文件保存时编码不正确
- 编辑器或工具不支持 UTF-8
- 复制粘贴时编码丢失

### 预防

```typescript
// ✅ 正确：使用 Unicode 转义或确保 UTF-8 编码
const ICONS = {
  robot: "\u{1F916}", // 或直接 '🤖'（确保文件是 UTF-8）
};
```

### 检查方法

```bash
# 检查文件编码
file -i filename.tsx
# 应显示: charset=utf-8
```

---

## 2. JSX 标签未闭合

### 症状

```
error TS17008: JSX element 'main' has no corresponding closing tag.
```

### 常见位置

- 条件渲染后忘记闭合
- 多层嵌套时漏掉
- 复制粘贴时丢失

### 预防

```tsx
// ✅ 正确：保持良好的缩进和配对
return (
  <AppShell>
    <main className="flex-1">
      <div className="container">{/* content */}</div>
    </main>{" "}
    {/* ← 确保闭合 */}
  </AppShell>
);
```

### 检查方法

- 使用 ESLint 的 `react/jsx-closing-tag-location` 规则
- IDE 的括号匹配高亮

---

## 3. useState 误用于副作用

### 症状

```typescript
// ❌ 错误：useState 用于副作用
useState(() => {
  if (user) {
    setFormData({ ... });
  }
});
```

### 正确做法

```typescript
// ✅ 正确：使用 useEffect
useEffect(() => {
  if (user) {
    setFormData({
      username: user.username || "",
      role: user.role,
    });
  }
}, [user]);
```

### 原因

- 混淆 useState 初始化函数和 useEffect
- 复制代码时忘记修改

---

## 4. 类型导出遗漏

### 症状

```
error TS2305: Module '"@/hooks/domain"' has no exported member 'User'.
```

### 原因

- 新增类型后忘记从 index.ts 导出
- 只导出了值，没导出类型

### 正确做法

```typescript
// hooks/domain/index.ts
export { useAdminUsers } from "./useAdminUsers";
export type { User, CreateUserData } from "./useAdminUsers"; // ← 别忘了类型
```

---

## 5. Modal 组件定义但未渲染

### 症状

- Modal 组件存在
- 状态变量存在
- 但点击按钮无反应

### 检查清单

```tsx
// 1. ✅ 导入 Modal 组件
import { AddUserModal } from "./AddUserModal";

// 2. ✅ 定义状态
const [showModal, setShowModal] = useState(false);

// 3. ✅ 按钮有 onClick
<button onClick={() => setShowModal(true)}>Add</button>;

// 4. ✅ 渲染 Modal（容易遗漏！）
{
  showModal && <AddUserModal onClose={() => setShowModal(false)} />;
}
```

---

## 6. 按钮缺少 onClick 处理

### 症状

- 按钮显示正常
- 点击无反应
- 没有控制台错误

### 检查

```tsx
// ❌ 错误：缺少 onClick
<button className="...">
  <Edit className="h-4 w-4" />
</button>

// ✅ 正确：添加 onClick
<button
  onClick={() => setEditingUser(user)}
  className="..."
>
  <Edit className="h-4 w-4" />
</button>
```

---

## 7. 布局间距问题

### 症状

- 内容离侧边栏太远
- 页面内容居中但不应该

### 常见原因

```tsx
// ❌ 问题：不必要的居中
<div className="mx-auto max-w-6xl">

// ✅ 修复：移除居中
<div>
```

### 检查

- 对比相邻页面的布局
- 检查是否有 `mx-auto` 或 `max-w-*` 类

---

## 8. 接口字段遗漏

### 症状

```
Property 'xxx' does not exist on type 'YYY'.
```

### 预防

```typescript
// 添加新字段时，检查所有相关位置：
// 1. interface 定义
// 2. useState 初始值
// 3. API 调用
// 4. 表单字段
```

---

## 9. 重复代码块

### 症状

- 同一段代码出现两次
- 通常发生在 sed/替换操作后

### 预防

- 替换后检查文件
- 使用 `grep -n "关键词" file` 确认只有一处

---

## 代码审查检查清单

### 提交前必检

- [ ] 类型检查通过：`npm run type-check`
- [ ] 没有未闭合的 JSX 标签
- [ ] 新增类型已导出
- [ ] Modal/Dialog 已渲染
- [ ] 按钮有 onClick 处理
- [ ] 文件编码是 UTF-8
- [ ] 没有重复代码块

### 常见修改点

| 修改类型   | 检查位置                  |
| ---------- | ------------------------- |
| 新增 Hook  | index.ts 导出             |
| 新增 Modal | JSX 渲染 + 状态 + onClick |
| 新增字段   | interface + 初始值 + 表单 |
| 布局修改   | 与相邻页面对比            |

---

**最后更新**: 2026-01-18
**基于**: Admin 管理后台重构中发现的问题
**维护者**: Claude Code

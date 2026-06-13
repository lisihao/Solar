# GenesisPod 团队协作规范

## 目录

1. [分工协同方案](#1-分工协同方案)
2. [组件复用策略](#2-组件复用策略)
3. [质量与风格规范](#3-质量与风格规范)
4. [Git 工作流](#4-git-工作流)

---

## 1. 分工协同方案

### 1.1 角色定义

| 角色                         | 职责                    | 主要工作目录                              |
| ---------------------------- | ----------------------- | ----------------------------------------- |
| **设计师 (Designer)**        | UI/UX设计、设计系统维护 | `frontend/components/ui/`, `docs/design/` |
| **前端开发 (Frontend Dev)**  | 页面开发、组件开发      | `frontend/app/`, `frontend/components/`   |
| **后端开发 (Backend Dev)**   | API开发、服务逻辑       | `backend/src/modules/`                    |
| **验证工程师 (QA)**          | 测试、质量保证          | `**/**.spec.ts`, `**/**.test.ts`          |
| **集成工程师 (Integration)** | 部署、CI/CD、代码评审   | `.github/`, `docs/operations/`            |

### 1.2 功能模块分工

```
GenesisPod 功能模块
├── Ask AI (问答功能)
│   ├── Frontend: frontend/app/ask/, frontend/components/ask/
│   └── Backend: backend/src/modules/ai/
│
├── Explore (资源探索)
│   ├── Frontend: frontend/app/explore/, frontend/components/explore/
│   └── Backend: backend/src/modules/resources/
│
├── Library (个人收藏)
│   ├── Frontend: frontend/app/library/, frontend/components/library/
│   └── Backend: backend/src/modules/collections/
│
├── AI Office (智能文档)
│   ├── Frontend: frontend/app/ai-office/, frontend/components/ai-office/
│   └── Backend: backend/src/modules/ai-office/
│
├── AI Studio (创作工具)
│   ├── Frontend: frontend/app/ai-studio/, frontend/components/ai-studio/
│   └── Backend: backend/src/modules/ai-image/
│
├── AI Teams (团队协作)
│   ├── Frontend: frontend/app/ai-teams/, frontend/components/ai-group/
│   └── Backend: backend/src/modules/ai-team/
│
├── AI Simulation (模拟仿真)
│   ├── Frontend: frontend/app/ai-simulation/, frontend/components/simulation/
│   └── Backend: backend/src/modules/simulation/
│
└── AI Store (应用商店)
    ├── Frontend: frontend/app/ai-store/
    └── Backend: backend/src/modules/store/
```

### 1.3 分支策略

```
main (生产分支)
  │
  ├── develop (开发主干)
  │     │
  │     ├── feature/ask-ai-xxx (功能分支)
  │     ├── feature/explore-xxx
  │     ├── feature/library-xxx
  │     ├── feature/ai-office-xxx
  │     ├── feature/ai-studio-xxx
  │     └── ...
  │
  ├── hotfix/xxx (紧急修复)
  │
  └── release/v1.x.x (发布分支)
```

**分支命名规范：**

- 功能分支: `feature/<module>-<description>`
- 修复分支: `fix/<module>-<description>`
- 热修复: `hotfix/<description>`
- 发布分支: `release/v<major>.<minor>.<patch>`

**示例：**

```bash
feature/ai-office-ppt-export
feature/library-batch-actions
fix/explore-search-error
hotfix/auth-token-expired
```

---

## 2. 组件复用策略

### 2.1 共享组件层次

```
frontend/components/
├── ui/                     # 基础UI组件 (Button, Input, Modal, etc.)
│   ├── button.tsx
│   ├── input.tsx
│   ├── modal.tsx
│   ├── dropdown.tsx
│   └── ...
│
├── layout/                 # 布局组件 (Sidebar, Header, etc.)
│   ├── Sidebar.tsx
│   ├── Header.tsx
│   └── MainLayout.tsx
│
├── features/               # 功能性共享组件
│   ├── NotesList.tsx       # 笔记列表 (Library, Explore共用)
│   ├── ResourceCard.tsx    # 资源卡片
│   └── TagList.tsx         # 标签组件
│
└── <module>/               # 模块专属组件
    └── ...
```

### 2.2 共享 Hooks

```
frontend/hooks/
├── useApi.ts               # API请求Hook
├── useAsyncOperation.ts    # 异步操作Hook
├── useStream.ts            # SSE流式数据Hook
├── useDebounce.ts          # 防抖Hook
└── useLocalStorage.ts      # 本地存储Hook
```

### 2.3 共享 Stores (Zustand)

```
frontend/stores/
├── aiOfficeStore.ts        # AI Office状态
├── imageSourceStore.ts     # 图片素材状态
└── ...
```

### 2.4 共享工具函数

```
frontend/lib/
├── config.ts               # 配置管理
├── auth.ts                 # 认证工具
├── utils/                  # 工具函数
│   ├── format.ts           # 格式化
│   ├── validation.ts       # 验证
│   └── ppt-utils.ts        # PPT相关
└── cache/
    └── lru-cache.ts        # 缓存实现
```

### 2.5 后端共享模块

```
backend/src/common/
├── ai-orchestration/       # AI模型调度
│   ├── providers/          # 各AI提供商适配器
│   └── provider-factory.ts
│
├── deduplication/          # 去重服务
├── guards/                 # 权限守卫
├── decorators/             # 装饰器
└── interceptors/           # 拦截器
```

### 2.6 复用规则

1. **基础UI组件** → 必须放在 `frontend/components/ui/`
2. **跨模块使用2次以上** → 提升到 `frontend/components/features/`
3. **业务逻辑复用** → 提取到 `frontend/hooks/` 或 `frontend/lib/`
4. **状态跨页面共享** → 使用 Zustand Store

---

## 3. 质量与风格规范

### 3.1 代码风格强制执行

项目已配置以下工具自动执行：

```json
// .lintstagedrc.json - 提交时自动检查
{
  "frontend/**/*.{ts,tsx}": ["eslint --fix", "prettier --write", "type-check"],
  "backend/**/*.{ts,tsx}": ["eslint --fix", "prettier --write", "type-check"]
}
```

### 3.2 TypeScript 规范

```typescript
// ✅ 正确示例
interface UserProps {
  id: string;
  name: string;
  email?: string;
}

const fetchUser = async (id: string): Promise<User> => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
};

// ❌ 错误示例
const fetchUser = async (id: any) => {  // no-explicit-any
  var response = await fetch(...)        // no-var
  console.log(response)                  // no-console
}
```

### 3.3 React/Next.js 规范

```tsx
// ✅ 组件命名: PascalCase
export default function UserProfile({ user }: UserProfileProps) {
  // ✅ Hooks 必须在顶层调用
  const [loading, setLoading] = useState(false);

  // ✅ 使用 useCallback 优化回调
  const handleClick = useCallback(() => {
    // ...
  }, [dependency]);

  return (
    <div className="...">
      {/* ✅ 列表项必须有 key */}
      {items.map((item) => (
        <Item key={item.id} {...item} />
      ))}
    </div>
  );
}
```

### 3.4 UI 风格规范 (Tailwind CSS)

**颜色系统：**

```css
/* 主色调 */
--primary: blue-600 --primary-hover: blue-700 /* 状态颜色 */
  --success: green-600 --warning: amber-500 --error: red-600 /* 中性色 */
  --text-primary: gray-900 --text-secondary: gray-600 --text-muted: gray-400
  --border: gray-200 --background: gray-50;
```

**间距规范：**

```css
/* 组件内部 */
padding: p-3 (小), p-4 (中), p-6 (大)

/* 组件间距 */
gap/margin: gap-2 (紧凑), gap-4 (标准), gap-6 (宽松)

/* 圆角 */
border-radius: rounded (小), rounded-lg (中), rounded-xl (大)
```

**字体规范：**

```css
/* 标题 */
h1: text-2xl font-bold
h2: text-xl font-semibold
h3: text-lg font-medium

/* 正文 */
body: text-sm text-gray-700
caption: text-xs text-gray-500
```

### 3.5 Git Commit 规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type 类型：**

- `feat`: 新功能
- `fix`: 修复Bug
- `refactor`: 重构
- `style`: 样式调整
- `docs`: 文档
- `test`: 测试
- `chore`: 构建/工具

**示例：**

```
feat(ai-office): add PPT export functionality

- Add PPTX generation using pptxgenjs
- Support multiple themes
- Add progress tracking during export

Closes #123
```

### 3.6 测试规范

**前端测试：**

```typescript
// frontend/**/*.test.ts
describe('ComponentName', () => {
  it('should render correctly', () => {
    // Arrange
    const props = { ... };

    // Act
    render(<Component {...props} />);

    // Assert
    expect(screen.getByText('...')).toBeInTheDocument();
  });
});
```

**后端测试：**

```typescript
// backend/**/*.spec.ts
describe('ServiceName', () => {
  let service: ServiceName;

  beforeEach(async () => {
    const module = await Test.createTestingModule({...}).compile();
    service = module.get<ServiceName>(ServiceName);
  });

  it('should do something', async () => {
    const result = await service.method();
    expect(result).toBeDefined();
  });
});
```

---

## 4. Git 工作流

### 4.1 日常开发流程

```bash
# 1. 更新本地 develop
git checkout develop
git pull origin develop

# 2. 创建功能分支
git checkout -b feature/ai-office-xxx

# 3. 开发并提交
git add .
git commit -m "feat(ai-office): add xxx"

# 4. 推送到远程
git push origin feature/ai-office-xxx

# 5. 创建 Pull Request → develop
# 6. Code Review
# 7. 合并到 develop
```

### 4.2 发布流程

```bash
# 1. 从 develop 创建发布分支
git checkout develop
git checkout -b release/v1.2.0

# 2. 版本号更新、最终测试
# 3. 合并到 main
git checkout main
git merge release/v1.2.0

# 4. 打标签
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0

# 5. 合并回 develop
git checkout develop
git merge release/v1.2.0
```

### 4.3 Code Review 检查清单

- [ ] 代码风格符合 ESLint 规则
- [ ] TypeScript 类型完整，无 `any`
- [ ] 组件是否可以复用？是否放在正确位置？
- [ ] 是否添加了必要的测试？
- [ ] UI 风格是否与设计系统一致？
- [ ] 是否有性能问题（不必要的渲染、内存泄漏）？
- [ ] 是否有安全问题（XSS、SQL注入等）？

---

## 附录：常用命令

```bash
# 开发
npm run dev              # 启动开发服务器

# 构建
npm run build            # 构建生产版本

# 测试
npm run test             # 运行测试
npm run test:ci          # CI 测试

# 代码检查
npm run lint             # ESLint 检查
npm run type-check       # TypeScript 类型检查

# 格式化
npm run format           # Prettier 格式化
```

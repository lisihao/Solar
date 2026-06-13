# 04 - 代码风格指南 | Code Style Guide

> **优先级**: 🔴 MUST
> **更新日期**: 2025-11-09
> **适用范围**: 所有TypeScript、Python、React代码

---

## 目录

1. [TypeScript代码规范](#typescript代码规范)
2. [React组件规范](#react组件规范)
3. [Python代码规范](#python代码规范)
4. [通用规范](#通用规范)
5. [工具配置](#工具配置)

---

## TypeScript代码规范

### 1. 严格模式 🔴 MUST

**所有项目必须启用TypeScript严格模式**：

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### 2. 类型定义 🔴 MUST

```typescript
// ✅ 正确 - 显式类型定义
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

function getUser(id: string): Promise<User> {
  return fetch(`/api/users/${id}`).then((res) => res.json());
}

// ❌ 错误 - 使用any类型
function getUser(id: any): Promise<any> {
  return fetch(`/api/users/${id}`).then((res) => res.json());
}
```

**规则**:

- 🔴 MUST: 禁止使用`any`类型，使用`unknown`替代
- 🔴 MUST: 所有函数参数必须有类型标注
- 🔴 MUST: 公共API函数必须有返回类型标注
- 🟡 SHOULD: 内部函数可以依赖类型推断

### 3. 命名规范 🔴 MUST

```typescript
// ✅ 正确
// Classes, Interfaces, Types: PascalCase
class UserService {}
interface ApiResponse {}
type ResourceType = "article" | "video";

// Functions, Variables: camelCase
function fetchUserData() {}
const userId = "123";

// Constants: UPPER_SNAKE_CASE
const API_BASE_URL = "https://api.example.com";
const MAX_RETRY_COUNT = 3;

// Private properties: leading underscore (optional)
class Service {
  private _cache: Map<string, any>;
}

// ❌ 错误
class user_service {} // 应该用PascalCase
const UserId = "123"; // 变量应该用camelCase
const apiBaseUrl = "https://..."; // 常量应该用UPPER_SNAKE_CASE
```

### 4. 函数规范 🔴 MUST

```typescript
// ✅ 正确 - 简洁的函数，单一职责
function calculateTotalPrice(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// ✅ 正确 - 使用箭头函数（简短逻辑）
const formatDate = (date: Date): string => date.toISOString();

// ✅ 正确 - 早期返回避免深层嵌套
function validateUser(user: User): ValidationResult {
  if (!user.email) {
    return { valid: false, error: "Email is required" };
  }

  if (!isValidEmail(user.email)) {
    return { valid: false, error: "Invalid email format" };
  }

  return { valid: true };
}

// ❌ 错误 - 函数过长，职责不清
function processUserData(user: any): any {
  // 100+ lines of mixed concerns
  // validation, transformation, API calls, logging, etc.
}

// ❌ 错误 - 深层嵌套
function validateUser(user: User) {
  if (user.email) {
    if (isValidEmail(user.email)) {
      if (user.name) {
        if (user.name.length > 2) {
          return true;
        }
      }
    }
  }
  return false;
}
```

**规则**:

- 🔴 MUST: 函数长度不超过50行（推荐20行以内）
- 🔴 MUST: 函数参数不超过3个，更多使用对象参数
- 🔴 MUST: 使用早期返回避免深层嵌套（最多3层）
- 🟡 SHOULD: 纯函数优先（无副作用）

### 5. 异步处理 🔴 MUST

```typescript
// ✅ 正确 - 使用async/await
async function fetchUserData(userId: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${userId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error("Failed to fetch user data", { userId, error });
    throw error;
  }
}

// ✅ 正确 - 并行请求
async function fetchDashboardData(): Promise<DashboardData> {
  const [users, resources, activities] = await Promise.all([
    fetchUsers(),
    fetchResources(),
    fetchActivities(),
  ]);

  return { users, resources, activities };
}

// ❌ 错误 - Promise链过长
function fetchUserData(userId: string) {
  return fetch(`/api/users/${userId}`)
    .then((res) => res.json())
    .then((user) => validateUser(user))
    .then((validUser) => transformUser(validUser))
    .then((transformedUser) => saveUser(transformedUser))
    .catch((error) => handleError(error));
}

// ❌ 错误 - 串行请求（应该并行）
async function fetchDashboardData() {
  const users = await fetchUsers();
  const resources = await fetchResources(); // 等待上一个完成
  const activities = await fetchActivities();
  return { users, resources, activities };
}
```

### 6. 错误处理 🔴 MUST

```typescript
// ✅ 正确 - 自定义错误类
class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value: any
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ✅ 正确 - 详细的错误处理
async function createResource(data: CreateResourceDto): Promise<Resource> {
  try {
    const validated = await validateResourceData(data);
    const resource = await this.prisma.resource.create({ data: validated });
    return resource;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new BadRequestException({
        message: error.message,
        field: error.field,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('Resource already exists');
      }
    }

    logger.error('Failed to create resource', { data, error });
    throw new InternalServerErrorException('Failed to create resource');
  }
}

// ❌ 错误 - 吞噬错误
try {
  await doSomething();
} catch (error) {
  // 什么都不做
}

// ❌ 错误 - 泄露内部错误
catch (error) {
  throw error;  // 直接抛出可能包含敏感信息
}
```

---

## React组件规范

### 1. 组件结构 🔴 MUST

```typescript
// ✅ 正确 - 标准组件结构
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import type { Resource } from '@/types/resource';

interface ResourceCardProps {
  resource: Resource;
  onBookmark?: (resourceId: string) => void;
  variant?: 'default' | 'compact';
}

/**
 * ResourceCard - 显示单个资源的卡片组件
 *
 * @example
 * <ResourceCard resource={resource} onBookmark={handleBookmark} />
 */
export function ResourceCard({
  resource,
  onBookmark,
  variant = 'default'
}: ResourceCardProps) {
  const [isBookmarked, setIsBookmarked] = useState(false);

  const handleBookmarkClick = () => {
    setIsBookmarked(!isBookmarked);
    onBookmark?.(resource.id);
  };

  return (
    <div className={cn('card', variant === 'compact' && 'card-compact')}>
      <h3>{resource.title}</h3>
      <p>{resource.description}</p>
      <Button onClick={handleBookmarkClick}>
        {isBookmarked ? 'Unbookmark' : 'Bookmark'}
      </Button>
    </div>
  );
}
```

**组件顺序**（自上而下）:

1. Imports（外部库 → 内部模块 → 类型）
2. Types/Interfaces
3. Component declaration
4. Hooks
5. Event handlers
6. Render helpers
7. Return JSX

### 2. 组件大小 🔴 MUST

```typescript
// ✅ 正确 - 小而专注的组件
function SearchBar({ onSearch }: SearchBarProps) {
  // < 100 lines
}

// ✅ 正确 - 拆分复杂组件
function ResourcePage() {
  return (
    <div>
      <ResourceHeader />
      <ResourceFilters />
      <ResourceList />
      <ResourcePagination />
    </div>
  );
}

// ❌ 错误 - 臃肿的组件
function ResourcePage() {
  // 500+ lines with all logic mixed together
}
```

**规则**:

- 🔴 MUST: 单个组件不超过200行
- 🔴 MUST: 超过3个职责必须拆分
- 🟡 SHOULD: 推荐每个组件50-100行

### 3. Hooks使用 🔴 MUST

```typescript
// ✅ 正确 - 自定义Hook抽取逻辑
function useResource(resourceId: string) {
  return useQuery({
    queryKey: ['resource', resourceId],
    queryFn: () => fetchResource(resourceId),
    staleTime: 5 * 60 * 1000,
  });
}

// 在组件中使用
function ResourceDetail({ resourceId }: Props) {
  const { data: resource, isLoading, error } = useResource(resourceId);

  if (isLoading) return <Skeleton />;
  if (error) return <Error error={error} />;

  return <div>{resource.title}</div>;
}

// ❌ 错误 - 组件中直接写复杂逻辑
function ResourceDetail({ resourceId }: Props) {
  const [resource, setResource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/resources/${resourceId}`)
      .then(res => res.json())
      .then(data => {
        setResource(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, [resourceId]);

  // ...
}
```

### 4. Props 规范 🔴 MUST

```typescript
// ✅ 正确 - Props接口定义清晰
interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

// ✅ 正确 - 使用对象解构和默认值
function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  ...props
}: ButtonProps) {
  return <button {...props}>{children}</button>;
}

// ❌ 错误 - Props过多（超过5个）
interface ComponentProps {
  prop1: string;
  prop2: number;
  prop3: boolean;
  prop4: string;
  prop5: number;
  prop6: boolean;
  prop7: string;  // 太多了！应该使用配置对象
}
```

---

## Python代码规范

### 1. 命名规范 🔴 MUST

```python
# ✅ 正确
# Classes: PascalCase
class UserService:
    pass

class APIClient:
    pass

# Functions, Variables: snake_case
def fetch_user_data():
    pass

user_id = "123"

# Constants: UPPER_SNAKE_CASE
API_BASE_URL = "https://api.example.com"
MAX_RETRY_COUNT = 3

# Private: leading underscore
class Service:
    def __init__(self):
        self._cache = {}

    def _internal_method(self):
        pass

# ❌ 错误
class userService:  # 应该用PascalCase
    pass

def FetchUserData():  # 应该用snake_case
    pass
```

### 2. 类型提示 🔴 MUST

```python
# ✅ 正确 - 使用类型提示
from typing import List, Dict, Optional
from datetime import datetime

def fetch_users(
    limit: int = 10,
    offset: int = 0
) -> List[Dict[str, any]]:
    """获取用户列表"""
    # implementation
    pass

class UserService:
    def get_user(self, user_id: str) -> Optional[User]:
        """
        获取单个用户

        Args:
            user_id: 用户ID

        Returns:
            User对象，如果不存在返回None
        """
        pass

# ❌ 错误 - 缺少类型提示
def fetch_users(limit, offset):
    pass
```

### 3. 文档字符串 🔴 MUST

```python
# ✅ 正确 - Google风格文档字符串
def calculate_similarity(
    text1: str,
    text2: str,
    method: str = "cosine"
) -> float:
    """
    计算两个文本的相似度

    Args:
        text1: 第一个文本
        text2: 第二个文本
        method: 相似度计算方法，支持 'cosine', 'jaccard'

    Returns:
        相似度分数，范围 [0, 1]

    Raises:
        ValueError: 当method不支持时

    Examples:
        >>> calculate_similarity("hello", "hello world")
        0.816
    """
    pass

# ❌ 错误 - 缺少文档字符串
def calculate_similarity(text1, text2, method="cosine"):
    pass
```

### 4. 错误处理 🔴 MUST

```python
# ✅ 正确 - 具体的异常类型
try:
    user = fetch_user(user_id)
except UserNotFoundError:
    logger.warning(f"User not found: {user_id}")
    raise HTTPException(status_code=404, detail="User not found")
except DatabaseError as e:
    logger.error(f"Database error: {e}")
    raise HTTPException(status_code=500, detail="Internal server error")

# ✅ 正确 - 自定义异常
class ValidationError(Exception):
    """数据验证错误"""
    def __init__(self, message: str, field: str):
        self.message = message
        self.field = field
        super().__init__(self.message)

# ❌ 错误 - 捕获所有异常
try:
    risky_operation()
except Exception:  # 太宽泛
    pass
```

---

## 通用规范

### 1. 注释规范 🟡 SHOULD

```typescript
// ✅ 正确 - 解释"为什么"而不是"是什么"
// 使用缓存避免重复计算，该计算在大数据集上很慢
const cached = memoize(expensiveCalculation);

// 临时解决方案：API v1不返回thumbnails，手动生成
// TODO(2024-12): 迁移到API v2后移除
const thumbnail = resource.thumbnailUrl || generateThumbnail(resource);

// ❌ 错误 - 陈述显而易见的事实
// 设置用户名
const username = user.name;

// 循环遍历数组
for (const item of items) {
  // ...
}
```

**规则**:

- 🔴 MUST: 复杂逻辑必须有注释说明
- 🔴 MUST: TODO必须包含日期和负责人
- 🟡 SHOULD: 注释解释"为什么"，代码表达"做什么"
- 🟢 MAY: 简单代码不需要注释

### 2. 魔法数字 🔴 MUST

```typescript
// ✅ 正确 - 使用命名常量
const MAX_RETRY_COUNT = 3;
const API_TIMEOUT_MS = 5000;
const ITEMS_PER_PAGE = 20;

if (retryCount > MAX_RETRY_COUNT) {
  throw new Error("Max retries exceeded");
}

// ❌ 错误 - 魔法数字
if (retryCount > 3) {
  // 3是什么？
  throw new Error("Max retries exceeded");
}

setTimeout(callback, 5000); // 5000是什么单位？
```

### 3. 代码组织 🔴 MUST

```
# 文件内部组织顺序

1. Imports
   - 标准库
   - 第三方库
   - 内部模块
   - 类型导入

2. Constants

3. Types/Interfaces

4. Main Code
   - Classes
   - Functions

5. Exports
```

---

## 工具配置

### ESLint

见 `.eslintrc.json` - 由自动化工具强制执行

### Prettier

见 `.prettierrc` - 由自动化工具强制执行

### 自动化检查

所有代码风格规则通过以下方式强制执行：

- **Pre-commit hook**: 自动格式化和lint
- **CI/CD**: 质量门禁检查
- **IDE配置**: 推荐使用VS Code + ESLint + Prettier插件

---

## 参考资料

- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [PEP 8 - Python Style Guide](https://peps.python.org/pep-0008/)
- [React TypeScript Cheatsheet](https://react-typescript-cheatsheet.netlify.app/)

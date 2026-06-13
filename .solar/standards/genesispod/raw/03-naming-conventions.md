# 命名规范

**版本：** 1.0
**强制级别：** 🔴 MUST
**更新日期：** 2025-11-08

---

## 核心原则

```
✅ 清晰和一致 > 简洁
✅ 名字应该表达意图和用途
✅ 避免歧义和过度缩写
✅ 保持团队命名风格统一
```

---

## 文件和目录命名

### 🔴 MUST - 严格遵守

#### 1. TypeScript/JavaScript 文件

```
✅ 组件文件: PascalCase
   ResourceCard.tsx
   FeedList.tsx
   AIInsightPanel.tsx

✅ 工具函数文件: kebab-case
   api-client.ts
   date-utils.ts
   string-helpers.ts

✅ 配置文件: kebab-case
   next.config.js
   tailwind.config.ts
   jest.config.js

❌ resource-card.tsx (组件应该用 PascalCase)
❌ apiClient.ts (应该用 kebab-case)
❌ DateUtils.ts (工具文件应该用 kebab-case)
```

#### 2. Python 文件

```
✅ 所有Python文件: snake_case
   grok_client.py
   ai_orchestrator.py
   secret_manager.py

✅ 测试文件: test_ 前缀
   test_grok_client.py
   test_orchestrator.py

❌ GrokClient.py (应该用 snake_case)
❌ grok-client.py (应该用 snake_case，不是 kebab-case)
```

#### 3. 目录名

```
✅ 全部小写，kebab-case（TypeScript/JavaScript）
   ai-service/
   knowledge-graph/
   data-sources/

✅ 全部小写，snake_case（Python）
   ai_service/services/
   utils/secret_manager/

❌ AIService/ (应该小写)
❌ KnowledgeGraph/ (应该小写)
```

#### 4. Markdown 文档文件

```
✅ kebab-case (间隔号)
   00-overview.md
   quick-reference.md
   api-design.md
   system-architecture.md
   readme.md
   CONTRIBUTING.md

❌ 00_overview.md (文档用 kebab-case)
❌ QuickReference.md (应该小写)
❌ API_DESIGN.md (应该用 kebab-case)
```

**说明**: Markdown 使用 kebab-case 因为：

- 更易读: `quick-reference` vs `quick_reference`
- 符合 Web 标准: GitHub, GitLab 等都采用这种格式
- 更适合 URL: `/docs/quick-reference`

---

## TypeScript/JavaScript 命名

### 🔴 MUST - 严格遵守

#### 1. 类和接口

```typescript
✅ 类名: PascalCase
class ResourceService {
  // ...
}

class AIOrchestrator {
  // ...
}

✅ 接口: PascalCase，可选 I 前缀
interface User {
  id: string;
  email: string;
}

interface IResourceRepository {
  findById(id: string): Promise<Resource>;
}

✅ 类型别名: PascalCase
type ResourceType = 'PAPER' | 'PROJECT' | 'NEWS';
type UserId = string;

❌ class resourceService {} (应该 PascalCase)
❌ interface user {} (应该 PascalCase)
```

#### 2. 函数和方法

```typescript
✅ 函数名: camelCase，动词开头
function getResourceById(id: string): Resource {}
async function fetchRecommendations(): Promise<Resource[]> {}
function createResource(data: CreateResourceDto): Resource {}

✅ 布尔函数: is/has/can 前缀
function isValid(data: unknown): boolean {}
function hasPermission(user: User): boolean {}
function canPublish(resource: Resource): boolean {}

✅ 事件处理函数: handle 前缀
function handleClick(event: MouseEvent): void {}
function handleSubmit(data: FormData): void {}

❌ function GetResource() {} (应该 camelCase)
❌ function valid() {} (布尔函数应该 is 前缀)
❌ function onClick() {} (事件处理应该 handle 前缀)
```

#### 3. 变量和常量

```typescript
✅ 变量: camelCase
const userId = '123';
let activeResource: Resource | null = null;
const isLoading = false;

✅ 常量: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const API_BASE_URL = 'http://localhost:4000';
const DEFAULT_TIMEOUT = 30000;

✅ 环境变量: UPPER_SNAKE_CASE
process.env.DATABASE_URL
process.env.GROK_API_KEY
process.env.NODE_ENV

✅ 布尔变量: is/has/can 前缀
const isValid = true;
const hasError = false;
const canEdit = user.role === 'admin';

✅ 集合变量: 复数形式
const resources: Resource[] = [];
const users = await findAllUsers();
const errorMessages = new Map<string, string>();

❌ const user_id = '123'; (应该 camelCase)
❌ const max_retry = 3; (常量应该 UPPER_SNAKE_CASE)
❌ const valid = true; (布尔变量应该 is 前缀)
❌ const resource = []; (集合应该复数)
```

#### 4. React 组件

```tsx
✅ 组件名: PascalCase
export const ResourceCard: React.FC<ResourceCardProps> = (props) => {
  return <div>...</div>;
};

export function FeedList({ items }: FeedListProps) {
  return <ul>...</ul>;
}

✅ Props 接口: 组件名 + Props
interface ResourceCardProps {
  resource: Resource;
  onSave?: (id: string) => void;
}

✅ Hooks: use 前缀 + camelCase
function useResourceData(id: string) {
  // ...
}

function useAuth() {
  // ...
}

❌ export const resourceCard = () => {} (应该 PascalCase)
❌ interface Props {} (应该明确: ResourceCardProps)
❌ function getResourceData() {} (hooks 应该 use 前缀)
```

#### 5. NestJS 特定命名

```typescript
✅ Controller: PascalCase + Controller 后缀
@Controller('resources')
export class ResourceController {
  // ...
}

✅ Service: PascalCase + Service 后缀
@Injectable()
export class ResourceService {
  // ...
}

✅ Module: PascalCase + Module 后缀
@Module({
  controllers: [ResourceController],
  providers: [ResourceService],
})
export class ResourceModule {}

✅ DTO: PascalCase + Dto 后缀
export class CreateResourceDto {
  @IsString()
  title: string;

  @IsEnum(ResourceType)
  type: ResourceType;
}

✅ Entity: PascalCase (Prisma 模型)
model Resource {
  id    String @id @default(uuid())
  title String
}

❌ class ResourcesController {} (应该单数: ResourceController)
❌ class CreateResource {} (DTO 应该有 Dto 后缀)
```

---

## Python 命名

### 🔴 MUST - 严格遵守

#### 1. 类和异常

```python
✅ 类名: PascalCase
class GrokClient:
    pass

class AIOrchestrator:
    pass

class ResourceProcessor:
    pass

✅ 异常类: PascalCase + Error 后缀
class GrokAPIError(Exception):
    pass

class InvalidConfigError(Exception):
    pass

class DatabaseConnectionError(Exception):
    pass

❌ class grok_client: (应该 PascalCase)
❌ class Error (太通用)
❌ class ClientError (应该更具体: GrokClientError)
```

#### 2. 函数和方法

```python
✅ 函数名: snake_case
def generate_summary(text: str) -> str:
    pass

async def fetch_resources(limit: int = 20) -> list[Resource]:
    pass

def create_embedding(text: str) -> list[float]:
    pass

✅ 布尔函数: is_/has_/can_ 前缀
def is_valid(data: dict) -> bool:
    pass

def has_permission(user: User) -> bool:
    pass

✅ 私有方法: _ 前缀
class AIService:
    def public_method(self):
        pass

    def _private_method(self):
        pass

    def __very_private_method(self):
        pass

❌ def generateSummary() (应该 snake_case)
❌ def valid() (布尔函数应该 is_ 前缀)
```

#### 3. 变量和常量

```python
✅ 变量: snake_case
user_id = "123"
active_resource = None
is_loading = False

✅ 常量: UPPER_SNAKE_CASE
MAX_RETRY_COUNT = 3
API_BASE_URL = "https://api.x.ai/v1"
DEFAULT_TIMEOUT = 30

✅ 环境变量: UPPER_SNAKE_CASE
os.getenv('GROK_API_KEY')
os.getenv('DATABASE_URL')

✅ 布尔变量: is_/has_/can_ 前缀
is_valid = True
has_error = False
can_retry = attempt < MAX_RETRY_COUNT

✅ 集合变量: 复数形式
resources: list[Resource] = []
user_ids = [1, 2, 3]
error_messages = {}

❌ userId = "123" (应该 snake_case)
❌ MAX_RETRY = 3 (常量应该完整: MAX_RETRY_COUNT)
❌ valid = True (布尔变量应该 is_ 前缀)
```

#### 4. FastAPI 特定命名

```python
✅ Router: snake_case
router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

✅ 路由函数: snake_case，动词开头
@router.post("/summary")
async def generate_summary(request: SummaryRequest) -> SummaryResponse:
    pass

@router.get("/health")
async def check_health() -> HealthResponse:
    pass

✅ Pydantic 模型: PascalCase
class SummaryRequest(BaseModel):
    text: str
    max_length: int = 500

class SummaryResponse(BaseModel):
    summary: str
    tokens_used: int
```

---

## 数据库命名

### 🔴 MUST - 严格遵守

#### 1. Prisma Schema（PostgreSQL）

```prisma
✅ 模型名: PascalCase 单数
model User {
  id    String @id @default(uuid())
  email String @unique

  @@map("users")  // 表名: 复数
}

model Resource {
  id          String       @id @default(uuid())
  type        ResourceType
  title       String

  @@map("resources")
}

✅ 字段名: camelCase（Prisma）→ snake_case（数据库）
model Resource {
  id          String   @id @default(uuid())
  aiSummary   String?  @map("ai_summary")  // DB: ai_summary
  createdAt   DateTime @default(now()) @map("created_at")
  publishedAt DateTime? @map("published_at")
}

✅ 枚举: PascalCase
enum ResourceType {
  PAPER
  PROJECT
  NEWS
  EVENT
}

✅ 关系字段: camelCase 复数
model User {
  collections Collection[]  // 一对多: 复数
  profile     UserProfile?  // 一对一: 单数
}
```

#### 2. 数据库表和列（实际数据库）

```sql
✅ 表名: snake_case 复数
CREATE TABLE users (...)
CREATE TABLE resources (...)
CREATE TABLE user_collections (...)

✅ 列名: snake_case
CREATE TABLE resources (
  id            UUID PRIMARY KEY,
  title         VARCHAR(1000),
  ai_summary    TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  published_at  TIMESTAMP
);

✅ 主键: 简单的 id
CREATE TABLE users (
  id UUID PRIMARY KEY,
  ...
);

✅ 外键: 表名_id
CREATE TABLE resources (
  id      UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  ...
);

✅ 索引: idx_表名_列名
CREATE INDEX idx_resources_type ON resources(type);
CREATE INDEX idx_resources_created_at ON resources(created_at DESC);
CREATE INDEX idx_users_email ON users(email);

✅ 唯一索引: uq_表名_列名
CREATE UNIQUE INDEX uq_users_email ON users(email);

✅ 外键约束: fk_表名_引用表名
ALTER TABLE resources
  ADD CONSTRAINT fk_resources_users
  FOREIGN KEY (user_id) REFERENCES users(id);

❌ CREATE TABLE Users (应该小写)
❌ CREATE TABLE resource (应该复数)
❌ user_id UUID PRIMARY KEY (主键应该叫 id)
❌ CREATE INDEX index1 (应该有意义的名字)
```

#### 3. MongoDB 集合和字段

```javascript
✅ 集合名: snake_case 复数
db.resources_raw
db.arxiv_papers
db.github_projects

✅ 字段名: camelCase
{
  _id: ObjectId,
  title: "...",
  abstractText: "...",
  sourceUrl: "...",
  createdAt: ISODate,
  metadata: {
    arxivId: "...",
    categories: []
  }
}
```

#### 4. Neo4j 图数据库

```cypher
✅ 节点标签: PascalCase
(:User)
(:Resource)
(:Concept)

✅ 关系类型: UPPER_SNAKE_CASE
(:User)-[:SAVED]->(:Resource)
(:Resource)-[:HAS_CONCEPT]->(:Concept)
(:Concept)-[:RELATED_TO]->(:Concept)

✅ 属性名: camelCase
CREATE (r:Resource {
  id: "123",
  title: "...",
  createdAt: datetime()
})
```

---

## API 路由命名

### 🔴 MUST - 严格遵守

```
✅ 路径: kebab-case 全小写
GET    /api/v1/resources
GET    /api/v1/resources/{id}
GET    /api/v1/data-sources
POST   /api/v1/ai/generate-summary
GET    /api/v1/knowledge-graph/nodes

✅ 资源: 复数名词
GET    /api/v1/resources (不是 /resource)
GET    /api/v1/users (不是 /user)

✅ ID 参数: {id} 或 {resourceId}
GET    /api/v1/resources/{id}
GET    /api/v1/users/{userId}/collections

✅ 子资源: 层级结构
GET    /api/v1/resources/{id}/comments
POST   /api/v1/resources/{id}/save
DELETE /api/v1/users/{id}/collections/{collectionId}

✅ 自定义操作: 动词，但罕见使用
POST   /api/v1/resources/{id}/publish
POST   /api/v1/ai/generate-summary

❌ GET /api/v1/getResources (路径不用动词)
❌ GET /api/v1/Resources (应该小写)
❌ GET /api/v1/resource (应该复数)
❌ GET /api/v1/resources_all (应该 kebab-case)
```

---

## Git 分支和提交

### 🔴 MUST - 严格遵守

#### 1. 分支命名

```bash
✅ 功能分支: feature/{number}-{description}
feature/001-add-pdf-proxy
feature/002-implement-knowledge-graph
feature/003-ai-recommendations

✅ Bug 修复: bugfix/{description}
bugfix/fix-timeout-error
bugfix/001-fix-duplicate-detection

✅ 紧急修复: hotfix/{description}
hotfix/critical-security-patch
hotfix/001-database-connection-fix

✅ 重构: refactor/{description}
refactor/optimize-query-performance
refactor/simplify-ai-client

❌ feature/newStuff (应该更具体)
❌ feature_add_feature (应该用 kebab-case)
❌ Feature/AddFeature (应该小写)
```

#### 2. 提交信息（Conventional Commits）

```bash
✅ 格式: <type>(<scope>): <subject>

feat(proxy): add PDF proxy for arXiv papers
fix(frontend): resolve PDF iframe blocking issue
refactor(ai-service): optimize Grok API retry logic
docs(readme): update installation instructions
test(backend): add resource controller tests
chore(deps): update dependencies

✅ Type:
feat, fix, refactor, test, docs, chore, perf, ci, style, revert

✅ Scope:
frontend, backend, ai-service, crawler,
proxy, resource, feed, api, database, auth

✅ Subject:
- 首字母小写
- 祈使语 (add, fix 不是 added, fixed)
- 不以句号结尾
- < 50 字符

❌ Add PDF proxy (首字母应该小写)
❌ fix: fixed the bug (应该用祈使语: fix)
❌ feat: add feature. (不应该有句号)
```

---

## 命名检查清单

提交代码前检查：

- [ ] 所有 TypeScript 文件遵循命名规范
- [ ] 所有 Python 文件使用 snake_case
- [ ] React 组件使用 PascalCase
- [ ] 函数使用 camelCase (TS) 或 snake_case (Py)
- [ ] 布尔函数/变量使用 is/has/can 前缀
- [ ] 常量使用 UPPER_SNAKE_CASE
- [ ] 数据库表名使用 snake_case 复数
- [ ] API 路由使用 kebab-case
- [ ] Git 分支名遵循 prefix/description 格式
- [ ] 提交信息遵循 Conventional Commits
- [ ] 没有单字母变量（循环除外）
- [ ] 没有过度缩写或歧义名称

---

## 常见错误示例

```typescript
❌ 错误示例
const data = fetchData();  // 太模糊
function process() {}      // 太通用
let temp = 123;           // 无意义
const x = getUserId();    // 单字母
const usr = getUser();    // 过度缩写

✅ 正确示例
const userData = fetchUserData();
function processResource() {}
let retryAttempt = 0;
const userId = getUserId();
const user = getUser();
```

---

**记住：** 好的命名是最好的文档！清晰的命名让代码自解释，减少注释需求。

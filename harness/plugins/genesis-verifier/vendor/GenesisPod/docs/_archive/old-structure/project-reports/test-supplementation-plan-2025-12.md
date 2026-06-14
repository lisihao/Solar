# GenesisPod 测试补充计划

> 制定日期: 2025-12-14
> 当前覆盖率: < 10% (估算)
> 目标覆盖率: 60%+ (核心模块)

---

## 一、现状分析

### 1.1 现有测试统计

| 类型                | 数量         | 覆盖模块                 |
| ------------------- | ------------ | ------------------------ |
| Backend Unit Tests  | 15个文件     | AI编排、去重、认证、资源 |
| Frontend Unit Tests | 4个文件      | Hooks、缓存              |
| E2E Tests           | 1个文件      | 基础健康检查             |
| Integration Tests   | 0            | -                        |
| **总计**            | **20个文件** |                          |

### 1.2 关键缺口

| 模块                     | 重要性 | 当前测试 | 风险等级 |
| ------------------------ | ------ | -------- | -------- |
| AI Office (PPT/文档生成) | P0     | 0        | **极高** |
| AI Image (图片生成)      | P0     | 0        | **极高** |
| AI Studio (工作区)       | P1     | 0        | 高       |
| Feed 数据流              | P1     | 0        | 高       |
| Collections 收藏         | P1     | 0        | 高       |
| Notes 笔记               | P2     | 0        | 中       |
| Data Collection 采集     | P1     | 1 (部分) | 中       |

---

## 二、测试策略

### 2.1 测试金字塔

```
        /\
       /  \     E2E Tests (10%)
      /----\    - 关键用户流程
     /      \   - 跨模块集成
    /--------\  Integration Tests (30%)
   /          \ - API端点测试
  /            \- 数据库交互
 /--------------\ Unit Tests (60%)
/                \ - 服务逻辑
------------------  - 工具函数
```

### 2.2 优先级排序原则

1. **P0 - 必须测试**: 核心收入功能、数据完整性
2. **P1 - 应该测试**: 主要用户流程、关键集成点
3. **P2 - 可以测试**: 辅助功能、边缘情况

---

## 三、分阶段实施计划

### Phase 1: 止血期 (Week 1-2)

**目标**: 覆盖最高风险的核心功能

#### 3.1.1 AI Office 模块测试

```typescript
// backend/src/modules/ai/ai-office/__tests__/

// 文档生成测试
document-generation.service.spec.ts
├── describe('generateDocument')
│   ├── it('should generate article from prompt')
│   ├── it('should generate PPT outline correctly')
│   ├── it('should handle empty input gracefully')
│   └── it('should respect max length limits')

// 文档导出测试
document-export.service.spec.ts
├── describe('exportToPPTX')
│   ├── it('should export valid PPTX file')
│   ├── it('should apply template colors correctly')
│   └── it('should handle Chinese characters')
├── describe('exportToDocx')
│   ├── it('should export valid DOCX file')
│   └── it('should preserve markdown formatting')

// 意图解析测试
intent-parser.service.spec.ts
├── describe('parseIntent')
│   ├── it('should detect PPT generation intent')
│   ├── it('should detect article generation intent')
│   └── it('should handle ambiguous input')
```

**预估工作量**: 3天

#### 3.1.2 AI Image 模块测试

```typescript
// backend/src/modules/ai/ai-image/__tests__/

ai-image.service.spec.ts
├── describe('generateImage')
│   ├── it('should call correct image model')
│   ├── it('should handle prompt enhancement')
│   └── it('should save image to database')
├── describe('autoTagImages')
│   ├── it('should generate tags for images')
│   └── it('should handle empty image list')
├── describe('analyzeStyles')
│   └── it('should identify art styles')
```

**预估工作量**: 2天

#### 3.1.3 认证授权测试补充

```typescript
// backend/src/modules/ai-infra/auth/__tests__/

jwt-auth.guard.spec.ts
├── describe('canActivate')
│   ├── it('should allow valid JWT token')
│   ├── it('should reject expired token')
│   ├── it('should reject malformed token')
│   └── it('should handle missing token')
```

**预估工作量**: 1天

---

### Phase 2: 夯实期 (Week 3-4)

**目标**: 覆盖主要用户流程

#### 3.2.1 Feed 模块测试

```typescript
// backend/src/modules/content/feed/__tests__/

feed.service.spec.ts
├── describe('getFeed')
│   ├── it('should return paginated feed items')
│   ├── it('should filter by category')
│   ├── it('should sort by recency')
│   └── it('should exclude user-hidden items')
├── describe('refreshFeed')
│   ├── it('should trigger data collection')
│   └── it('should deduplicate results')
```

**预估工作量**: 2天

#### 3.2.2 Collections 模块测试

```typescript
// backend/src/modules/content/collections/__tests__/

collections.service.spec.ts
├── describe('createCollection')
│   ├── it('should create collection for user')
│   └── it('should prevent duplicate names')
├── describe('addToCollection')
│   ├── it('should add resource to collection')
│   └── it('should prevent duplicate entries')
├── describe('AI organization')
│   ├── it('should batch tag resources')
│   ├── it('should smart classify resources')
│   └── it('should discover theme clusters')
```

**预估工作量**: 2天

#### 3.2.3 Notes 模块测试

```typescript
// backend/src/modules/content/notes/__tests__/

notes.service.spec.ts
├── describe('CRUD operations')
│   ├── it('should create note')
│   ├── it('should update note content')
│   └── it('should delete note')
├── describe('AI features')
│   ├── it('should extract key points')
│   ├── it('should find connections')
│   └── it('should generate summary')
```

**预估工作量**: 2天

#### 3.2.4 Data Collection 测试补充

```typescript
// backend/src/modules/data-services/data-collection/__tests__/

data-collection.service.spec.ts
├── describe('collectFromUrl')
│   ├── it('should extract article content')
│   ├── it('should store raw data correctly')
│   ├── it('should create resource reference')
│   └── it('should apply 4-layer deduplication')
├── describe('batchCollection')
│   ├── it('should process multiple URLs')
│   └── it('should handle rate limiting')
```

**预估工作量**: 2天

---

### Phase 3: 加固期 (Week 5-6)

**目标**: E2E测试 + 集成测试

#### 3.3.1 E2E 测试套件

```typescript
// backend/test/e2e/

auth.e2e-spec.ts
├── describe('Authentication Flow')
│   ├── it('should register new user')
│   ├── it('should login and receive JWT')
│   ├── it('should refresh token')
│   └── it('should logout')

ai-office.e2e-spec.ts
├── describe('Document Generation Flow')
│   ├── it('should generate and export PPT')
│   ├── it('should generate and export article')
│   └── it('should handle streaming response')

feed.e2e-spec.ts
├── describe('Feed Flow')
│   ├── it('should load feed with pagination')
│   ├── it('should bookmark item')
│   └── it('should add to collection')
```

**预估工作量**: 4天

#### 3.3.2 Frontend 测试补充

```typescript
// frontend/__tests__/

components/
├── AIOrganizePanel.test.tsx
│   ├── it('should render all tabs')
│   ├── it('should handle task execution')
│   └── it('should display results modal')

hooks/
├── useAIGeneration.test.ts
│   ├── it('should handle streaming response')
│   └── it('should manage loading state')

lib/
├── api-client.test.ts
│   ├── it('should add auth header')
│   └── it('should handle errors')
```

**预估工作量**: 3天

---

## 四、测试文件结构规范

### 4.1 Backend 目录结构

```
backend/src/modules/
├── ai/
│   ├── ai-office/
│   │   ├── __tests__/                    # 单元测试目录
│   │   │   ├── document-generation.service.spec.ts
│   │   │   ├── document-export.service.spec.ts
│   │   │   └── intent-parser.service.spec.ts
│   │   ├── document-generation.service.ts
│   │   └── ...
│   └── ai-image/
│       ├── __tests__/
│       │   └── ai-image.service.spec.ts
│       └── ...
└── ...

backend/test/                             # E2E测试目录
├── e2e/
│   ├── auth.e2e-spec.ts
│   ├── ai-office.e2e-spec.ts
│   └── feed.e2e-spec.ts
├── fixtures/                             # 测试数据
│   ├── users.fixture.ts
│   └── resources.fixture.ts
└── utils/                                # 测试工具
    ├── test-db.ts
    └── test-auth.ts
```

### 4.2 命名规范

| 类型     | 命名格式        | 示例                       |
| -------- | --------------- | -------------------------- |
| 单元测试 | `*.spec.ts`     | `ai-image.service.spec.ts` |
| E2E测试  | `*.e2e-spec.ts` | `auth.e2e-spec.ts`         |
| 测试工具 | `test-*.ts`     | `test-db.ts`               |
| 测试数据 | `*.fixture.ts`  | `users.fixture.ts`         |

---

## 五、测试模板

### 5.1 Service 单元测试模板

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { MyService } from "./my.service";
import { PrismaService } from "../../../common/prisma/prisma.service";

describe("MyService", () => {
  let service: MyService;
  let prisma: PrismaService;

  const mockPrisma = {
    myModel: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MyService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<MyService>(MyService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("methodName", () => {
    it("should do expected behavior", async () => {
      // Arrange
      mockPrisma.myModel.findMany.mockResolvedValue([]);

      // Act
      const result = await service.methodName();

      // Assert
      expect(result).toEqual([]);
      expect(mockPrisma.myModel.findMany).toHaveBeenCalledTimes(1);
    });

    it("should handle error case", async () => {
      // Arrange
      mockPrisma.myModel.findMany.mockRejectedValue(new Error("DB Error"));

      // Act & Assert
      await expect(service.methodName()).rejects.toThrow("DB Error");
    });
  });
});
```

### 5.2 E2E 测试模板

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";

describe("Feature E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix("api/v1");
    await app.init();

    prisma = app.get(PrismaService);

    // Setup test user and get auth token
    authToken = await getTestAuthToken(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe("POST /api/v1/endpoint", () => {
    it("should create resource", () => {
      return request(app.getHttpServer())
        .post("/api/v1/endpoint")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ field: "value" })
        .expect(201)
        .expect((res) => {
          expect(res.body.id).toBeDefined();
        });
    });

    it("should return 401 without auth", () => {
      return request(app.getHttpServer())
        .post("/api/v1/endpoint")
        .send({ field: "value" })
        .expect(401);
    });
  });
});
```

---

## 六、CI/CD 集成

### 6.1 GitHub Actions 配置

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: |
          cd backend && npm ci
          cd ../frontend && npm ci

      - name: Run backend unit tests
        run: cd backend && npm run test:cov

      - name: Run frontend unit tests
        run: cd frontend && npm run test

      - name: Upload coverage
        uses: codecov/codecov-action@v3

  e2e-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: deepdive_test
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4

      - name: Run E2E tests
        run: cd backend && npm run test:e2e
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/deepdive_test
```

### 6.2 Pre-commit Hook

```bash
# .husky/pre-commit
#!/bin/sh
npm run test:affected
```

---

## 七、执行时间表

| 阶段    | 周次 | 交付物                          | 负责人 |
| ------- | ---- | ------------------------------- | ------ |
| Phase 1 | W1-2 | AI Office + AI Image 测试       | TBD    |
| Phase 2 | W3-4 | Feed + Collections + Notes 测试 | TBD    |
| Phase 3 | W5-6 | E2E + Frontend 测试             | TBD    |
| CI/CD   | W6   | GitHub Actions 配置             | TBD    |

---

## 八、成功指标

| 指标           | 当前值 | Phase 1 目标 | Phase 3 目标 |
| -------------- | ------ | ------------ | ------------ |
| 单元测试覆盖率 | ~10%   | 40%          | 60%          |
| E2E测试用例数  | 2      | 10           | 30           |
| CI测试通过率   | -      | 95%          | 99%          |
| 测试执行时间   | -      | < 3min       | < 5min       |

---

## 九、风险与缓解

| 风险           | 影响         | 缓解措施             |
| -------------- | ------------ | -------------------- |
| Mock复杂度高   | 测试编写困难 | 提供通用mock工具库   |
| 外部API依赖    | 测试不稳定   | 使用录制/回放模式    |
| 数据库状态污染 | 测试相互影响 | 每个测试使用事务回滚 |
| 测试执行时间长 | CI反馈慢     | 并行执行 + 增量测试  |

---

_文档版本: v1.0_
_最后更新: 2025-12-14_

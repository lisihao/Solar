# Topic Research 模块系统性改进方案

> **版本**: v1.0
> **日期**: 2026-01-25
> **制定者**: 架构委员会（安全专家、架构师、DFX专家、业务专家）
> **目标**: 将模块质量从当前 55 分提升至 85 分以上

---

## 执行摘要

基于全面诊断，本方案分 5 个阶段、14 周完成系统性改进：

| 阶段        | 周期       | 重点     | 目标                     |
| ----------- | ---------- | -------- | ------------------------ |
| **Phase 1** | Week 1-2   | 安全加固 | 消除所有严重/高危漏洞    |
| **Phase 2** | Week 3-4   | 测试基建 | 核心流程测试覆盖率达 60% |
| **Phase 3** | Week 5-8   | 架构重构 | 解耦上帝类、引入任务队列 |
| **Phase 4** | Week 9-12  | 质量提升 | 清理技术债、增强可观测性 |
| **Phase 5** | Week 13-14 | 服务弹性 | 自动恢复、零停机部署     |

**预期成果**:

- 安全评分: 45 → 90
- 测试覆盖: 0% → 70%
- 代码质量: 55 → 80
- 架构健康: 65 → 85
- 服务弹性: 支持自动恢复、优雅关机

---

## Phase 1: 安全加固 (Week 1-2)

### 1.1 P0 紧急修复 (Week 1, Day 1-3)

#### 任务 1.1.1: 消除 SQL 注入风险

**责任人**: 后端安全专家
**预估工时**: 4h
**影响文件**: `topic-research.service.ts`

```typescript
// ❌ 当前代码 (Line 583, 751, 2420)
const visibleTopicIds = await this.prisma.$queryRaw<{ id: string }[]>`
  SELECT id FROM research_topics
  WHERE "user_id" = ${userId}
     OR visibility = 'PUBLIC'
     OR (visibility = 'SHARED' AND id = ANY(${collaboratorTopicIds}::text[]))
`;

// ✅ 修复方案: 使用 Prisma ORM
async getVisibleTopicIds(userId: string): Promise<string[]> {
  // 1. 获取用户作为协作者的 Topic IDs
  const collaboratorTopics = await this.prisma.topicCollaborator.findMany({
    where: { userId, isActive: true },
    select: { topicId: true },
  });
  const collaboratorTopicIds = collaboratorTopics.map(c => c.topicId);

  // 2. 查询可见的 Topics
  const visibleTopics = await this.prisma.researchTopic.findMany({
    where: {
      OR: [
        { userId },                           // 自己的
        { visibility: 'PUBLIC' },             // 公开的
        {
          AND: [
            { visibility: 'SHARED' },
            { id: { in: collaboratorTopicIds } }  // 协作的
          ]
        }
      ]
    },
    select: { id: true }
  });

  return visibleTopics.map(t => t.id);
}

// 同样重构 checkTopicAccess 方法
async checkTopicAccess(userId: string, topicId: string): Promise<boolean> {
  const topic = await this.prisma.researchTopic.findUnique({
    where: { id: topicId },
    include: {
      collaborators: {
        where: { userId, isActive: true },
        take: 1
      }
    }
  });

  if (!topic) return false;

  // 权限判断
  if (topic.userId === userId) return true;           // 所有者
  if (topic.visibility === 'PUBLIC') return true;     // 公开
  if (topic.visibility === 'SHARED' && topic.collaborators.length > 0) return true;

  return false;
}
```

**验证方式**:

```bash
# 1. 搜索所有 $queryRaw 使用
grep -r "\$queryRaw" backend/src/modules/ai-app/research/topic-research/

# 2. 确保返回 0 结果
# 3. 运行类型检查
npm run type-check
```

---

#### 任务 1.1.2: 添加全局速率限制

**责任人**: 后端架构师
**预估工时**: 6h
**新增文件**: `rate-limit.guard.ts`, `rate-limit.decorator.ts`

```typescript
// ========== 1. 创建速率限制装饰器 ==========
// backend/src/common/decorators/rate-limit.decorator.ts

import { SetMetadata } from '@nestjs/common';

export interface RateLimitOptions {
  windowSeconds: number;    // 时间窗口（秒）
  maxRequests: number;      // 最大请求数
  keyPrefix?: string;       // Redis key 前缀
  errorMessage?: string;    // 自定义错误消息
}

export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

// ========== 2. 创建速率限制守卫 ==========
// backend/src/common/guards/rate-limit.guard.ts

import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler()
    );

    if (!options) return true; // 无配置则跳过

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id || request.ip;
    const endpoint = `${request.method}:${request.route.path}`;

    const key = `rate_limit:${options.keyPrefix || endpoint}:${userId}`;

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, options.windowSeconds);
    }

    if (current > options.maxRequests) {
      const ttl = await this.redis.ttl(key);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: options.errorMessage || `请求过于频繁，请 ${ttl} 秒后重试`,
          retryAfter: ttl,
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    return true;
  }
}

// ========== 3. 应用到 Controller ==========
// topic-research.controller.ts

import { RateLimit } from '@/common/decorators/rate-limit.decorator';

@Controller('topic-research')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class TopicResearchController {

  // AI 密集型操作 - 严格限制
  @Post('topics/:id/research/smart-start')
  @RateLimit({
    windowSeconds: 3600,
    maxRequests: 5,
    errorMessage: '研究启动过于频繁，每小时最多 5 次'
  })
  async smartStartResearch(...) {}

  @Post('topics/:id/leader-chat')
  @RateLimit({
    windowSeconds: 60,
    maxRequests: 20,
    errorMessage: '聊天请求过于频繁'
  })
  async leaderChat(...) {}

  @Post('topics/:id/refresh')
  @RateLimit({
    windowSeconds: 300,
    maxRequests: 3,
    errorMessage: '刷新过于频繁，每 5 分钟最多 3 次'
  })
  async triggerRefresh(...) {}

  // 普通读取操作 - 宽松限制
  @Get('topics')
  @RateLimit({ windowSeconds: 60, maxRequests: 100 })
  async listTopics(...) {}

  @Get('topics/:id')
  @RateLimit({ windowSeconds: 60, maxRequests: 200 })
  async getTopic(...) {}
}
```

**速率限制配置表**:

| 端点                    | 窗口  | 限制 | 理由                    |
| ----------------------- | ----- | ---- | ----------------------- |
| `/research/smart-start` | 1h    | 5    | AI 研究成本高 ($10+/次) |
| `/leader-chat`          | 1min  | 20   | AI 对话频繁但单次成本低 |
| `/refresh`              | 5min  | 3    | 刷新消耗资源            |
| `/reports/:id/ai-edit`  | 10min | 10   | AI 编辑成本中等         |
| `GET /topics`           | 1min  | 100  | 读取操作宽松            |
| `GET /reports`          | 1min  | 200  | 报告查看频繁            |

---

#### 任务 1.1.3: 清理敏感日志

**责任人**: 后端开发
**预估工时**: 2h
**影响文件**: `topic-research.controller.ts`

```bash
# 1. 查找所有 console.log/error/warn
grep -rn "console\." backend/src/modules/ai-app/research/topic-research/

# 2. 替换为 Logger
```

```typescript
// ❌ 当前 (Line 1447, 1451)
console.error(`[leaderChat] Schedule TODO failed: ${err.message}`);

// ✅ 修复
this.logger.error(
  `[leaderChat] Schedule TODO failed`,
  { error: err.message, topicId, userId },
  err.stack,
);
```

**验证**:

```bash
# 确保 0 console 调用
grep -c "console\." backend/src/modules/ai-app/research/topic-research/*.ts
# 预期输出: 0
```

---

### 1.2 高危问题修复 (Week 1, Day 4-5)

#### 任务 1.2.1: 统一访问控制

**责任人**: 后端安全专家
**预估工时**: 8h
**新增文件**: `topic-access.guard.ts`

```typescript
// ========== 1. 创建 Topic 访问装饰器 ==========
// backend/src/common/decorators/topic-access.decorator.ts

import { SetMetadata } from '@nestjs/common';

export type AccessLevel = 'viewer' | 'editor' | 'admin' | 'owner';

export const TOPIC_ACCESS_KEY = 'topic_access';
export const RequireTopicAccess = (level: AccessLevel = 'viewer') =>
  SetMetadata(TOPIC_ACCESS_KEY, level);

// ========== 2. 创建统一访问守卫 ==========
// backend/src/common/guards/topic-access.guard.ts

@Injectable()
export class TopicAccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredLevel = this.reflector.get<AccessLevel>(
      TOPIC_ACCESS_KEY,
      context.getHandler()
    );

    if (!requiredLevel) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    const topicId = request.params.id || request.params.topicId;

    if (!userId || !topicId) {
      throw new UnauthorizedException('Missing user or topic');
    }

    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      include: {
        collaborators: {
          where: { userId, isActive: true },
          select: { role: true }
        }
      }
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    // 所有者拥有所有权限
    if (topic.userId === userId) {
      request.topicAccessLevel = 'owner';
      return true;
    }

    // 公开 Topic 允许查看
    if (topic.visibility === 'PUBLIC' && requiredLevel === 'viewer') {
      request.topicAccessLevel = 'viewer';
      return true;
    }

    // 检查协作者权限
    const collaborator = topic.collaborators[0];
    if (!collaborator) {
      throw new ForbiddenException('No access to this topic');
    }

    const roleHierarchy: Record<string, number> = {
      'viewer': 1,
      'editor': 2,
      'admin': 3,
      'owner': 4
    };

    const userLevel = roleHierarchy[collaborator.role.toLowerCase()] || 0;
    const requiredLevelNum = roleHierarchy[requiredLevel] || 0;

    if (userLevel < requiredLevelNum) {
      throw new ForbiddenException(
        `Requires ${requiredLevel} access, you have ${collaborator.role}`
      );
    }

    request.topicAccessLevel = collaborator.role.toLowerCase();
    return true;
  }
}

// ========== 3. 应用到所有端点 ==========
// topic-research.controller.ts

@Controller('topic-research')
@UseGuards(JwtAuthGuard, TopicAccessGuard, RateLimitGuard)
export class TopicResearchController {

  // 只读操作
  @Get('topics/:id')
  @RequireTopicAccess('viewer')
  async getTopic(...) {}

  @Get('topics/:id/reports')
  @RequireTopicAccess('viewer')
  async listReports(...) {}

  // 编辑操作
  @Post('topics/:id/refresh')
  @RequireTopicAccess('editor')
  async triggerRefresh(...) {}

  @Patch('topics/:id')
  @RequireTopicAccess('editor')
  async updateTopic(...) {}

  @Post('topics/:id/dimensions')
  @RequireTopicAccess('editor')
  async addDimension(...) {}

  // 管理操作
  @Post('topics/:id/collaborators')
  @RequireTopicAccess('admin')
  async addCollaborator(...) {}

  // 所有者专属
  @Delete('topics/:id')
  @RequireTopicAccess('owner')
  async deleteTopic(...) {}

  @Patch('topics/:id/visibility')
  @RequireTopicAccess('owner')
  async updateVisibility(...) {}
}
```

**权限矩阵**:

| 操作            | viewer | editor | admin | owner |
| --------------- | ------ | ------ | ----- | ----- |
| 查看 Topic/报告 | ✅     | ✅     | ✅    | ✅    |
| 启动研究/刷新   | ❌     | ✅     | ✅    | ✅    |
| 编辑报告/维度   | ❌     | ✅     | ✅    | ✅    |
| 添加协作者      | ❌     | ❌     | ✅    | ✅    |
| 添加 ADMIN      | ❌     | ❌     | ❌    | ✅    |
| 删除 Topic      | ❌     | ❌     | ❌    | ✅    |
| 修改可见性      | ❌     | ❌     | ❌    | ✅    |

---

#### 任务 1.2.2: topicConfig 强类型

**责任人**: 后端开发
**预估工时**: 4h
**影响文件**: `dto/create-topic.dto.ts`, `dto/update-topic.dto.ts`

```typescript
// backend/src/modules/ai-app/research/topic-research/dto/topic-config.dto.ts

import {
  IsOptional,
  IsString,
  IsInt,
  IsArray,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";

// 搜索时间范围枚举
export enum SearchTimeRange {
  DAY = "day",
  WEEK = "week",
  MONTH = "month",
  QUARTER = "quarter",
  YEAR = "year",
  ALL = "all",
}

// 维度配置 DTO
export class DimensionConfigDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  searchQueries?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  searchSources?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  minSources?: number;
}

// 主配置 DTO
export class TopicConfigDto {
  // ========== 搜索配置 ==========
  @IsOptional()
  @IsEnum(SearchTimeRange)
  searchTimeRange?: SearchTimeRange;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  excludedDomains?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  preferredDomains?: string[];

  // ========== 知识库配置 ==========
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  knowledgeBaseIds?: string[];

  @IsOptional()
  @IsBoolean()
  enableKnowledgeBase?: boolean;

  // ========== AI 模型配置 ==========
  @IsOptional()
  @IsString()
  @MaxLength(50)
  leaderModelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  researcherModelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  writerModelId?: string;

  // ========== 研究深度配置 ==========
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxDimensions?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(100)
  maxSourcesPerDimension?: number;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(50000)
  maxWordsPerDimension?: number;

  // ========== 维度预设 ==========
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DimensionConfigDto)
  dimensions?: DimensionConfigDto[];
}

// 更新 create-topic.dto.ts
export class CreateTopicDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsEnum(ResearchTopicType)
  type: ResearchTopicType;

  @IsOptional()
  @ValidateNested()
  @Type(() => TopicConfigDto)
  topicConfig?: TopicConfigDto; // ✅ 强类型
}
```

---

### 1.3 中危问题修复 (Week 2)

#### 任务 1.3.1: 前端 XSS 防护

**责任人**: 前端安全专家
**预估工时**: 6h

```typescript
// 1. 安装 DOMPurify
// npm install dompurify @types/dompurify

// 2. 创建安全 HTML 处理工具
// frontend/lib/security/html-sanitizer.ts

import DOMPurify from 'dompurify';

// 配置允许的标签和属性
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'img',
  'span', 'div'
];

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'id',
  'target', 'rel', 'data-citation-index'
];

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'style'],
  });
}

export function sanitizeForInnerHtml(html: string): string {
  // 双重清理
  const cleaned = sanitizeHtml(html);
  return DOMPurify.sanitize(cleaned, { RETURN_DOM: false });
}

// 3. 应用到 ReportEditor
// frontend/components/ai-research/reports/ReportEditor.tsx

import { sanitizeForInnerHtml } from '@/lib/security/html-sanitizer';

function applyAnnotationHighlights(html: string, annotations: ReportAnnotation[]) {
  // ✅ 先清理 HTML
  const cleanHtml = sanitizeForInnerHtml(html);

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = cleanHtml;

  // ... 处理注释高亮

  // ✅ 返回前再次清理
  return sanitizeForInnerHtml(tempDiv.innerHTML);
}

// 4. 创建安全渲染组件
// frontend/components/common/SafeHtml.tsx

interface SafeHtmlProps {
  html: string;
  className?: string;
}

export function SafeHtml({ html, className }: SafeHtmlProps) {
  const sanitized = useMemo(() => sanitizeHtml(html), [html]);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
```

---

#### 任务 1.3.2: 输入验证增强

**责任人**: 后端开发
**预估工时**: 4h

```typescript
// backend/src/common/validators/string-constraints.ts

import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";

// 自定义验证器: 安全字符串 (防止注入)
export function IsSafeString(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: "isSafeString",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (typeof value !== "string") return false;

          // 禁止危险字符序列
          const dangerousPatterns = [
            /<script/i,
            /javascript:/i,
            /on\w+=/i,
            /\$\{.*\}/, // 模板字符串注入
            /__proto__/,
            /constructor\s*\(/,
          ];

          return !dangerousPatterns.some((p) => p.test(value));
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} contains unsafe content`;
        },
      },
    });
  };
}

// 应用到 DTO
export class CreateTopicDto {
  @IsString()
  @MaxLength(200)
  @IsSafeString() // ✅ 添加安全验证
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsSafeString()
  description?: string;
}
```

---

## Phase 2: 测试基建 (Week 3-4)

### 2.1 测试架构设计

```
backend/src/modules/ai-app/research/topic-research/
├── __tests__/
│   ├── unit/                          # 单元测试
│   │   ├── research-mission.service.spec.ts
│   │   ├── dimension-mission.service.spec.ts
│   │   ├── report-synthesis.service.spec.ts
│   │   ├── evidence-management.service.spec.ts
│   │   └── topic-research.service.spec.ts
│   │
│   ├── integration/                   # 集成测试
│   │   ├── mission-flow.integration.spec.ts
│   │   ├── report-generation.integration.spec.ts
│   │   └── collaboration.integration.spec.ts
│   │
│   ├── e2e/                           # 端到端测试
│   │   └── full-research-cycle.e2e.spec.ts
│   │
│   ├── fixtures/                      # 测试数据
│   │   ├── topics.fixture.ts
│   │   ├── missions.fixture.ts
│   │   └── reports.fixture.ts
│   │
│   └── mocks/                         # Mock 服务
│       ├── prisma.mock.ts
│       ├── ai-chat.mock.ts
│       └── event-emitter.mock.ts
```

### 2.2 核心服务单元测试

#### 任务 2.2.1: ResearchMissionService 测试

**责任人**: 后端测试专家
**预估工时**: 16h
**覆盖目标**: 80%

```typescript
// __tests__/unit/research-mission.service.spec.ts

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchMissionService } from "../../services/research-mission.service";
import { createMockPrisma, createMockAiChat } from "../mocks";
import { ResearchMissionStatus, ResearchTaskStatus } from "@prisma/client";

describe("ResearchMissionService", () => {
  let service: ResearchMissionService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let aiChat: ReturnType<typeof createMockAiChat>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    aiChat = createMockAiChat();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchMissionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiChatService, useValue: aiChat },
        // ... 其他依赖
      ],
    }).compile();

    service = module.get(ResearchMissionService);
  });

  describe("createMission", () => {
    it("should create mission with PLANNING status", async () => {
      // Arrange
      const topicId = "topic-123";
      prisma.researchTopic.findUnique.mockResolvedValue({
        id: topicId,
        name: "Test Topic",
      });
      prisma.researchMission.create.mockResolvedValue({
        id: "mission-123",
        topicId,
        status: ResearchMissionStatus.PLANNING,
      });

      // Act
      const result = await service.createMission({ topicId });

      // Assert
      expect(result.status).toBe(ResearchMissionStatus.PLANNING);
      expect(prisma.researchMission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId,
            status: ResearchMissionStatus.PLANNING,
          }),
        }),
      );
    });

    it("should cancel existing mission when creating new one", async () => {
      // Arrange
      const topicId = "topic-123";
      const existingMissionId = "existing-mission";

      prisma.researchTopic.findUnique.mockResolvedValue({ id: topicId });
      prisma.researchMission.findFirst.mockResolvedValue({
        id: existingMissionId,
        status: ResearchMissionStatus.EXECUTING,
        tasks: [],
      });

      // Act
      await service.createMission({ topicId, mode: "fresh" });

      // Assert
      expect(prisma.researchMission.update).toHaveBeenCalledWith({
        where: { id: existingMissionId },
        data: { status: ResearchMissionStatus.CANCELLED },
      });
    });

    it("should preserve completed tasks in incremental mode", async () => {
      // Arrange
      const completedTask = {
        id: "task-1",
        dimensionName: "Market Analysis",
        status: ResearchTaskStatus.COMPLETED,
        result: { summary: "test" },
      };

      prisma.researchMission.findFirst.mockResolvedValue({
        id: "old-mission",
        tasks: [completedTask],
      });

      // Act
      await service.createMission({
        topicId: "topic-123",
        mode: "incremental",
      });

      // Assert
      expect(prisma.researchTask.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              dimensionName: "Market Analysis",
              status: ResearchTaskStatus.COMPLETED,
            }),
          ]),
        }),
      );
    });

    it("should throw NotFoundException for non-existent topic", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.createMission({ topicId: "non-existent" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("startExecution", () => {
    it("should copy evidence in incremental mode", async () => {
      // Arrange
      const missionId = "mission-123";
      const topicId = "topic-123";
      const oldReportId = "old-report";
      const newReportId = "new-report";

      prisma.researchTask.findMany.mockResolvedValue([
        { id: "task-1", status: ResearchTaskStatus.COMPLETED },
      ]);

      prisma.topicReport.findFirst.mockResolvedValue({
        id: oldReportId,
        evidences: [
          { id: "ev-1", title: "Source 1", citationIndex: 1 },
          { id: "ev-2", title: "Source 2", citationIndex: 2 },
        ],
      });

      // Act
      await service["startExecution"](missionId, topicId);

      // Assert
      expect(prisma.topicEvidence.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            reportId: newReportId,
            citationIndex: 1,
          }),
          expect.objectContaining({
            reportId: newReportId,
            citationIndex: 2,
          }),
        ]),
      });
    });
  });

  describe("getMissionStatus", () => {
    it("should calculate progress correctly", async () => {
      // Arrange
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-123",
        tasks: [
          { status: ResearchTaskStatus.COMPLETED },
          { status: ResearchTaskStatus.COMPLETED },
          { status: ResearchTaskStatus.EXECUTING },
          { status: ResearchTaskStatus.PENDING },
        ],
      });

      // Act
      const result = await service.getMissionStatus("mission-123");

      // Assert
      expect(result.completedTasks).toBe(2);
      expect(result.totalTasks).toBe(4);
      expect(result.progressPercent).toBe(50);
    });
  });
});
```

#### 任务 2.2.2: Mock 服务库

```typescript
// __tests__/mocks/prisma.mock.ts

export function createMockPrisma() {
  return {
    researchTopic: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    researchMission: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    researchTask: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    topicReport: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    topicEvidence: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(createMockPrisma())),
  };
}

// __tests__/mocks/ai-chat.mock.ts

export function createMockAiChat() {
  return {
    chat: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        dimensions: [
          { id: "dim-1", name: "Market Overview" },
          { id: "dim-2", name: "Competition" },
        ],
        agentAssignments: [
          { agentId: "researcher-1", assignedDimensions: ["dim-1"] },
        ],
      }),
    }),
  };
}
```

### 2.3 集成测试

```typescript
// __tests__/integration/mission-flow.integration.spec.ts

describe("Mission Flow Integration", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiChatService)
      .useValue(createMockAiChat())
      .compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // 清理测试数据
    await prisma.researchMission.deleteMany({});
    await prisma.researchTopic.deleteMany({});
  });

  it("should complete full research cycle", async () => {
    // 1. 创建 Topic
    const topic = await prisma.researchTopic.create({
      data: {
        name: "Test Research",
        type: "MACRO",
        userId: "test-user",
      },
    });

    // 2. 启动研究
    const response = await request(app.getHttpServer())
      .post(`/topic-research/topics/${topic.id}/research/smart-start`)
      .set("Authorization", "Bearer test-token")
      .expect(201);

    const missionId = response.body.id;

    // 3. 等待完成（轮询）
    let mission;
    for (let i = 0; i < 30; i++) {
      mission = await prisma.researchMission.findUnique({
        where: { id: missionId },
      });
      if (mission.status === "COMPLETED") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // 4. 验证结果
    expect(mission.status).toBe("COMPLETED");

    const report = await prisma.topicReport.findFirst({
      where: { topicId: topic.id },
    });
    expect(report).toBeDefined();
    expect(report.fullReport).toBeTruthy();
  });
});
```

### 2.4 测试覆盖率目标

| 服务                      | Week 3 | Week 4 | 最终目标 |
| ------------------------- | ------ | ------ | -------- |
| ResearchMissionService    | 60%    | 80%    | 85%      |
| DimensionMissionService   | 40%    | 70%    | 80%      |
| ReportSynthesisService    | 50%    | 75%    | 80%      |
| TopicResearchService      | 40%    | 65%    | 75%      |
| EvidenceManagementService | 60%    | 80%    | 85%      |
| **总体**                  | 45%    | 70%    | 75%      |

---

## Phase 3: 架构重构 (Week 5-8)

### 3.1 Controller 拆分

**目标**: 将 2700 行的 `topic-research.controller.ts` 拆分为 5 个独立 Controller

```
当前:
topic-research.controller.ts (2700+ 行, 70+ 端点)

重构后:
├── topics.controller.ts         (CRUD, ~300 行)
├── missions.controller.ts       (研究任务, ~500 行)
├── reports.controller.ts        (报告管理, ~600 行)
├── collaboration.controller.ts  (协作/分享, ~300 行)
├── todos.controller.ts          (待办管理, ~400 行)
└── admin.controller.ts          (管理功能, ~200 行)
```

### 3.2 上帝类拆分

**目标**: 将 2500 行的 `ResearchMissionService` 拆分为职责单一的服务

```typescript
// 当前
ResearchMissionService (2500+ 行)
  ├── createMission()
  ├── executePlanningAsync()
  ├── createTasksFromPlan()
  ├── startExecution()
  ├── executeTask()
  ├── executeDimensionResearchTask()
  ├── finalizeMission()
  └── ... 50+ 方法

// 重构后
├── MissionLifecycleService (~400 行)
│   ├── createMission()
│   ├── cancelMission()
│   ├── retryMission()
│   └── getMissionStatus()
│
├── MissionPlanningService (~500 行)
│   ├── executePlanningAsync()
│   ├── createTasksFromPlan()
│   └── handlePlanningFailure()
│
├── MissionExecutionService (~600 行)
│   ├── startExecution()
│   ├── executeTasksWithConcurrencyLimit()
│   └── copyEvidenceForIncremental()
│
├── TaskExecutorService (~500 行)
│   ├── executeTask()
│   ├── executeDimensionResearchTask()
│   ├── executeQualityReviewTask()
│   └── executeReportSynthesisTask()
│
└── MissionFinalizerService (~300 行)
    ├── finalizeMission()
    ├── calculateFinalStats()
    └── emitCompletionEvents()
```

### 3.3 引入任务队列

**目标**: 使用 BullMQ 实现异步任务处理

```typescript
// backend/src/modules/ai-app/research/topic-research/queues/

// 1. 定义队列
// research-queue.module.ts
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'research-planning' },
      { name: 'research-execution' },
      { name: 'report-synthesis' },
    ),
  ],
  providers: [
    ResearchPlanningProcessor,
    ResearchExecutionProcessor,
    ReportSynthesisProcessor,
  ],
})
export class ResearchQueueModule {}

// 2. 定义处理器
// processors/research-planning.processor.ts
@Processor('research-planning')
export class ResearchPlanningProcessor {
  constructor(
    private planningService: MissionPlanningService,
    private eventEmitter: ResearchEventEmitterService,
  ) {}

  @Process('plan-mission')
  async handlePlanMission(job: Job<PlanMissionData>) {
    const { missionId, topicId, userPrompt } = job.data;

    try {
      await job.progress(10);

      const plan = await this.planningService.executePlanning(
        missionId,
        topicId,
        userPrompt
      );

      await job.progress(100);
      return plan;

    } catch (error) {
      await this.eventEmitter.emitMissionFailed(topicId, missionId, error.message);
      throw error;
    }
  }
}

// 3. 修改服务调用方式
// mission-lifecycle.service.ts
@Injectable()
export class MissionLifecycleService {
  constructor(
    @InjectQueue('research-planning') private planningQueue: Queue,
  ) {}

  async createMission(input: CreateMissionInput): Promise<ResearchMission> {
    // 创建 Mission 记录
    const mission = await this.prisma.researchMission.create({ ... });

    // 添加到队列（异步执行）
    await this.planningQueue.add('plan-mission', {
      missionId: mission.id,
      topicId: input.topicId,
      userPrompt: input.userPrompt,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      timeout: 600000, // 10 分钟超时
    });

    return mission;
  }
}
```

### 3.4 事件驱动解耦

```typescript
// 当前：服务直接调用服务
class ResearchMissionService {
  async finalizeMission() {
    await this.reportSynthesisService.synthesizeReport(...);
    await this.evidenceManagementService.reindexCitations(...);
    await this.credibilityReportService.generateReport(...);
  }
}

// 重构后：事件驱动
// events/mission.events.ts
export class MissionCompletedEvent {
  constructor(
    public readonly missionId: string,
    public readonly topicId: string,
    public readonly reportId: string,
  ) {}
}

// mission-finalizer.service.ts
class MissionFinalizerService {
  async finalizeMission() {
    // 发布事件
    this.eventEmitter.emit(
      'mission.completed',
      new MissionCompletedEvent(missionId, topicId, reportId)
    );
  }
}

// 各服务独立监听
@Injectable()
export class CredibilityReportService {
  @OnEvent('mission.completed')
  async handleMissionCompleted(event: MissionCompletedEvent) {
    await this.generateReport(event.reportId);
  }
}

@Injectable()
export class EvidenceManagementService {
  @OnEvent('mission.completed')
  async handleMissionCompleted(event: MissionCompletedEvent) {
    await this.reindexCitations(event.reportId);
  }
}
```

---

## Phase 4: 质量提升 (Week 9-12)

### 4.1 技术债务清理

**目标**: 将 TODO/FIXME 从 269 处减少到 50 处以下

```bash
# 当前分布
topic-research.controller.ts   91   # P0: 重构时清理
research-todo.service.ts       122  # P0: 专项清理
research-leader.service.ts     12   # P1
data-source-router.service.ts  11   # P1
其他文件                        33   # P2
```

**清理策略**:

1. 分类：真正的 TODO vs 过期的注释
2. 创建 Issue：每个有效 TODO 转为 JIRA Issue
3. 每周 Sprint 分配 20% 时间清理

### 4.2 可观测性增强

```typescript
// 1. Prometheus 指标
// backend/src/common/metrics/research-metrics.ts

import { Counter, Histogram, Gauge } from 'prom-client';

export const researchMetrics = {
  // 研究任务指标
  missionTotal: new Counter({
    name: 'research_mission_total',
    help: 'Total research missions',
    labelNames: ['status', 'topic_type'],
  }),

  missionDuration: new Histogram({
    name: 'research_mission_duration_seconds',
    help: 'Research mission duration',
    labelNames: ['topic_type'],
    buckets: [60, 180, 300, 600, 900, 1800],
  }),

  activeMissions: new Gauge({
    name: 'research_active_missions',
    help: 'Currently active research missions',
  }),

  // AI 调用指标
  aiCallTotal: new Counter({
    name: 'ai_api_call_total',
    help: 'Total AI API calls',
    labelNames: ['model', 'task_type', 'status'],
  }),

  aiCallDuration: new Histogram({
    name: 'ai_api_call_duration_seconds',
    help: 'AI API call duration',
    labelNames: ['model'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60],
  }),

  aiTokensUsed: new Counter({
    name: 'ai_tokens_used_total',
    help: 'Total AI tokens consumed',
    labelNames: ['model', 'task_type'],
  }),

  // 证据指标
  evidenceTotal: new Counter({
    name: 'research_evidence_total',
    help: 'Total evidence collected',
    labelNames: ['source_type'],
  }),
};

// 2. 应用指标
// dimension-mission.service.ts
async executeDimensionMission(...) {
  const startTime = Date.now();
  researchMetrics.activeMissions.inc();

  try {
    const result = await this.doResearch(...);

    researchMetrics.missionTotal.inc({ status: 'success', topic_type: topicType });
    researchMetrics.evidenceTotal.inc({ source_type: 'web' }, result.evidences.length);

    return result;
  } catch (error) {
    researchMetrics.missionTotal.inc({ status: 'failure', topic_type: topicType });
    throw error;
  } finally {
    researchMetrics.activeMissions.dec();
    researchMetrics.missionDuration.observe(
      { topic_type: topicType },
      (Date.now() - startTime) / 1000
    );
  }
}
```

### 4.3 审计日志实现

```typescript
// backend/src/common/audit/audit-log.service.ts

export interface AuditEvent {
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  result: 'success' | 'failure';
  ip: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  async log(event: AuditEvent): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        ...event,
        timestamp: new Date(),
      },
    });
  }
}

// 敏感操作装饰器
export function Audit(action: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const request = args.find(arg => arg?.user);
      const resourceId = args.find(arg => typeof arg === 'string');

      try {
        const result = await originalMethod.apply(this, args);

        await this.auditLog.log({
          userId: request?.user?.id,
          action,
          resource: target.constructor.name,
          resourceId,
          result: 'success',
          ip: request?.ip,
        });

        return result;
      } catch (error) {
        await this.auditLog.log({
          userId: request?.user?.id,
          action,
          resource: target.constructor.name,
          resourceId,
          result: 'failure',
          ip: request?.ip,
          metadata: { error: error.message },
        });
        throw error;
      }
    };

    return descriptor;
  };
}

// 应用到 Controller
@Delete('topics/:id')
@Audit('DELETE_TOPIC')
async deleteTopic(@Request() req, @Param('id') id: string) {
  return this.topicResearchService.deleteTopic(req.user.id, id);
}
```

---

## 验收标准

### 阶段验收检查清单

#### Phase 1 验收 (Week 2 末)

- [ ] SQL 注入: `grep "$queryRaw"` 返回 0 结果
- [ ] 速率限制: 所有 AI 端点有 @RateLimit
- [ ] console.log: `grep "console."` 返回 0 结果
- [ ] 访问控制: 所有端点有 @RequireTopicAccess
- [ ] 安全扫描: `npm audit` 无高危漏洞

#### Phase 2 验收 (Week 4 末)

- [ ] 测试覆盖率: >= 70%
- [ ] 核心服务测试: 5 个服务各有 10+ 测试用例
- [ ] CI 集成: 每次 PR 自动运行测试
- [ ] 测试报告: 生成 HTML 覆盖率报告

#### Phase 3 验收 (Week 8 末)

- [ ] Controller 拆分: 5 个独立 Controller
- [ ] 服务拆分: ResearchMissionService 拆为 5 个服务
- [ ] 任务队列: BullMQ 集成完成
- [ ] 无回归: 所有现有测试通过

#### Phase 4 验收 (Week 12 末)

- [ ] TODO 清理: < 50 处
- [ ] Prometheus: 关键指标可查询
- [ ] 审计日志: 敏感操作有记录
- [ ] 文档更新: API 文档同步

---

## 资源需求

### 人员配置

| 角色         | 人数 | 参与阶段   |
| ------------ | ---- | ---------- |
| 后端安全专家 | 1    | Phase 1    |
| 后端架构师   | 1    | Phase 1, 3 |
| 后端开发     | 2    | 全程       |
| 前端开发     | 1    | Phase 1, 4 |
| 测试工程师   | 1    | Phase 2    |
| DevOps       | 1    | Phase 3, 4 |

### 工时预估

| 阶段     | 工时     | 人天        |
| -------- | -------- | ----------- |
| Phase 1  | 80h      | 10 人天     |
| Phase 2  | 120h     | 15 人天     |
| Phase 3  | 160h     | 20 人天     |
| Phase 4  | 80h      | 10 人天     |
| **总计** | **440h** | **55 人天** |

---

## 风险管理

| 风险             | 概率 | 影响 | 缓解措施            |
| ---------------- | ---- | ---- | ------------------- |
| 重构引入回归     | 高   | 高   | 先建测试再重构      |
| 安全修复影响功能 | 中   | 高   | 灰度发布 + 回滚预案 |
| 任务队列不稳定   | 中   | 中   | 先单独环境验证      |
| 人员资源不足     | 中   | 中   | 提前锁定人员        |

---

## 附录

### A. 相关文档链接

- [诊断报告全文](./topic-research-diagnostic-report.md)
- [安全审计详情](./topic-research-security-audit.md)
- [API 文档](../api/topic-research-api.md)

### B. 技术决策记录 (ADR)

- ADR-001: 选择 BullMQ 作为任务队列
- ADR-002: 选择 Prometheus + Grafana 作为监控方案
- ADR-003: 采用事件驱动架构解耦服务

---

## Phase 5: 服务弹性与任务自动恢复 (Week 13-14)

> **场景**: 服务侧前后台持续迭代部署，用户浏览器保持打开，需要自动重连并接续任务

### 5.1 问题分析

#### 当前缺陷

| 问题                     | 当前状态                        | 影响                   |
| ------------------------ | ------------------------------- | ---------------------- |
| **前端重连后不同步状态** | 只加入房间 `emit('join:topic')` | 用户看不到重启前的进度 |
| **执行进程丢失**         | 任务执行在 Node.js 内存中       | EXECUTING 状态任务僵死 |
| **无自动恢复**           | 健康检查 30 分钟后标记 FAILED   | 用户需手动恢复，体验差 |
| **无优雅关机**           | PM2 直接 SIGTERM 停止进程       | 执行中任务进度可能丢失 |

#### 目标

1. 用户浏览器自动重连后，**立即同步当前任务状态**
2. 服务重启后，**5 分钟内自动恢复**中断的任务（而非 30 分钟后标记失败）
3. 部署时**优雅关机**，保存执行上下文
4. 支持**零停机部署**（可选增强）

---

### 5.2 前端 WebSocket 重连后状态同步

**责任人**: 前端开发
**预估工时**: 8h

#### 5.2.1 增强 Gateway 支持状态同步

```typescript
// backend/src/modules/ai-app/research/topic-research/topic-research.gateway.ts

@SubscribeMessage('sync:request')
async handleSyncRequest(
  @MessageBody() data: { topicId: string },
  @ConnectedSocket() client: Socket
): Promise<void> {
  const { topicId } = data;

  // 获取当前活跃的 Mission
  const activeMission = await this.prisma.researchMission.findFirst({
    where: {
      topicId,
      status: {
        in: [
          ResearchMissionStatus.PLANNING,
          ResearchMissionStatus.EXECUTING,
          ResearchMissionStatus.REVIEWING,
        ],
      },
    },
    include: {
      tasks: {
        orderBy: { updatedAt: 'desc' },
        take: 5,
      },
      todos: {
        where: {
          status: {
            in: [ResearchTodoStatus.PENDING, ResearchTodoStatus.IN_PROGRESS],
          },
        },
        take: 10,
      },
    },
  });

  if (!activeMission) {
    // 没有活跃任务，返回空状态
    client.emit('sync:state', {
      hasActiveMission: false,
      topicId,
    });
    return;
  }

  // 计算进度
  const completedTasks = activeMission.tasks.filter(
    t => t.status === ResearchTaskStatus.COMPLETED
  ).length;
  const totalTasks = activeMission.tasks.length || 1;
  const progress = Math.round((completedTasks / totalTasks) * 100);

  // 判断是否需要恢复（服务重启导致的中断）
  const needsRecovery = await this.checkIfNeedsRecovery(activeMission);

  client.emit('sync:state', {
    hasActiveMission: true,
    topicId,
    missionId: activeMission.id,
    status: activeMission.status,
    progress,
    phase: this.mapStatusToPhase(activeMission.status),
    currentMessage: this.buildCurrentMessage(activeMission),
    activeTodos: activeMission.todos.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      progress: t.progressPercent,
    })),
    needsRecovery,
    lastActivityAt: activeMission.updatedAt,
  });
}

/**
 * 检查是否需要恢复（服务重启导致的中断）
 */
private async checkIfNeedsRecovery(mission: any): Promise<boolean> {
  // 如果是 EXECUTING 状态，但没有任务正在执行，可能是服务重启导致
  if (mission.status === ResearchMissionStatus.EXECUTING) {
    const executingTasks = mission.tasks.filter(
      (t: any) => t.status === ResearchTaskStatus.EXECUTING
    );

    if (executingTasks.length > 0) {
      // 检查执行中的任务是否超过 5 分钟无更新（可能是服务重启导致）
      const staleThreshold = 5 * 60 * 1000; // 5 分钟
      const now = Date.now();

      return executingTasks.some((task: any) => {
        const lastUpdate = new Date(task.updatedAt).getTime();
        return (now - lastUpdate) > staleThreshold;
      });
    }

    // EXECUTING 状态但没有任务在执行，需要恢复
    const pendingTasks = mission.tasks.filter(
      (t: any) => t.status === ResearchTaskStatus.PENDING
    );
    return pendingTasks.length > 0;
  }

  return false;
}
```

#### 5.2.2 前端 Hook 增强

```typescript
// frontend/hooks/useResearchWebSocket.ts

// 在 connect 回调中增加状态同步
socket.on("connect", () => {
  logger.debug("[ResearchWS] Connected");
  connectingRef.current = false;
  setIsConnected(true);
  setError(null);

  // 加入专题房间
  socket.emit("join:topic", { topicId });

  // ★ 新增：请求同步当前状态
  socket.emit("sync:request", { topicId });
});

// 处理状态同步响应
socket.on("sync:state", (data: SyncStateData) => {
  logger.debug("[ResearchWS] State synced:", data);

  if (data.hasActiveMission) {
    setProgress(data.progress);
    setPhase(data.phase);
    setCurrentMessage(data.currentMessage);

    // ★ 如果需要恢复，通知用户
    if (data.needsRecovery) {
      handleEvent("mission:needs_recovery", {
        missionId: data.missionId,
        lastActivityAt: data.lastActivityAt,
        message: "检测到任务中断，正在自动恢复...",
      });
    }
  }
});

// 新增事件类型
export type ResearchEventType =
  | "mission:started"
  // ... 其他事件
  | "mission:needs_recovery" // ★ 新增
  | "mission:recovery_started" // ★ 新增
  | "mission:recovery_completed"; // ★ 新增
```

---

### 5.3 后端服务启动时自动恢复

**责任人**: 后端架构师
**预估工时**: 12h

#### 5.3.1 增强 Health Service 的启动恢复逻辑

```typescript
// backend/src/modules/ai-app/research/topic-research/services/research-mission-health.service.ts

@Injectable()
export class ResearchMissionHealthService
  implements OnModuleInit, OnModuleDestroy
{
  // ★ 服务启动时的恢复配置
  private static readonly RECOVERY_CONFIG = {
    /** 服务启动后多久开始恢复 */
    recoveryDelayMs: 10 * 1000, // 10 秒后开始恢复（等待其他服务就绪）

    /** 任务被认为是"中断"的阈值（服务重启期间无更新） */
    interruptedThresholdMs: 5 * 60 * 1000, // 5 分钟

    /** 最大并发恢复任务数 */
    maxConcurrentRecovery: 3,

    /** 恢复重试次数 */
    recoveryRetries: 2,
  };

  async onModuleInit(): Promise<void> {
    this.startHealthCheckLoop();

    // ★ 新增：服务启动后自动恢复中断的任务
    setTimeout(() => {
      this.recoverInterruptedMissions().catch((err) => {
        this.logger.error(`Auto-recovery failed: ${err.message}`);
      });
    }, ResearchMissionHealthService.RECOVERY_CONFIG.recoveryDelayMs);

    this.logger.log("Health check service started with auto-recovery enabled");
  }

  /**
   * ★ 服务启动时恢复中断的任务
   *
   * 场景：服务重启（部署/崩溃）后，EXECUTING 状态的任务需要继续执行
   */
  async recoverInterruptedMissions(): Promise<RecoveryResult> {
    this.logger.log("Starting auto-recovery of interrupted missions...");

    const result: RecoveryResult = {
      checkedAt: new Date(),
      interruptedMissions: 0,
      recoveredMissions: 0,
      failedRecoveries: 0,
      details: [],
    };

    // 1. 查找所有 EXECUTING 状态的 Mission
    const executingMissions = await this.prisma.researchMission.findMany({
      where: {
        status: ResearchMissionStatus.EXECUTING,
      },
      include: {
        tasks: true,
        topic: { select: { id: true, name: true, userId: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (executingMissions.length === 0) {
      this.logger.log("No interrupted missions found");
      return result;
    }

    const now = Date.now();
    const threshold =
      ResearchMissionHealthService.RECOVERY_CONFIG.interruptedThresholdMs;

    // 2. 筛选需要恢复的任务（超过阈值无更新）
    const interruptedMissions = executingMissions.filter((mission) => {
      const lastUpdate = new Date(mission.updatedAt).getTime();
      const isStale = now - lastUpdate > threshold;

      // 检查是否有正在执行但可能中断的任务
      const hasStaleExecutingTask = mission.tasks.some((task) => {
        if (task.status !== ResearchTaskStatus.EXECUTING) return false;
        const taskLastUpdate = new Date(task.updatedAt).getTime();
        return now - taskLastUpdate > threshold;
      });

      return isStale || hasStaleExecutingTask;
    });

    result.interruptedMissions = interruptedMissions.length;

    if (interruptedMissions.length === 0) {
      this.logger.log("All executing missions are active, no recovery needed");
      return result;
    }

    this.logger.warn(
      `Found ${interruptedMissions.length} interrupted missions, starting recovery...`,
    );

    // 3. 并发恢复（限制并发数）
    const concurrencyLimit =
      ResearchMissionHealthService.RECOVERY_CONFIG.maxConcurrentRecovery;

    for (let i = 0; i < interruptedMissions.length; i += concurrencyLimit) {
      const batch = interruptedMissions.slice(i, i + concurrencyLimit);

      const batchResults = await Promise.allSettled(
        batch.map((mission) => this.recoverSingleMission(mission)),
      );

      for (const [index, batchResult] of batchResults.entries()) {
        const mission = batch[index];

        if (batchResult.status === "fulfilled" && batchResult.value.success) {
          result.recoveredMissions++;
          result.details.push({
            missionId: mission.id,
            topicId: mission.topicId,
            action: "recovered",
            reason: batchResult.value.reason,
          });
        } else {
          result.failedRecoveries++;
          result.details.push({
            missionId: mission.id,
            topicId: mission.topicId,
            action: "failed",
            reason:
              batchResult.status === "rejected"
                ? batchResult.reason.message
                : batchResult.value.reason,
          });
        }
      }
    }

    this.logger.log(
      `Auto-recovery completed: ${result.recoveredMissions} recovered, ` +
        `${result.failedRecoveries} failed`,
    );

    return result;
  }

  /**
   * 恢复单个中断的 Mission
   */
  private async recoverSingleMission(
    mission: any,
  ): Promise<{ success: boolean; reason: string }> {
    const { id: missionId, topicId } = mission;

    this.logger.log(`Recovering mission ${missionId}...`);

    try {
      // 1. 发出恢复开始事件
      await this.eventEmitter.emitMissionProgress(
        topicId,
        missionId,
        mission.progressPercent || 0,
        "recovering",
        "系统正在恢复中断的研究任务...",
      );

      // 2. 重置所有 EXECUTING 状态的任务为 PENDING
      const resetResult = await this.prisma.researchTask.updateMany({
        where: {
          missionId,
          status: ResearchTaskStatus.EXECUTING,
        },
        data: {
          status: ResearchTaskStatus.PENDING,
          startedAt: null,
        },
      });

      // 3. 重置所有 IN_PROGRESS 状态的 TODO 为 PENDING
      await this.prisma.researchTodo.updateMany({
        where: {
          missionId,
          status: ResearchTodoStatus.IN_PROGRESS,
        },
        data: {
          status: ResearchTodoStatus.PENDING,
          startedAt: null,
        },
      });

      // 4. 触发任务继续执行
      // 通过注入 ResearchMissionService 来继续执行
      await this.researchMissionService.continueExecution(missionId);

      this.logger.log(
        `Mission ${missionId} recovered successfully, ` +
          `${resetResult.count} tasks reset to PENDING`,
      );

      return {
        success: true,
        reason: `Recovered with ${resetResult.count} tasks reset`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to recover mission ${missionId}: ${error.message}`,
      );

      // 恢复失败，标记为 FAILED
      await this.markMissionFailed(mission, `自动恢复失败: ${error.message}`);

      return {
        success: false,
        reason: error.message,
      };
    }
  }
}

// 新增类型定义
interface RecoveryResult {
  checkedAt: Date;
  interruptedMissions: number;
  recoveredMissions: number;
  failedRecoveries: number;
  details: RecoveryDetail[];
}

interface RecoveryDetail {
  missionId: string;
  topicId: string;
  action: "recovered" | "failed" | "skipped";
  reason: string;
}
```

#### 5.3.2 ResearchMissionService 新增 continueExecution 方法

```typescript
// backend/src/modules/ai-app/research/topic-research/services/research-mission.service.ts

/**
 * ★ 继续执行中断的任务（服务重启后恢复）
 */
async continueExecution(missionId: string): Promise<void> {
  const mission = await this.prisma.researchMission.findUnique({
    where: { id: missionId },
    include: {
      tasks: true,
      topic: true,
    },
  });

  if (!mission) {
    throw new NotFoundException(`Mission ${missionId} not found`);
  }

  if (mission.status !== ResearchMissionStatus.EXECUTING) {
    this.logger.warn(
      `Mission ${missionId} is not in EXECUTING status, skipping continue`
    );
    return;
  }

  // 获取待执行的任务
  const pendingTasks = mission.tasks.filter(
    t => t.status === ResearchTaskStatus.PENDING
  );

  if (pendingTasks.length === 0) {
    // 所有任务已完成，触发最终化
    this.logger.log(`Mission ${missionId} has no pending tasks, finalizing...`);
    await this.finalizeMission(missionId);
    return;
  }

  this.logger.log(
    `Continuing mission ${missionId} with ${pendingTasks.length} pending tasks`
  );

  // 发出恢复完成事件
  await this.researchEventEmitter.emitMissionProgress(
    mission.topicId,
    missionId,
    mission.progressPercent || 0,
    'executing',
    `恢复执行中，剩余 ${pendingTasks.length} 个任务`
  );

  // 继续执行任务（异步，不阻塞）
  this.executeTasksWithConcurrencyLimit(
    missionId,
    mission.topicId,
    pendingTasks,
    mission.topic.topicConfig
  ).catch(err => {
    this.logger.error(`Continue execution failed: ${err.message}`);
  });
}
```

---

### 5.4 优雅关机机制

**责任人**: DevOps + 后端
**预估工时**: 6h

#### 5.4.1 NestJS 优雅关机配置

```typescript
// backend/src/main.ts

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ★ 启用优雅关机
  app.enableShutdownHooks();

  // ... 其他配置

  await app.listen(3001);
}

// backend/src/modules/ai-app/research/topic-research/services/research-mission-health.service.ts

@Injectable()
export class ResearchMissionHealthService
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleDestroy(): Promise<void> {
    this.stopHealthCheckLoop();

    // ★ 优雅关机：保存所有执行中任务的检查点
    await this.saveCheckpointsBeforeShutdown();

    this.logger.log("Health check service stopped, checkpoints saved");
  }

  /**
   * ★ 关机前保存检查点
   */
  private async saveCheckpointsBeforeShutdown(): Promise<void> {
    this.logger.log("Saving checkpoints before shutdown...");

    const executingMissions = await this.prisma.researchMission.findMany({
      where: {
        status: ResearchMissionStatus.EXECUTING,
      },
      include: {
        tasks: true,
      },
    });

    for (const mission of executingMissions) {
      try {
        // 保存当前进度到 userContext
        const checkpoint = {
          savedAt: new Date().toISOString(),
          reason: "graceful_shutdown",
          completedTasks: mission.tasks
            .filter((t) => t.status === ResearchTaskStatus.COMPLETED)
            .map((t) => t.id),
          executingTasks: mission.tasks
            .filter((t) => t.status === ResearchTaskStatus.EXECUTING)
            .map((t) => t.id),
          progressPercent: mission.progressPercent,
        };

        await this.prisma.researchMission.update({
          where: { id: mission.id },
          data: {
            userContext: {
              ...((mission.userContext as Record<string, unknown>) || {}),
              shutdownCheckpoint: checkpoint,
            },
          },
        });

        this.logger.debug(`Checkpoint saved for mission ${mission.id}`);
      } catch (error) {
        this.logger.error(
          `Failed to save checkpoint for ${mission.id}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Saved checkpoints for ${executingMissions.length} missions`,
    );
  }
}
```

#### 5.4.2 PM2 配置优雅关机

```javascript
// ecosystem.config.js

module.exports = {
  apps: [
    {
      name: "genesis-backend",
      script: "dist/main.js",

      // ★ 优雅关机配置
      kill_timeout: 30000, // 30 秒等待关机
      listen_timeout: 10000, // 10 秒等待启动
      shutdown_with_message: true,

      // 使用 SIGINT 而非 SIGKILL
      signal: "SIGINT",

      // 等待连接关闭
      wait_ready: true,

      // 集群模式下的优雅重启
      instances: 2,
      exec_mode: "cluster",
    },
  ],
};
```

---

### 5.5 Redis 执行状态持久化（可选增强）

> 此功能为可选增强，适用于需要更高可靠性的场景

**责任人**: 后端架构师
**预估工时**: 16h

```typescript
// backend/src/modules/ai-app/research/topic-research/services/mission-state-cache.service.ts

@Injectable()
export class MissionStateCacheService {
  private readonly CACHE_PREFIX = "mission:state:";
  private readonly CACHE_TTL = 24 * 60 * 60; // 24 小时

  constructor(@Inject("REDIS_CLIENT") private redis: Redis) {}

  /**
   * 保存任务执行状态到 Redis
   */
  async saveExecutionState(
    missionId: string,
    state: MissionExecutionState,
  ): Promise<void> {
    const key = `${this.CACHE_PREFIX}${missionId}`;
    await this.redis.setex(
      key,
      this.CACHE_TTL,
      JSON.stringify({
        ...state,
        savedAt: new Date().toISOString(),
      }),
    );
  }

  /**
   * 获取任务执行状态
   */
  async getExecutionState(
    missionId: string,
  ): Promise<MissionExecutionState | null> {
    const key = `${this.CACHE_PREFIX}${missionId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 获取所有中断的任务（服务启动时调用）
   */
  async getInterruptedMissions(): Promise<string[]> {
    const keys = await this.redis.keys(`${this.CACHE_PREFIX}*`);
    return keys.map((key) => key.replace(this.CACHE_PREFIX, ""));
  }

  /**
   * 清除任务状态（任务完成后调用）
   */
  async clearExecutionState(missionId: string): Promise<void> {
    const key = `${this.CACHE_PREFIX}${missionId}`;
    await this.redis.del(key);
  }
}

interface MissionExecutionState {
  missionId: string;
  topicId: string;
  status: ResearchMissionStatus;
  currentTaskId: string | null;
  currentDimensionId: string | null;
  completedTaskIds: string[];
  progressPercent: number;
  lastHeartbeat: string;
  executionContext?: Record<string, unknown>;
}
```

---

### 5.6 验收标准

#### 功能测试场景

| 场景                | 预期行为                         | 验证方法                   |
| ------------------- | -------------------------------- | -------------------------- |
| **服务重启（PM2）** | EXECUTING 任务 10 秒内自动恢复   | `pm2 restart` 后观察日志   |
| **浏览器刷新**      | 立即显示当前进度                 | 刷新页面，检查进度条       |
| **网络断开重连**    | 3 次重连内恢复，同步状态         | 断网后恢复，检查 WebSocket |
| **长时间挂起**      | 30 分钟后标记 FAILED，可手动恢复 | 等待健康检查               |
| **优雅关机**        | 保存检查点，重启后恢复           | 观察 `shutdownCheckpoint`  |

#### 验收检查清单

- [ ] `sync:request` 事件：Gateway 支持
- [ ] `sync:state` 响应：包含 `needsRecovery` 字段
- [ ] 自动恢复：服务启动 10 秒后触发
- [ ] 恢复日志：记录恢复的任务数量
- [ ] 优雅关机：PM2 `kill_timeout` 配置
- [ ] 检查点保存：`onModuleDestroy` 保存状态

---

### 5.7 部署建议

#### 零停机部署策略

```bash
# 1. 使用 PM2 集群模式（2+ 实例）
pm2 start ecosystem.config.js

# 2. 滚动重启（一次一个实例）
pm2 reload genesis-backend

# 3. 健康检查确认后再重启下一个
curl http://localhost:3001/health
```

#### 监控指标

```typescript
// 新增 Prometheus 指标
export const recoveryMetrics = {
  recoveryTotal: new Counter({
    name: "research_mission_recovery_total",
    help: "Total mission recoveries",
    labelNames: ["result"], // 'success' | 'failed'
  }),

  recoveryDuration: new Histogram({
    name: "research_mission_recovery_duration_seconds",
    help: "Mission recovery duration",
    buckets: [1, 5, 10, 30, 60],
  }),

  interruptedMissions: new Gauge({
    name: "research_interrupted_missions",
    help: "Number of missions interrupted by restart",
  }),
};
```

---

**方案制定**: 架构委员会
**批准日期**: 待定
**执行开始**: 待批准后 1 周内

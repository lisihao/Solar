# 05 - API设计规范 | API Design Standards

> **优先级**: 🔴 MUST
> **更新日期**: 2025-11-09
> **适用范围**: 所有REST API endpoints

---

## 目录

1. [RESTful设计原则](#restful设计原则)
2. [URL设计](#url设计)
3. [HTTP方法](#http方法)
4. [请求与响应](#请求与响应)
5. [错误处理](#错误处理)
6. [版本控制](#版本控制)
7. [认证与授权](#认证与授权)
8. [性能优化](#性能优化)

---

## RESTful设计原则

### 1. 资源导向 🔴 MUST

API应该围绕**资源（名词）**而非**操作（动词）**设计：

```
✅ 正确 - 资源导向
GET    /api/v1/resources
POST   /api/v1/resources
GET    /api/v1/resources/{id}
PUT    /api/v1/resources/{id}
DELETE /api/v1/resources/{id}

❌ 错误 - 操作导向
GET    /api/v1/getResources
POST   /api/v1/createResource
GET    /api/v1/fetchResourceById
POST   /api/v1/updateResource
POST   /api/v1/deleteResource
```

### 2. 统一接口 🔴 MUST

所有API必须遵循统一的接口约定：

- 使用标准HTTP方法
- 使用标准HTTP状态码
- 统一的响应格式
- 统一的错误处理

---

## URL设计

### 1. URL结构 🔴 MUST

```
格式: /{api-prefix}/{version}/{resource-collection}/{resource-id}/{sub-resource}

示例:
/api/v1/resources
/api/v1/resources/123
/api/v1/resources/123/comments
/api/v1/users/456/learning-paths
```

**规则**:

- 🔴 MUST: 使用小写字母
- 🔴 MUST: 使用连字符（kebab-case）分隔单词
- 🔴 MUST: 集合名使用复数形式
- 🔴 MUST: 避免URL超过3层嵌套

```
✅ 正确
/api/v1/learning-paths
/api/v1/user-activities
/api/v1/resources/123/comments

❌ 错误
/api/v1/learningPaths          # 应该用kebab-case
/api/v1/learning_paths         # 应该用连字符不是下划线
/api/v1/resource               # 应该用复数
/api/v1/users/123/posts/456/comments/789/likes  # 嵌套过深
```

### 2. 查询参数 🔴 MUST

```typescript
// ✅ 正确 - 标准化的查询参数
GET /api/v1/resources?
    page=1&
    limit=20&
    sort=-createdAt&        // - 表示降序
    filter[type]=ARTICLE&
    filter[tags]=ai,ml&
    search=machine%20learning

// 参数说明：
// - page: 页码（从1开始）
// - limit: 每页数量（默认20，最大100）
// - sort: 排序字段（-表示降序）
// - filter[field]: 过滤条件
// - search: 全文搜索
```

**标准查询参数**:

| 参数            | 类型    | 说明                        | 示例                   |
| --------------- | ------- | --------------------------- | ---------------------- |
| `page`          | integer | 页码（从1开始）             | `page=1`               |
| `limit`         | integer | 每页数量（默认20，最大100） | `limit=50`             |
| `sort`          | string  | 排序字段（-表示降序）       | `sort=-createdAt`      |
| `filter[field]` | string  | 字段过滤                    | `filter[type]=ARTICLE` |
| `search`        | string  | 全文搜索                    | `search=keyword`       |
| `fields`        | string  | 指定返回字段                | `fields=id,title,url`  |

### 3. 特殊端点 🟡 SHOULD

某些非CRUD操作可以使用动词：

```
✅ 正确 - 特殊操作
POST /api/v1/resources/{id}/publish
POST /api/v1/resources/{id}/archive
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
GET  /api/v1/resources/search/suggestions

✅ 正确 - 批量操作
POST /api/v1/resources/batch
DELETE /api/v1/resources/batch

✅ 正确 - 聚合查询
GET /api/v1/analytics/dashboard
GET /api/v1/statistics/summary
```

---

## HTTP方法

### 1. 标准方法 🔴 MUST

| 方法   | 用途         | 幂等性 | 安全性 | 示例                    |
| ------ | ------------ | ------ | ------ | ----------------------- |
| GET    | 获取资源     | ✅     | ✅     | `GET /resources/123`    |
| POST   | 创建资源     | ❌     | ❌     | `POST /resources`       |
| PUT    | 完整替换资源 | ✅     | ❌     | `PUT /resources/123`    |
| PATCH  | 部分更新资源 | ❌     | ❌     | `PATCH /resources/123`  |
| DELETE | 删除资源     | ✅     | ❌     | `DELETE /resources/123` |

### 2. 使用示例

```typescript
// ✅ GET - 获取资源列表
GET /api/v1/resources
Response: 200 OK
{
  "data": [{ id, title, ... }],
  "pagination": { total, page, limit }
}

// ✅ GET - 获取单个资源
GET /api/v1/resources/123
Response: 200 OK
{
  "data": { id: 123, title: "...", ... }
}

// ✅ POST - 创建资源
POST /api/v1/resources
Content-Type: application/json
{
  "title": "New Resource",
  "type": "ARTICLE",
  ...
}
Response: 201 Created
Location: /api/v1/resources/456
{
  "data": { id: 456, title: "New Resource", ... }
}

// ✅ PUT - 完整替换（需要所有字段）
PUT /api/v1/resources/123
Content-Type: application/json
{
  "title": "Updated Title",
  "type": "ARTICLE",
  "description": "...",
  // ... 所有必需字段
}
Response: 200 OK

// ✅ PATCH - 部分更新（只需要修改的字段）
PATCH /api/v1/resources/123
Content-Type: application/json
{
  "title": "Updated Title"  // 只更新title
}
Response: 200 OK

// ✅ DELETE - 删除资源
DELETE /api/v1/resources/123
Response: 204 No Content
```

---

## 请求与响应

### 1. 统一响应格式 🔴 MUST

**成功响应**:

```typescript
// 单个资源
{
  "data": {
    "id": "123",
    "title": "Resource Title",
    "type": "ARTICLE",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}

// 资源列表（带分页）
{
  "data": [
    { "id": "123", ... },
    { "id": "456", ... }
  ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}

// 无内容返回（如DELETE）
204 No Content
// 无响应体
```

**错误响应** (见错误处理章节):

```typescript
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ],
    "timestamp": "2024-01-01T00:00:00Z",
    "path": "/api/v1/users"
  }
}
```

### 2. Content-Type 🔴 MUST

```
请求:
Content-Type: application/json

响应:
Content-Type: application/json; charset=utf-8
```

### 3. 请求体验证 🔴 MUST

```typescript
// ✅ 正确 - 使用DTO和验证装饰器
import { IsString, IsEmail, IsEnum, Length, IsOptional } from 'class-validator';

export class CreateResourceDto {
  @IsString()
  @Length(1, 500)
  title: string;

  @IsEnum(ResourceType)
  type: ResourceType;

  @IsString()
  @IsOptional()
  @Length(0, 2000)
  description?: string;

  @IsString()
  sourceUrl: string;
}

// Controller中使用
@Post()
async create(@Body() createDto: CreateResourceDto) {
  // DTO自动验证，无效数据返回400
  return this.service.create(createDto);
}
```

---

## 错误处理

### 1. HTTP状态码 🔴 MUST

**成功响应**:

- `200 OK` - 成功获取/更新资源
- `201 Created` - 成功创建资源（需要返回Location header）
- `204 No Content` - 成功删除资源（无响应体）

**客户端错误 (4xx)**:

- `400 Bad Request` - 请求参数错误
- `401 Unauthorized` - 未认证
- `403 Forbidden` - 无权限
- `404 Not Found` - 资源不存在
- `409 Conflict` - 资源冲突（如重复创建）
- `422 Unprocessable Entity` - 语义错误（如业务规则违反）
- `429 Too Many Requests` - 请求过于频繁

**服务器错误 (5xx)**:

- `500 Internal Server Error` - 服务器内部错误
- `502 Bad Gateway` - 上游服务错误
- `503 Service Unavailable` - 服务暂时不可用

### 2. 错误响应格式 🔴 MUST

```typescript
interface ErrorResponse {
  error: {
    code: string; // 错误代码（用于程序处理）
    message: string; // 用户友好的错误信息
    details?: any; // 详细错误信息（可选）
    timestamp: string; // ISO 8601格式时间戳
    path: string; // 请求路径
    requestId?: string; // 请求ID（用于追踪）
  };
}
```

**示例**:

```typescript
// 验证错误 (400)
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format",
        "value": "not-an-email"
      },
      {
        "field": "password",
        "message": "Password must be at least 8 characters"
      }
    ],
    "timestamp": "2024-01-01T00:00:00Z",
    "path": "/api/v1/users",
    "requestId": "req-123456"
  }
}

// 资源不存在 (404)
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource with id '123' not found",
    "timestamp": "2024-01-01T00:00:00Z",
    "path": "/api/v1/resources/123"
  }
}

// 权限不足 (403)
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You don't have permission to access this resource",
    "timestamp": "2024-01-01T00:00:00Z",
    "path": "/api/v1/resources/123"
  }
}

// 服务器错误 (500)
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected error occurred",
    "timestamp": "2024-01-01T00:00:00Z",
    "path": "/api/v1/resources",
    "requestId": "req-123456"  // 重要：用于追踪日志
  }
}
```

### 3. 标准错误代码 🔴 MUST

| 错误代码                  | HTTP状态码 | 说明             |
| ------------------------- | ---------- | ---------------- |
| `VALIDATION_ERROR`        | 400        | 请求参数验证失败 |
| `INVALID_REQUEST`         | 400        | 无效的请求格式   |
| `UNAUTHORIZED`            | 401        | 未认证           |
| `TOKEN_EXPIRED`           | 401        | 令牌过期         |
| `FORBIDDEN`               | 403        | 无权限访问       |
| `RESOURCE_NOT_FOUND`      | 404        | 资源不存在       |
| `CONFLICT`                | 409        | 资源冲突         |
| `DUPLICATE_RESOURCE`      | 409        | 重复的资源       |
| `BUSINESS_RULE_VIOLATION` | 422        | 违反业务规则     |
| `RATE_LIMIT_EXCEEDED`     | 429        | 超过速率限制     |
| `INTERNAL_SERVER_ERROR`   | 500        | 服务器内部错误   |

---

## 版本控制

### 1. URL版本控制 🔴 MUST

使用URL路径进行版本控制（推荐）：

```
/api/v1/resources
/api/v2/resources
```

**版本策略**:

- 🔴 MUST: 重大变更（破坏性）增加主版本号
- 🟡 SHOULD: 保留至少一个旧版本供迁移
- 🟡 SHOULD: 在响应头中标注版本即将废弃

```typescript
// 废弃警告
Response Headers:
Deprecation: true
Sunset: Sat, 31 Dec 2024 23:59:59 GMT
Link: </api/v2/resources>; rel="successor-version"
```

### 2. 向后兼容 🔴 MUST

**兼容性变更**（不需要增加版本）:

- ✅ 添加新的可选字段
- ✅ 添加新的endpoint
- ✅ 添加新的查询参数（可选）

**破坏性变更**（必须增加版本）:

- ❌ 删除或重命名字段
- ❌ 更改字段类型
- ❌ 更改endpoint URL
- ❌ 更改必需参数

---

## 认证与授权

### 1. 认证方式 🔴 MUST

使用Bearer Token（JWT）:

```
Authorization: Bearer <token>
```

### 2. 权限检查 🔴 MUST

```typescript
// ✅ 正确 - 使用装饰器进行权限检查
@Controller("resources")
export class ResourcesController {
  @Get()
  @Public() // 公开访问
  async findAll() {}

  @Post()
  @Roles("user", "admin") // 需要user或admin角色
  async create(@Body() dto: CreateResourceDto) {}

  @Delete(":id")
  @Roles("admin") // 仅admin可删除
  async delete(@Param("id") id: string) {}
}
```

---

## 性能优化

### 1. 分页 🔴 MUST

所有列表接口必须支持分页：

```typescript
GET /api/v1/resources?page=1&limit=20

Response:
{
  "data": [ ... ],
  "pagination": {
    "total": 1000,
    "page": 1,
    "limit": 20,
    "totalPages": 50,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

**规则**:

- 🔴 MUST: 默认分页大小20
- 🔴 MUST: 最大分页大小100
- 🔴 MUST: 返回分页元数据

### 2. 字段筛选 🟡 SHOULD

允许客户端指定需要的字段：

```typescript
GET /api/v1/resources?fields=id,title,url

Response:
{
  "data": [
    {
      "id": "123",
      "title": "Title",
      "url": "https://..."
      // 只返回请求的字段
    }
  ]
}
```

### 3. 缓存 🟡 SHOULD

```typescript
// 使用ETag进行缓存验证
Response Headers:
ETag: "33a64df551425fcc55e4d42a148795d9f25f89d4"
Cache-Control: max-age=3600

// 客户端后续请求
Request Headers:
If-None-Match: "33a64df551425fcc55e4d42a148795d9f25f89d4"

// 如果未修改
Response: 304 Not Modified
```

### 4. 速率限制 🔴 MUST

```typescript
Response Headers:
X-RateLimit-Limit: 1000        // 限制总数
X-RateLimit-Remaining: 999     // 剩余请求数
X-RateLimit-Reset: 1640995200  // 重置时间（Unix时间戳）

// 超限时
Response: 429 Too Many Requests
Retry-After: 3600
```

---

## NestJS实现参考

### Controller示例

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

@ApiTags("resources")
@Controller("api/v1/resources")
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  @ApiOperation({ summary: "获取资源列表" })
  @ApiResponse({ status: 200, description: "成功返回资源列表" })
  async findAll(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
    @Query("sort") sort?: string,
    @Query("filter") filter?: Record<string, any>,
  ) {
    return this.resourcesService.findAll({ page, limit, sort, filter });
  }

  @Get(":id")
  @ApiOperation({ summary: "获取单个资源" })
  @ApiResponse({ status: 200, description: "成功返回资源" })
  @ApiResponse({ status: 404, description: "资源不存在" })
  async findOne(@Param("id") id: string) {
    return this.resourcesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "创建资源" })
  @ApiResponse({ status: 201, description: "成功创建资源" })
  @ApiResponse({ status: 400, description: "请求参数错误" })
  async create(@Body() createDto: CreateResourceDto) {
    return this.resourcesService.create(createDto);
  }

  @Put(":id")
  @ApiOperation({ summary: "完整替换资源" })
  @ApiResponse({ status: 200, description: "成功更新资源" })
  async replace(@Param("id") id: string, @Body() updateDto: UpdateResourceDto) {
    return this.resourcesService.replace(id, updateDto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "部分更新资源" })
  @ApiResponse({ status: 200, description: "成功更新资源" })
  async update(
    @Param("id") id: string,
    @Body() patchDto: Partial<UpdateResourceDto>,
  ) {
    return this.resourcesService.update(id, patchDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "删除资源" })
  @ApiResponse({ status: 204, description: "成功删除资源" })
  async delete(@Param("id") id: string) {
    await this.resourcesService.delete(id);
  }
}
```

---

## 参考资料

- [RESTful API Design Best Practices](https://restfulapi.net/)
- [Microsoft REST API Guidelines](https://github.com/microsoft/api-guidelines)
- [Google API Design Guide](https://cloud.google.com/apis/design)
- [NestJS Documentation](https://docs.nestjs.com/)

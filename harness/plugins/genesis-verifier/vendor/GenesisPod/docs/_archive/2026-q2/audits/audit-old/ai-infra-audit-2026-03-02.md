# AI Infrastructure 层架构质量审计报告

**审计日期**: 2026-03-02
**审计版本**: df90c16f6
**审计范围**: `backend/src/modules/ai-infra/` 全量代码
**审计员**: Arch Auditor Agent v2.0
**审计维度**: 8 维度，每项 10 分，满分 80 分

---

## 执行摘要

| #   | 维度       | 满分   | 得分   | 状态                                            |
| --- | ---------- | ------ | ------ | ----------------------------------------------- |
| 1   | 模块内聚性 | 10     | 7      | 良好，有轻微越权                                |
| 2   | 接口设计   | 10     | 6      | 部分控制器缺少必要防护                          |
| 3   | 安全性     | 10     | 7      | 整体较好，有残留裸 `process.env`                |
| 4   | 错误处理   | 10     | 6      | `throw new Error` 多处出现，L1 层不合规         |
| 5   | 测试覆盖   | 10     | 6      | 测试文件齐备但质量参差不齐                      |
| 6   | 代码质量   | 10     | 7      | 无 console.log / @ts-ignore，any 类型局限于测试 |
| 7   | 依赖合理性 | 10     | 5      | L1 层出现两处反向依赖 L2 (ai-engine)            |
| 8   | 配置管理   | 10     | 7      | ConfigService 采用率高，少量 process.env 残留   |
|     | **总分**   | **80** | **51** |                                                 |

---

## 子模块逐项分析

### auth/ — 认证（JWT、OAuth Google、注册/登录）

**得分参考**: 各维度综合评估

**优点**:

- `register.dto.ts` 使用了 `@IsEmail`、`@MinLength(8)`、`@Matches(大写小写数字正则)` 校验，注册入口做了完整的输入防护。
- `JwtStrategy` 在构造阶段用 **fail-fast** 模式验证 `JWT_SECRET` 必须存在，并警告过短密钥。
- `auth.controller.ts` 全部端点有 `@Throttle` 限流（注册/登录 5 req/min，刷新 10 req/min），有 `@ApiTags`/`@ApiOperation`/`@ApiBody`/`@ApiResponse`。
- JWT 策略走 Redis 黑名单，无状态但可踢人，设计合理。
- `generateTokens()` 使用独立 `REFRESH_TOKEN_SECRET`，access/refresh 密钥隔离。
- `bcrypt.hash(password, 10)` 加盐散列。
- `auth.service.spec.ts` 覆盖 register、login、refreshToken、findOrCreateGoogleUser、updateProfile、getUserStats，质量高。

**问题**:

1. **`auth.controller.ts:239` — 裸 `process.env.FRONTEND_URL`**

   ```typescript
   const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
   ```

   OAuth 回调重定向目标 URL 直接读 `process.env` 而非通过 `ConfigService`，规范不统一。

2. **`auth.service.ts:602` — `getUserStats` 使用 `UnauthorizedException` 语义不准**
   用户不存在应返回 `NotFoundException`，`UnauthorizedException` 暗示权限问题，容易误导调用方。

3. **`google.strategy.ts:23-27` — `process.env` 直读**
   PassportStrategy 父类构造时无法注入 `ConfigService`（NestJS 限制），但使用了 placeholder 值可以令 OAuth 在无配置时静默失败，应至少在启动时给出明确错误而非仅 warn。

4. **`auth/auth.service.spec.ts` 位于根目录而非 `__tests__/`**（与其他子模块约定不一致，根目录额外存在一个 `auth.service.spec.ts` 外加 `__tests__/auth.service.spec.ts` 占位文件，形成双重 spec 冲突）。
   - `__tests__/auth.service.spec.ts` 内容是 placeholder，没有实质测试。
   - 根目录的 `auth.service.spec.ts` 才是真实测试。
   - **风险**: 未来维护者可能在错误的文件中添加测试。

---

### credits/ — 积分系统（充值、消费、冻结、规则）

**优点**:

- `consumeCredits` 全程在 `$transaction` 内执行，余额检查和扣减原子化。
- 幂等性键（`idempotencyKey`）防重复扣费，设计良好。
- 专门的 `InsufficientCreditsException` / `AccountFrozenException`，语义清晰。
- `CheckinService` 使用 `LruMap` 防止缓存无限增长，符合规范。
- `forwardRef(() => CreditsService)` 在 `CheckinService` 注入 `CreditsService` 处有注释说明原因（互相依赖），合规。
- 测试文件结构完整（credits.service.spec.ts、credit-rules.service.spec.ts、checkin.service.spec.ts）。

**问题**:

1. **初始积分硬编码 `10000`，三处重复**
   `getOrCreateAccount`、`grantCredits`、`initializeAllUserAccounts` 中均硬编码 `balance: 10000`，应提取为常量 `const WELCOME_BONUS_CREDITS = 10000`。

2. **`credits.service.spec.ts:20-21` — `any` 类型出现在测试主 mock 定义**

   ```typescript
   let mockPrisma: any;
   let mockRulesService: any;
   ```

   测试文件中 `any` 可接受，但 `mockRulesService.getCreditsForOperation` 实际方法名与 `CreditRulesService` 真实方法 `calculateCredits` 不一致，导致测试与实现脱节——即使实现改变，测试也不会捕捉到。

3. **`CreditsController` 缺少 `@ApiOperation` 装饰**
   `@ApiTags("Credits")` 存在，但各端点无 `@ApiOperation`，Swagger 文档可读性差。

---

### storage/ — 对象存储管理（R2/B2 + DB 数据统计清理）

**优点**:

- `StorageController` 使用 `safeCompare` 进行 admin key 比对，符合恒时比较规范。
- `validateKey` 抛出 `BadRequestException` 而非 `Error`，语义正确。
- `R2StorageService` 使用 `ConfigService` 读取所有配置，无裸 `process.env`。
- `storage.service.ts`（2331 行）是整个 ai-infra 最大的文件，内含内存统计、系统统计、存储分类统计、数据库分析等，功能完整。

**问题**:

1. **`storage.service.ts` 体积严重过大 (2331 行)**
   内容混合了：
   - 节点内存监控（`NodeMemoryStats`）
   - 系统 OS 统计（`SystemMemoryStats`）
   - 数据库存储统计（`StorageStats`/`CleanupResult`）
   - R2/B2 对象存储（与 `r2-storage.service.ts` 重叠关注点）

   建议拆分为：`storage-stats.service.ts`（DB 统计）、`memory-stats.service.ts`（OS/Node 监控）。

2. **`StorageController` 标注 `@Public()` 但依赖 header admin key 做访问控制**
   如果 admin key 未设置或泄露，等于公开了所有清理端点。应改为同时使用 `@UseGuards(JwtAuthGuard, AdminGuard)` 而非纯 header key 方案。

3. **构造函数中 `throw new Error(...)`**（第 37 行）
   L1 层 Service 的构造期抛出 `new Error` 而非 NestJS 标准异常，导致容器启动失败时堆栈信息不够清晰。

---

### secrets/ — 密钥管理

**优点**:

- AES-256-CBC 加密，PBKDF2 密钥派生（100,000 次迭代），在生产环境严格要求密钥存在，设计安全。
- 完整的版本管理、审计日志（`SecretAccessLog`）、软删除，企业级设计。
- `toListItem` 不解密只用加密值 hash 生成 mask（`generateMaskedHint`），避免 list 操作泄露原文。
- `SecretsController` 全局 `@UseGuards(JwtAuthGuard, AdminGuard)`，覆盖所有端点。
- `@Throttle` 覆盖了创建（50/h）、value 获取（10/min）、删除（20/min）、迁移（3/h）等敏感操作。
- `SecretNameValidationPipe` 对 name 参数做格式校验，防路径遍历。

**问题**:

1. **`secrets.service.ts:287` — `delete` 方法中使用 `throw new Error`**

   ```typescript
   throw new Error(
     `Cannot delete secret '${name}': still referenced by ${references.length} configuration(s)`,
   );
   ```

   应使用 `throw new BadRequestException(...)` 或 `throw new ConflictException(...)`，以便 NestJS 全局异常过滤器生成规范的 HTTP 响应。

2. **静态 PBKDF2 盐 `"deepdive-secrets-salt-v1"`**
   文件注释写了"Static salt is OK since we're deriving from a secret"，这个说法在密码学上并非严格正确——使用静态盐削弱了对彩虹表的防护（尽管此处针对的是密钥派生而非用户密码存储，风险可接受）。但应在注释中更清楚说明此为`密钥拉伸（key stretching）`而非密码存储，防止后续维护者误用模式。

3. **`SecretsController` 没有 `@ApiOperation` 装饰**
   只有顶层 `@ApiTags("Admin - Secrets")`，各端点无操作说明。

4. **测试文件（`secrets.service.spec.ts`）中 mock 覆盖场景不完整**
   未测试 `rollback`、`getVersionValue` 等版本管理路径。

---

### settings/ — 系统设置

**优点**:

- `getWithEnvFallback` 优先读 DB，再回落 env，设计合理。
- `onModuleInit` 中刷新缓存并诊断加密问题，启动期及早发现问题。
- `getAll()` 将加密值替换为 `"********"` 再返回，不泄露明文。

**问题**:

1. **`settings.service.ts:86-89` — 硬编码 fallback 密钥**

   ```typescript
   const key =
     this.configService.get<string>("SETTINGS_ENCRYPTION_KEY") ||
     "deepdive-default-encryption-key!";
   this.encryptionKey = key.padEnd(32, "0").substring(0, 32);
   ```

   与 `SecretsService` 相比，`SettingsService` 没有对生产环境做 fail-fast 检查，允许使用弱默认密钥加密数据库设置。如果生产环境忘记配置 `SETTINGS_ENCRYPTION_KEY`，数据将以可预测的弱密钥加密，且不会报错。**这是一个潜在的安全风险**，需要与 `SecretsService` 对齐，至少在 `NODE_ENV=production` 时 throw。

2. **`settings.service.ts` 中 `AiSettings` 接口包含 `defaultModel`、`maxTokens`、`temperature`**

   ```typescript
   export interface AiSettings {
     defaultModel: string;
     maxTokens: number;
     temperature: number;
     ...
   }
   ```

   L1 层设置服务暴露 AI 参数，将 AI Engine 的关注点渗透到基础设施层。`maxTokens`/`temperature` 应属于 AI Engine 的 TaskProfile 配置而非 Settings Service。

3. **`settings.controller.ts` 路径前缀硬编码重复**
   ```typescript
   @Controller("api/v1/admin/settings")
   ```
   其他控制器使用相对路径（如 `@Controller("admin/secrets")`），由 app.module 统一加 `/api/v1` 前缀。此处硬编码完整路径，与项目约定不一致，若全局前缀变更会出现双重前缀 `/api/v1/api/v1/admin/settings`。

---

### email/ — 邮件服务

**优点**:

- `onModuleInit` 延迟初始化，容忍配置缺失（非关键服务不阻塞启动）。
- 支持 SMTP / Resend 双 provider，从数据库读取配置。
- 使用 `APP_CONFIG.brand.emailFrom` 而非硬编码品牌名。

**问题**:

1. **`email.service.ts:75` — `process.env.ADMIN_EMAIL` 裸读**

   ```typescript
   this.adminEmail = emailSettings.adminEmail || process.env.ADMIN_EMAIL || "";
   ```

   `emailSettings.adminEmail` 已经通过 `SettingsService.getWithEnvFallback("admin_email", "ADMIN_EMAIL")` 读取了 env fallback，此处再直接读 `process.env.ADMIN_EMAIL` 形成冗余且不规范的双重读取。

2. **`ResendEmailPayload` 接口使用 `[key: string]: unknown`**

   ```typescript
   interface ResendEmailPayload {
     ...
     [key: string]: unknown;
   }
   ```

   这使 TypeScript 失去对 Resend payload 多余字段的保护。

3. **`email.service.ts` 无测试覆盖发送失败时的错误处理路径**
   现有 `email.service.spec.ts` 主要测试配置逻辑，未测试 nodemailer 发送失败 / Resend API 错误的 catch 路径。

---

### release/ — 发布管理（Git changelog + AI 生成 release notes）

**优点**:

- 使用 `execFileSync` 替代 `exec` 防止 shell 注入，并有 `TAG_PATTERN` 正则校验 tag 格式。
- AI 调用通过 `ChatFacade.chat()` + `taskProfile`，符合规范（无硬编码模型名）。
- 降级路径（AI 失败时生成基础 release notes）完整。
- 测试文件质量高，覆盖 git 变更收集、commit 解析、AI 生成等路径。

**问题**:

1. **L1 → L2 反向依赖（严重）**

   ```typescript
   // release.service.ts:13
   import { ChatFacade } from "../../ai-engine/facade";
   ```

   `ai-infra` 是 L1 层，`ai-engine` 是 L2 层。L1 导入 L2 违反 6 层架构单向依赖规则。
   - `facade/index.ts` 也专门注释排除了 `ReleaseService`，承认这是架构缺陷（"NOTE: ReleaseService NOT exported — it imports from ai-engine/facade which creates L1→L2 circular chains"）。
   - **修复建议**: `ReleaseService` 应上移至 L4 (`ai-app/`) 或通过事件驱动（EventEmitter）解耦，让 L2 Engine 触发通知事件，L1 订阅。

2. **`release/release.service.ts` 多处 `throw new Error`（第 49、85、233、394 行）**
   这些异常在 Service 层被抛出但无对应 Controller 捕获为规范 HTTP 响应。

---

### table-management/ — 数据库表管理

**优点**:

- `validateTableName` 双重防护：正则验证格式 + 白名单（`TABLE_CATEGORIES` 中的已知表名），有效防止 SQL 注入。
- `$queryRawUnsafe` 使用参数化 `$1` 占位符传递 tableName 和 limit，安全。
- `TABLE_CATEGORIES` 枚举所有已知 Prisma 表，未知表直接拒绝，零信任设计。

**问题**:

1. **`TableManagementController` 无 Auth Guard（严重安全问题）**

   ```typescript
   @ApiTags("Admin - Tables")
   @Controller("admin/tables")
   export class TableManagementController {
   ```

   控制器没有任何 `@UseGuards`，没有 `@Public()` 标记，依赖全局 Guard 保护。但如果全局 Guard 有任何配置漏洞，这些能查看全量数据库表结构、执行 cleanup 的端点将完全暴露。对比 `SecretsController` 和 `SettingsController` 都有明确的 `@UseGuards(JwtAuthGuard, AdminGuard)`，此处遗漏显著。

2. **`table-management.service.ts` 体积偏大 (1034 行)**
   表统计、诊断、清理逻辑均在同一文件，可考虑拆分。

3. **`throw new Error` 两处（第 713、721 行）**
   validateTableName 内部抛出裸 `Error`，调用方需要特殊处理才能转为 HTTP 400，但控制器中未做 catch。

---

### monitoring/ — 监控（AI 指标、错误追踪、健康检查）

**优点**:

- `HealthCheckService` 并行执行三个子系统检查（`Promise.allSettled`），任何一个失败不影响其他。
- AI Engine 健康度基于成功率阈值（<50% = degraded），合理。
- `ErrorTrackingService` 使用 fingerprint 聚合同类错误，替代 Sentry 功能设计良好。

**问题**:

1. **`monitoring/health-check.service.ts:20` — L1 → L2 反向依赖（严重）**

   ```typescript
   import { AiObservabilityService } from "../../ai-engine/facade";
   ```

   健康检查服务（L1）依赖 AI 可观测服务（L2）。同样在 `facade/index.ts` 中已注释排除："NOTE: HealthCheckService NOT exported"。
   - **修复建议**: 健康检查应通过接口注入（Token + 可选依赖 `@Optional()`）或事件查询，而非直接导入 L2 符号。此处虽然用了 `@Optional()`，但导入声明本身已经违反层次规则。

2. **`health-check.service.ts:121` — 硬编码版本号 fallback**

   ```typescript
   version: process.env.npm_package_version || "3.70.0",
   ```

   `"3.70.0"` 是硬编码的版本字符串，随着版本迭代会过时。应改为 `"unknown"` 或从 `ConfigService` / package.json 动态读取。

3. **`AIMetricsService` 中硬编码 10 个模型的价格表**
   ```typescript
   private readonly MODEL_COSTS: Record<string, { input: number; output: number }> = {
     "gpt-4o": { input: 0.005, output: 0.015 },
     "claude-3-opus-20240229": { input: 0.015, output: 0.075 },
     ...
   };
   ```
   这是 L1 层（monitoring）持有 L3 层（AI Engine）的模型定价数据，关注点错误。模型价格配置应在 L3 维护，L1 通过查询获取。

---

### notifications/ — 通知服务

**优点**:

- `VALID_NOTIFICATION_TYPES` 做类型白名单验证，防止非法枚举值写入 DB。
- `batchCreateNotifications` 设计良好，`ReleaseService` 可直接复用。

**问题**:

1. **`NotificationController` 各端点无 `@ApiOperation` 和 `@ApiResponse`**
   只有 `@ApiTags("Notifications")` 和各端点的 `@ApiOperation({ summary })` 是存在的，缺少 `@ApiResponse` 标注。

---

### user-api-keys/ — 用户级 API key 管理

**优点**:

- SSRF 防护：`validateEndpointUrl` 检查 HTTP/HTTPS 协议，并通过 `isPrivateHost` 阻止内网 IP。
- 加密方案与 `SecretsService` 一致（AES-256-CBC + PBKDF2）。
- 密钥 hint（`generateKeyHint`）只显示前 4 位+后 4 位，不泄露完整 key。
- 捐赠模式下有序的三步操作（Secret → DB → Credits），并有回滚逻辑。

**问题**:

1. **`user-api-keys/user-api-keys.service.ts:26-68` — 硬编码多个模型名**

   ```typescript
   const PROVIDER_DEFAULTS: Record<string, { endpoint: string; testModel: string }> = {
     openai:    { testModel: "gpt-4o-mini", ... },
     anthropic: { testModel: "claude-3-haiku-20240307", ... },
     deepseek:  { testModel: "deepseek-chat", ... },
     xai:       { testModel: "grok-3-mini-fast", ... },
   };
   const ANTHROPIC_VALIDATION_MODEL = "claude-3-haiku-20240307";
   ```

   这些模型名用于 API key 测试（validation）而非 AI Engine 调用，是技术上的测试端点配置，属于例外场景。但仍应加注释说明为何可以绕过"禁止硬编码模型名"规则，否则后续代码审查会产生混乱。

2. **`UserApiKeysController` 无 `@ApiOperation` 标注**。

---

## 维度汇总评分

### 1. 模块内聚性 [7/10]

大多数子模块职责单一清晰。问题：

- `storage.service.ts` (2331 行) 混合了 OS 内存监控、数据库统计、清理逻辑，内聚性低。
- `settings/` 中 `AiSettings.maxTokens/temperature` 是 AI Engine 关注点渗透。
- `monitoring/ai-metrics.service.ts` 中持有 AI 模型定价表，属于越权知识。

扣分: -3（storage 大文件 -1，settings 职责越界 -1，monitoring 模型知识 -1）

---

### 2. 接口设计 [6/10]

**优点**: `auth/` Controller 有完整 Swagger/DTO/Throttle；`secrets/` Controller 有 AdminGuard + 细粒度限流。

**问题**:

- `TableManagementController` 无显式 `@UseGuards`，依赖全局 Guard 隐式保护，风险暴露显著。
- `CreditsController`、`UserApiKeysController`、`SecretsController`、`NotificationController` 各端点缺少 `@ApiOperation` 和 `@ApiResponse`。
- `settings.controller.ts` 路径前缀硬编码完整路径（`"api/v1/admin/settings"`），与项目约定不一致。

扣分: -4（TableManagement 无 Guard -2，Swagger 覆盖率低 -2）

---

### 3. 安全性 [7/10]

**优点**: `safeCompare` 用于 admin key 比对；JWT fail-fast；bcrypt 密码散列；PBKDF2 密钥派生；参数化 SQL；tag 格式校验；SSRF 防护。

**问题**:

- `settings.service.ts` 生产环境允许使用硬编码弱默认密钥（与 `SecretsService` 不一致）。
- `StorageController` 用 `@Public()` + header key 代替 JWT Guard，降低了保护强度。
- Google Strategy 中 `process.env` 直读，OAuth 秘钥不经 ConfigService（构造器限制，但至少缺少 warn-on-startup 的清晰日志）。

扣分: -3（settings 弱密钥 -2，Storage 公开端点 -1）

---

### 4. 错误处理 [6/10]

**问题**:

- `throw new Error(...)` 出现于 Service 层 **14 处**（不含测试和启动期 fail-fast）：
  - `secrets.service.ts` (3 处)
  - `table-management.service.ts` (3 处)
  - `release.service.ts` (4 处)
  - `storage.service.ts` / `storage.controller.ts` (2 处)
  - `checkin.service.ts` (1 处)
  - `user-api-keys/` (1 处)
- 在 Service 层应使用 `BadRequestException`、`ConflictException`、`NotFoundException` 等 NestJS HTTP 异常。
- `auth.service.ts:602` `getUserStats` 用 `UnauthorizedException` 表达用户不存在，语义错误。
- `health-check.service.ts:112` 的空 catch `catch { }` 虽然合理（best-effort 操作），但未记录日志。

扣分: -4（多处裸 Error -3，一处语义错误异常 -1）

---

### 5. 测试覆盖 [6/10]

**统计**: 所有子模块都有 spec 文件。

| 子模块           | 有 spec? | 质量评估                                              |
| ---------------- | -------- | ----------------------------------------------------- |
| auth             | 是       | 高（但双重 spec 文件结构混乱）                        |
| credits          | 是       | 中（mock 方法名与实现不一致）                         |
| secrets          | 是       | 中（缺少版本管理路径测试）                            |
| settings         | 是       | 中（覆盖核心 get/set，缺少加密错误路径）              |
| storage          | 是       | 中（Controller 测试较好）                             |
| email            | 是       | 低（仅覆盖配置逻辑，未覆盖发送失败）                  |
| release          | 是       | 高（覆盖 git 解析、AI 生成、降级路径）                |
| table-management | 是       | 低（主要测试统计函数，未测试 validateTableName 边界） |
| user-api-keys    | 是       | 中                                                    |
| monitoring       | 是       | 中                                                    |
| notifications    | 是       | 中                                                    |

**主要问题**:

- `auth/__tests__/auth.service.spec.ts` 是 placeholder（只有 `expect(true).toBe(true)`），与根目录的真实 spec 重复，造成维护混乱。
- `credits.service.spec.ts` mock 方法名 `getCreditsForOperation` 与实现的 `calculateCredits` 不一致，测试与实现脱节。
- email、table-management 测试覆盖薄弱。

扣分: -4（placeholder 测试 -1，mock 脱节 -1，覆盖薄弱 -2）

---

### 6. 代码质量 [7/10]

**优点**:

- 零 `console.log`。
- 零 `@ts-ignore` / `@ts-expect-error`。
- Logger 统一使用 NestJS `Logger`。
- 无品牌名硬编码（使用 `APP_CONFIG.brand.*`）。

**问题**:

- `any` 类型在测试文件中出现多处（`mockPrisma: any`、`mockRulesService: any`），可接受但影响测试的类型保障。
- `storage.service.ts` 2331 行超过合理体积上限（建议 500 行）。
- `table-management.service.ts` 1034 行也超过上限。
- `settings.service.ts` 735 行接近上限。
- `ResendEmailPayload` 接口使用 `[key: string]: unknown` 索引签名。

扣分: -3（超大文件 -2，any 类型 -1）

---

### 7. 依赖合理性 [5/10]

**L1 → L2 反向依赖（2 处，严重违规）**:

| 文件                                    | 违规导入                                                          | 说明                               |
| --------------------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `monitoring/health-check.service.ts:20` | `import { AiObservabilityService } from "../../ai-engine/facade"` | L1 Health Check 依赖 L2 可观测服务 |
| `release/release.service.ts:13`         | `import { ChatFacade } from "../../ai-engine/facade"`             | L1 Release 依赖 L2 AI 能力         |

两处反向依赖均在 `facade/index.ts` 中有注释承认，但注释承认不等于架构合规。

**子模块间依赖**:

- `user-api-keys/` → `secrets/` + `credits/`：合理（同 L1 层内部依赖）。
- `email/` → `settings/`：合理。
- `release/` → `notifications/`：合理。

扣分: -5（两处 L1→L2 反向依赖各 -2.5）

---

### 8. 配置管理 [7/10]

**采用率统计**（非测试文件中的 `process.env` 直读）:

| 文件                                       | process.env 直读                       | 合理性                                 |
| ------------------------------------------ | -------------------------------------- | -------------------------------------- |
| `auth/auth.controller.ts:239`              | `process.env.FRONTEND_URL`             | 不合理，应用 ConfigService             |
| `auth/strategies/google.strategy.ts:23-37` | `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` | 有限合理（Passport 构造器限制）        |
| `email/email.service.ts:75`                | `process.env.ADMIN_EMAIL`              | 不合理，冗余读取                       |
| `monitoring/health-check.service.ts:121`   | `process.env.npm_package_version`      | 可接受（包版本无法通过 ConfigService） |

绝大多数配置通过 `ConfigService` 访问，4 处直读中仅 2 处需要修复。

扣分: -3（hardcoded fallback 密钥 -2，2 处不合理 process.env -1）

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                                         | 维度             | 文件                                        | 修复成本                   | 建议时机 |
| ------ | ---------------------------------------------------------------------------- | ---------------- | ------------------------------------------- | -------------------------- | -------- |
| P0     | `TableManagementController` 无显式 `@UseGuards`，可能暴露 admin 清理端点     | 安全、接口       | `table-management.controller.ts`            | 低（加 2 行装饰器）        | 立即     |
| P0     | `SettingsService` 生产环境允许弱默认加密密钥（无 fail-fast）                 | 安全             | `settings.service.ts:86-89`                 | 低（对齐 SecretsService）  | 立即     |
| P1     | L1→L2 反向依赖：`health-check.service.ts` 导入 `AiObservabilityService`      | 依赖方向         | `monitoring/health-check.service.ts:20`     | 中（接口抽象或事件驱动）   | 本迭代   |
| P1     | L1→L2 反向依赖：`release.service.ts` 导入 `ChatFacade`                       | 依赖方向         | `release/release.service.ts:13`             | 高（需移动或重新架构）     | 本迭代   |
| P1     | `auth.controller.ts` 裸 `process.env.FRONTEND_URL`                           | 配置管理         | `auth/auth.controller.ts:239`               | 低（注入 ConfigService）   | 本迭代   |
| P1     | Service 层多处 `throw new Error` (14 处)                                     | 错误处理         | 见上方列表                                  | 中（逐一替换为 HTTP 异常） | 本迭代   |
| P2     | `storage.service.ts` 体积 2331 行，混合多个关注点                            | 代码质量、内聚性 | `storage/storage.service.ts`                | 高（拆分 service）         | 下次迭代 |
| P2     | `AIMetricsService` 中硬编码模型定价表（L1 持有 L3 知识）                     | 依赖合理性       | `monitoring/ai-metrics.service.ts:56-70`    | 中（查询 AI Engine）       | 下次迭代 |
| P2     | `settings.service.ts` 中 `AiSettings` 接口含 AI Engine 参数                  | 模块内聚         | `settings/settings.service.ts`              | 中（重新分配到 Engine）    | 下次迭代 |
| P2     | `settings.controller.ts` 路径前缀硬编码 `"api/v1/admin/settings"`            | 接口设计         | `settings/settings.controller.ts:31`        | 低（移除 api/v1 前缀）     | 下次迭代 |
| P3     | `auth/__tests__/auth.service.spec.ts` placeholder + 根目录真实 spec 双重冲突 | 测试             | `auth/__tests__/auth.service.spec.ts`       | 低（合并或清理）           | 长期     |
| P3     | `credits.service.spec.ts` mock 方法名与实现不一致                            | 测试             | `credits/__tests__/credits.service.spec.ts` | 低（修正 mock）            | 长期     |
| P3     | 多处 Controller 缺少 `@ApiOperation`/`@ApiResponse`                          | 接口设计         | 多文件                                      | 低（逐一补充）             | 长期     |
| P3     | 初始积分 `10000` 三处重复硬编码                                              | 代码质量         | `credits/credits.service.ts`                | 低（提取常量）             | 长期     |
| P3     | health-check 硬编码版本 fallback `"3.70.0"`                                  | 代码质量         | `monitoring/health-check.service.ts:121`    | 低（改为 "unknown"）       | 长期     |

---

## 建议行动项

### 必须处理（本迭代，P0）

- [ ] **为 `TableManagementController` 添加 `@UseGuards(JwtAuthGuard, AdminGuard)`**
      路径: `backend/src/modules/ai-infra/table-management/table-management.controller.ts`

- [ ] **`SettingsService` 在生产环境强制要求 `SETTINGS_ENCRYPTION_KEY`**，对齐 `SecretsService` 的 fail-fast 行为。
      路径: `backend/src/modules/ai-infra/settings/settings.service.ts:86-89`

### 计划处理（本迭代，P1）

- [ ] **`auth.controller.ts` OAuth 回调的 `FRONTEND_URL` 改为通过 `ConfigService` 读取**
      注入 `ConfigService` 并替换 `process.env.FRONTEND_URL`

- [ ] **将 Service 层的 `throw new Error(...)` 替换为 NestJS 标准异常**（按影响范围逐一替换）

- [ ] **制定 L1→L2 反向依赖的修复方案**（Health Check 通过接口注入解耦；ReleaseService 需要迁移或重新设计）

### 长期改进

- [ ] 拆分 `storage.service.ts`（建议独立出 `memory-stats.service.ts`）
- [ ] 将 AI 模型定价数据从 `AIMetricsService` 迁移至 L3 AI Engine 层查询
- [ ] 清理 `auth/__tests__/` 中的 placeholder 测试文件
- [ ] 修正 `credits.service.spec.ts` 中 mock 方法名与实现不一致问题
- [ ] 为所有 Controller 补充 `@ApiOperation`/`@ApiResponse` Swagger 标注
- [ ] 提取积分初始值常量 `WELCOME_BONUS_CREDITS`
- [ ] 将 `settings.controller.ts` 路径从 `"api/v1/admin/settings"` 改为 `"admin/settings"`

---

## 总评

AI Infrastructure 层（L1）是整个平台的基础，整体工程质量中等偏上。

**做得好的方面**:

- `secrets/` 子模块是 ai-infra 中设计质量最高的：AES+PBKDF2、版本管理、审计日志、safeCompare、限流覆盖完整，达到企业级水准。
- `auth/` 安全基础扎实：bcrypt、JWT fail-fast、限流、黑名单。
- `user-api-keys/` SSRF 防护和加密设计合理。
- 无 `console.log`，Logger 使用一致，无 `@ts-ignore`。

**需要改进的方面**:

- 2 处 L1→L2 反向依赖是架构层次的系统性违规，需在架构层面解决而非只是注释说明。
- `TableManagementController` 无显式 Guard 是立即需要修复的安全问题。
- `SettingsService` 弱默认密钥与 `SecretsService` 不一致，存在生产安全隐患。
- Service 层广泛使用裸 `throw new Error`，破坏了 NestJS 异常统一处理的预期。

---

_评分说明: 满分 80 分（8 维度 × 10 分），本次得分 51/80 (64%)_
_下次建议审计: 2026-04-02（月度）_
_报告工具: Arch Auditor Agent v2.0_

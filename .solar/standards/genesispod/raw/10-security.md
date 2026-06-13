# 安全规范

**版本：** 1.0
**强制级别：** 🔴 MUST
**更新日期：** 2025-11-08

---

## 核心原则

```
✅ 纵深防御 - 多层安全措施
✅ 最小权限原则 - 仅授予必需权限
✅ 安全默认 - 默认配置必须安全
✅ 失败安全 - 失败时应拒绝访问
✅ 不信任任何输入 - 验证所有外部数据
```

---

## 密钥和敏感信息管理

### 🔴 MUST - 严格遵守

#### 1. 禁止硬编码密钥

```typescript
❌ 绝对禁止
const apiKey = 'sk-xxx-hardcoded-key';  // 永远不要！
const password = 'admin123';             // 永远不要！
const jwtSecret = 'my-secret';           // 永远不要！

✅ 正确做法
import { secrets } from './config/secrets';
const apiKey = secrets.grokApiKey;  // 从环境变量加载
```

#### 2. 环境变量管理

```bash
✅ .env 文件（本地开发）
# ✅ 不提交到 Git
GROK_API_KEY=grok-xxx-actual-key
OPENAI_API_KEY=sk-xxx-actual-key
DATABASE_URL=postgresql://...
JWT_SECRET=long-random-secret-string

✅ .env.example 文件（提交到 Git）
# ✅ 提供模板，不含实际密钥
GROK_API_KEY=<从 GCP Secret Manager 获取>
OPENAI_API_KEY=<从 GCP Secret Manager 获取>
DATABASE_URL=postgresql://user:password@localhost:5432/genesis
JWT_SECRET=<生成随机密钥>
```

#### 3. GCP Secret Manager（生产环境）

```typescript
// ai-service/utils/secret_manager.py
import os
from google.cloud import secretmanager

class SecretManager:
    def __init__(self):
        self.use_gcp = os.getenv('USE_GCP_SECRET_MANAGER', 'false') == 'true'
        if self.use_gcp:
            self.client = secretmanager.SecretManagerServiceClient()
            self.project_id = os.getenv('GCP_PROJECT_ID')

    def get_grok_api_key(self) -> str:
        if self.use_gcp:
            # 从 GCP Secret Manager 获取
            name = f"projects/{self.project_id}/secrets/GROK_API_KEY/versions/latest"
            response = self.client.access_secret_version(request={"name": name})
            return response.payload.data.decode('UTF-8')
        else:
            # 从环境变量获取
            api_key = os.getenv('GROK_API_KEY')
            if not api_key:
                raise ValueError("GROK_API_KEY not found")
            return api_key
```

#### 4. 密钥验证

```typescript
// backend/src/config/secrets.ts
function loadSecrets(): Secrets {
  const required = [
    "GROK_API_KEY",
    "OPENAI_API_KEY",
    "JWT_SECRET",
    "DATABASE_URL",
  ];

  // 验证所有必需密钥存在
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required secret: ${key}`);
    }
  }

  return {
    grokApiKey: process.env.GROK_API_KEY!,
    openaiApiKey: process.env.OPENAI_API_KEY!,
    jwtSecret: process.env.JWT_SECRET!,
    databaseUrl: process.env.DATABASE_URL!,
  };
}
```

#### 5. 日志中不暴露密钥

```typescript
❌ 错误做法
console.log(`API Key: ${apiKey}`);  // 永远不要记录密钥！
logger.error(`Failed with key ${apiKey}`);

✅ 正确做法
logger.info('API key loaded successfully');
logger.error('API call failed', { errorCode: 'AUTH_FAILED' });  // 不含密钥

// 如果必须记录用于调试，脱敏处理
const maskedKey = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);
logger.debug(`Using key: ${maskedKey}`);  // grok-xxx...xy12
```

---

## 输入验证

### 🔴 MUST - 严格遵守

#### 1. 使用验证库（Zod / class-validator）

```typescript
// backend/src/modules/resource/dto/create-resource.dto.ts
import { IsString, IsEnum, IsUrl, Length, IsOptional } from 'class-validator';

export class CreateResourceDto {
  @IsString()
  @Length(1, 1000)
  title: string;

  @IsEnum(ResourceType)
  type: ResourceType;

  @IsUrl()
  sourceUrl: string;

  @IsString()
  @IsOptional()
  @Length(0, 10000)
  abstract?: string;
}

// 使用
@Post()
async createResource(@Body() createDto: CreateResourceDto) {
  // ValidationPipe 自动验证
  return await this.resourcesService.create(createDto);
}
```

#### 2. API 端点验证

```typescript
// frontend/lib/api-client.ts
import { z } from "zod";

const ResourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(1000),
  type: z.enum(["PAPER", "PROJECT", "NEWS", "EVENT"]),
  sourceUrl: z.string().url(),
});

export async function fetchResource(id: string): Promise<Resource> {
  // 验证输入
  const validatedId = z.string().uuid().parse(id);

  const response = await fetch(`/api/v1/resources/${validatedId}`);
  const data = await response.json();

  // 验证输出
  return ResourceSchema.parse(data);
}
```

#### 3. 文件上传验证

```typescript
// backend/src/modules/upload/upload.service.ts
import { extname } from "path";

const ALLOWED_FILE_TYPES = [".pdf", ".png", ".jpg", ".jpeg"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function validateFile(file: Express.Multer.File): void {
  // 检查文件类型
  const ext = extname(file.originalname).toLowerCase();
  if (!ALLOWED_FILE_TYPES.includes(ext)) {
    throw new Error(`File type ${ext} not allowed`);
  }

  // 检查文件大小
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File size ${file.size} exceeds limit`);
  }

  // 检查 MIME 类型
  const allowedMimes = ["application/pdf", "image/png", "image/jpeg"];
  if (!allowedMimes.includes(file.mimetype)) {
    throw new Error(`MIME type ${file.mimetype} not allowed`);
  }
}
```

---

## SQL/NoSQL 注入防护

### 🔴 MUST - 严格遵守

#### 1. 使用 ORM（Prisma）- 自动防护

```typescript
✅ Prisma 自动防护 SQL 注入
await prisma.user.findMany({
  where: {
    email: userInput,  // 安全：Prisma 自动转义
  },
});

await prisma.resource.findMany({
  where: {
    title: {
      contains: searchQuery,  // 安全：参数化查询
    },
  },
});

❌ 永远不要拼接 SQL
const query = `SELECT * FROM users WHERE email = '${userInput}'`;  // 危险！
await prisma.$queryRawUnsafe(query);  // 永远不要这样做！

✅ 如果必须使用原生 SQL，使用参数化
await prisma.$queryRaw`
  SELECT * FROM users
  WHERE email = ${userInput}
`;  // 安全：参数化查询
```

#### 2. PostgreSQL JSONB 注入防护

```typescript
// ✅ 使用 Prisma 参数化查询（推荐）
const result = await prisma.rawData.findFirst({
  where: {
    source: userInputSource,  // Prisma 自动处理转义
    data: {
      path: ['title'],
      string_contains: userInput,
    },
  },
});

// ✅ 使用 Prisma 原生查询（参数化）
await prisma.$queryRaw`
  SELECT * FROM raw_data
  WHERE data->>'title' = ${userInput}
`;  // 安全：参数化查询

❌ 避免使用字符串拼接构建 JSONB 查询
const query = `SELECT * FROM raw_data WHERE data->>'title' = '${userInput}'`;
await prisma.$queryRawUnsafe(query);  // 危险：SQL 注入

✅ 验证输入
const schema = z.object({
  source: z.enum(['arxiv', 'github', 'youtube']),
  sourceId: z.string().max(100),
});
const validated = schema.parse(userInput);
```

---

## XSS（跨站脚本）防护

### 🔴 MUST - 严格遵守

#### 1. React 默认转义

```tsx
✅ React 默认安全
function ResourceCard({ resource }: Props) {
  return (
    <div>
      {/* React 自动转义，防止 XSS */}
      <h3>{resource.title}</h3>
      <p>{resource.abstract}</p>
    </div>
  );
}

❌ 避免使用 dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ __html: userInput }} />  // 危险！

✅ 如果必须使用，先消毒
import DOMPurify from 'dompurify';

function SafeHTML({ html }: { html: string }) {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p'],
    ALLOWED_ATTR: ['href'],
  });

  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
}
```

#### 2. 后端输出编码

```typescript
// NestJS 默认使用 Helmet 中间件
// main.ts
import helmet from "helmet";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }),
);
```

---

## CSRF（跨站请求伪造）防护

### 🔴 MUST - 严格遵守

```typescript
// backend/main.ts
import csurf from "csurf";

// 启用 CSRF 保护
app.use(
  csurf({
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    },
  }),
);

// 前端获取 CSRF token
// frontend/lib/api-client.ts
const csrfToken = document
  .querySelector('meta[name="csrf-token"]')
  ?.getAttribute("content");

fetch("/api/v1/resources", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
  },
  body: JSON.stringify(data),
});
```

---

## 认证和授权

### 🔴 MUST - 严格遵守

#### 1. JWT 认证

```typescript
// backend/src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,  // 验证过期时间
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: any) {
    return { userId: payload.sub, email: payload.email };
  }
}

// 使用
@UseGuards(JwtAuthGuard)
@Get('profile')
async getProfile(@Request() req) {
  return req.user;  // 已验证的用户
}
```

#### 2. 密码安全

```typescript
import * as bcrypt from 'bcrypt';

// ✅ 存储密码：使用 bcrypt 哈希
const SALT_ROUNDS = 10;

async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

// ✅ 验证密码
async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return await bcrypt.compare(password, hashedPassword);
}

❌ 永远不要明文存储密码
await prisma.user.create({
  data: {
    email,
    password: password,  // 危险！
  },
});

✅ 正确做法
await prisma.user.create({
  data: {
    email,
    password: await hashPassword(password),  // 安全
  },
});
```

#### 3. 权限控制

```typescript
// backend/src/common/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export enum Role {
  USER = 'user',
  ADMIN = 'admin',
}

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

// 使用
@Roles(Role.ADMIN)
@Delete(':id')
async deleteResource(@Param('id') id: string) {
  return await this.resourcesService.delete(id);
}
```

---

## Proxy 服务安全

### 🔴 MUST - 严格遵守

```typescript
// backend/src/proxy/proxy.controller.ts
@Controller("proxy")
export class ProxyController {
  // ✅ 域名白名单
  private readonly ALLOWED_DOMAINS = [
    "arxiv.org",
    "openreview.net",
    "papers.nips.cc",
  ];

  @Get("pdf")
  async proxyPdf(@Query("url") url: string, @Res() res: Response) {
    // 验证 URL 参数存在
    if (!url) {
      throw new HttpException("URL required", HttpStatus.BAD_REQUEST);
    }

    try {
      const urlObj = new URL(url);

      // ✅ 域名白名单检查
      const isAllowed = this.ALLOWED_DOMAINS.some(
        (domain) =>
          urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`),
      );

      if (!isAllowed) {
        throw new HttpException(
          `Domain ${urlObj.hostname} not allowed`,
          HttpStatus.FORBIDDEN,
        );
      }

      // ✅ 仅允许 HTTP/HTTPS
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        throw new HttpException("Invalid protocol", HttpStatus.BAD_REQUEST);
      }

      // 代理请求
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024, // 50MB 限制
      });

      res.setHeader("Content-Type", "application/pdf");
      res.send(Buffer.from(response.data));
    } catch (error) {
      // 错误处理...
    }
  }
}
```

---

## 安全 Headers

### 🔴 MUST - 严格遵守

```typescript
// backend/main.ts
import helmet from "helmet";

app.use(
  helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.x.ai"],
      },
    },
    // X-Frame-Options (防止点击劫持)
    frameguard: { action: "deny" },
    // X-Content-Type-Options
    noSniff: true,
    // Strict-Transport-Security
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
  }),
);

// CORS 配置
app.enableCors({
  origin: ["http://localhost:3000"], // 仅允许特定来源
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
});
```

---

## 速率限制

### 🔴 MUST - 严格遵守

```typescript
// backend/main.ts
import rateLimit from "express-rate-limit";

// API 速率限制
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 最多 100 次请求
  message: "Too many requests, please try again later",
});

app.use("/api/", apiLimiter);

// 登录端点更严格的限制
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 最多 5 次登录尝试
  message: "Too many login attempts, please try again later",
});

app.use("/api/v1/auth/login", loginLimiter);
```

---

## 依赖安全

### 🔴 MUST - 严格遵守

```bash
# 定期检查依赖漏洞
npm audit

# 修复已知漏洞
npm audit fix

# Python 依赖检查
pip install safety
safety check

# 在 CI/CD 中自动检查
# .github/workflows/security.yml
name: Security Check
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run npm audit
        run: npm audit --audit-level=high
```

---

## 安全检查清单

### 提交代码前检查：

- [ ] 没有硬编码的 API 密钥
- [ ] 没有硬编码的密码
- [ ] .env 文件已加入 .gitignore
- [ ] 所有输入都经过验证
- [ ] 使用 Prisma ORM（防 SQL 注入）
- [ ] 不使用 dangerouslySetInnerHTML
- [ ] 文件上传有类型和大小限制
- [ ] API 端点有速率限制
- [ ] 敏感操作需要认证
- [ ] 管理员操作需要权限检查
- [ ] 日志不包含敏感信息
- [ ] Proxy 使用域名白名单
- [ ] 依赖包没有已知漏洞

---

## 常见安全漏洞

### ❌ 不安全的代码

```typescript
// SQL 注入
const query = `SELECT * FROM users WHERE id = ${userId}`;

// XSS
<div dangerouslySetInnerHTML={{ __html: userComment }} />

// 硬编码密钥
const apiKey = 'sk-xxx-hardcoded';

// 明文密码
await db.users.create({ password: 'admin123' });

// 无限制的代理
@Get('proxy')
async proxy(@Query('url') url: string) {
  return await axios.get(url);  // 可被用于 SSRF 攻击
}
```

### ✅ 安全的代码

```typescript
// 使用 ORM
await prisma.user.findUnique({ where: { id: userId } });

// 消毒 HTML
const clean = DOMPurify.sanitize(userComment);

// 环境变量
const apiKey = process.env.API_KEY;

// 哈希密码
const hashed = await bcrypt.hash(password, 10);

// 域名白名单
if (!ALLOWED_DOMAINS.includes(new URL(url).hostname)) {
  throw new Error("Domain not allowed");
}
```

---

**记住：** 安全是持续的过程，不是一次性的任务。定期审查代码，更新依赖，并保持对新威胁的警惕！

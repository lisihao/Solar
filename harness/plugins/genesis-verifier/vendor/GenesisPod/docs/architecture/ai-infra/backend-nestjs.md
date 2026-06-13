# NestJS 框架核心原理

## 概述

NestJS 是一个用于构建高效、可扩展的 Node.js 服务端应用的框架。它使用渐进式 JavaScript，完全支持 TypeScript，结合了 OOP、FP 和 FRP 的元素。

## 核心概念

### 1. 模块 (Modules)

模块是 NestJS 应用的基本组织单元：

```typescript
// resources.module.ts
import { Module } from "@nestjs/common";
import { ResourcesController } from "./resources.controller";
import { ResourcesService } from "./resources.service";

@Module({
  imports: [PrismaModule], // 导入其他模块
  controllers: [ResourcesController], // 控制器
  providers: [ResourcesService], // 服务提供者
  exports: [ResourcesService], // 导出供其他模块使用
})
export class ResourcesModule {}
```

**模块架构图：**

```
┌─────────────────────────────────────────────────┐
│                   AppModule                      │
├─────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────────┐│
│  │ AuthModule │  │ AIModule   │  │DataModule  ││
│  └────────────┘  └────────────┘  └────────────┘│
│  ┌────────────┐  ┌────────────┐  ┌────────────┐│
│  │ResourcesMod│  │ExploreModul│  │FeedModule  ││
│  └────────────┘  └────────────┘  └────────────┘│
└─────────────────────────────────────────────────┘
```

### 2. 控制器 (Controllers)

控制器负责处理传入的请求和返回响应：

```typescript
import { Controller, Get, Post, Body, Param, Query } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

@ApiTags("resources")
@Controller("resources")
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  @ApiOperation({ summary: "获取资源列表" })
  @ApiResponse({ status: 200, description: "成功返回资源列表" })
  async findAll(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 10,
  ) {
    return this.resourcesService.findAll({ page, limit });
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return this.resourcesService.findOne(id);
  }

  @Post()
  async create(@Body() createResourceDto: CreateResourceDto) {
    return this.resourcesService.create(createResourceDto);
  }
}
```

### 3. 服务 (Services/Providers)

服务包含业务逻辑，通过依赖注入使用：

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ResourcesService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: { page: number; limit: number }) {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.resource.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.resource.count(),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const resource = await this.prisma.resource.findUnique({
      where: { id },
    });

    if (!resource) {
      throw new NotFoundException(`Resource with ID ${id} not found`);
    }

    return resource;
  }
}
```

## 依赖注入 (Dependency Injection)

### 1. 基本原理

NestJS 使用 IoC 容器管理依赖：

```typescript
// 标记为可注入
@Injectable()
export class LoggerService {
  log(message: string) {
    console.log(`[LOG] ${message}`);
  }
}

// 注入到其他服务
@Injectable()
export class ResourcesService {
  constructor(
    private prisma: PrismaService,
    private logger: LoggerService,
  ) {}

  async create(data: CreateResourceDto) {
    this.logger.log(`Creating resource: ${data.title}`);
    return this.prisma.resource.create({ data });
  }
}
```

### 2. 自定义 Provider

```typescript
// 值 Provider
const configProvider = {
  provide: "CONFIG",
  useValue: {
    apiKey: process.env.API_KEY,
  },
};

// 工厂 Provider
const dbProvider = {
  provide: "DATABASE",
  useFactory: async (config: ConfigService) => {
    return await createConnection(config.get("DATABASE_URL"));
  },
  inject: [ConfigService],
};

// 类 Provider
const loggerProvider = {
  provide: LoggerService,
  useClass:
    process.env.NODE_ENV === "production"
      ? ProductionLogger
      : DevelopmentLogger,
};
```

### 3. 作用域

```typescript
// 默认：单例 (Singleton)
@Injectable()
export class SingletonService {}

// 请求作用域
@Injectable({ scope: Scope.REQUEST })
export class RequestScopedService {}

// 瞬态作用域
@Injectable({ scope: Scope.TRANSIENT })
export class TransientService {}
```

## 管道 (Pipes)

### 1. 内置管道

```typescript
import { ParseIntPipe, ParseUUIDPipe, DefaultValuePipe } from '@nestjs/common';

@Get(':id')
async findOne(@Param('id', ParseUUIDPipe) id: string) {
  return this.service.findOne(id);
}

@Get()
async findAll(
  @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
) {
  return this.service.findAll({ page });
}
```

### 2. 自定义验证管道

```typescript
import { PipeTransform, Injectable, BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    const object = plainToInstance(metatype, value);
    const errors = await validate(object);

    if (errors.length > 0) {
      throw new BadRequestException("Validation failed");
    }

    return value;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
```

### 3. DTO 验证

```typescript
import { IsString, IsOptional, IsUrl, MinLength } from "class-validator";
import { Transform } from "class-transformer";

export class CreateResourceDto {
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => value?.trim())
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUrl()
  url: string;
}
```

## 守卫 (Guards)

### 1. JWT 认证守卫

```typescript
import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      return false;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      request.user = payload;
    } catch {
      return false;
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
```

### 2. 角色守卫

```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}

// 使用
@Post()
@Roles('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
create(@Body() dto: CreateResourceDto) {
  return this.service.create(dto);
}
```

## 拦截器 (Interceptors)

### 1. 响应转换拦截器

```typescript
import { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { map, Observable } from "rxjs";

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

### 2. 日志拦截器

```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        console.log(`${method} ${url} ${Date.now() - now}ms`);
      }),
    );
  }
}
```

### 3. 缓存拦截器

```typescript
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(private cacheService: CacheService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const cacheKey = request.url;

    const cachedData = await this.cacheService.get(cacheKey);
    if (cachedData) {
      return of(cachedData);
    }

    return next
      .handle()
      .pipe(tap((data) => this.cacheService.set(cacheKey, data, 60)));
  }
}
```

## 异常过滤器 (Exception Filters)

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from "@nestjs/common";

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status = exception.getStatus();

    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: exception.message,
    });
  }
}

// 全局注册
app.useGlobalFilters(new HttpExceptionFilter());
```

## 中间件 (Middleware)

```typescript
import { Injectable, NestMiddleware } from "@nestjs/common";

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  }
}

// 在模块中注册
@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .exclude({ path: "health", method: RequestMethod.GET })
      .forRoutes("*");
  }
}
```

## 请求生命周期

```
┌─────────────────────────────────────────────────────────┐
│                    请求生命周期                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Incoming Request                                       │
│        │                                                │
│        ▼                                                │
│  ┌─────────────┐                                       │
│  │ Middleware  │  全局 → 模块 → 路由                   │
│  └─────────────┘                                       │
│        │                                                │
│        ▼                                                │
│  ┌─────────────┐                                       │
│  │   Guards    │  认证、授权检查                       │
│  └─────────────┘                                       │
│        │                                                │
│        ▼                                                │
│  ┌─────────────┐                                       │
│  │Interceptors │  前置逻辑 (Before)                    │
│  └─────────────┘                                       │
│        │                                                │
│        ▼                                                │
│  ┌─────────────┐                                       │
│  │   Pipes     │  参数转换、验证                       │
│  └─────────────┘                                       │
│        │                                                │
│        ▼                                                │
│  ┌─────────────┐                                       │
│  │ Controller  │  路由处理                             │
│  └─────────────┘                                       │
│        │                                                │
│        ▼                                                │
│  ┌─────────────┐                                       │
│  │  Service    │  业务逻辑                             │
│  └─────────────┘                                       │
│        │                                                │
│        ▼                                                │
│  ┌─────────────┐                                       │
│  │Interceptors │  后置逻辑 (After)                     │
│  └─────────────┘                                       │
│        │                                                │
│        ▼                                                │
│  ┌──────────────────┐                                  │
│  │Exception Filters │  错误处理 (如果有异常)            │
│  └──────────────────┘                                  │
│        │                                                │
│        ▼                                                │
│  Outgoing Response                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 参考资源

- [NestJS 官方文档](https://docs.nestjs.com/)
- [NestJS 中文文档](https://docs.nestjs.cn/)
- [TypeScript 装饰器](https://www.typescriptlang.org/docs/handbook/decorators.html)

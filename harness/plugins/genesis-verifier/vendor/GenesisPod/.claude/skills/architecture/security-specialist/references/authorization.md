# Authorization & RBAC

## Role-Based Access Control

```typescript
enum Role {
  ADMIN = "admin",
  MODERATOR = "moderator",
  USER = "user",
  GUEST = "guest",
}

enum Permission {
  // Resources
  RESOURCE_READ = "resource:read",
  RESOURCE_CREATE = "resource:create",
  RESOURCE_UPDATE = "resource:update",
  RESOURCE_DELETE = "resource:delete",

  // AI Features
  AI_CHAT = "ai:chat",
  AI_TEAMS = "ai:teams",
  AI_OFFICE = "ai:office",

  // Admin
  ADMIN_USERS = "admin:users",
  ADMIN_SETTINGS = "admin:settings",
}

// Role permissions mapping
const rolePermissions: Record<Role, Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),
  [Role.MODERATOR]: [
    Permission.RESOURCE_READ,
    Permission.RESOURCE_CREATE,
    Permission.RESOURCE_UPDATE,
    Permission.AI_CHAT,
    Permission.AI_TEAMS,
  ],
  [Role.USER]: [
    Permission.RESOURCE_READ,
    Permission.RESOURCE_CREATE,
    Permission.AI_CHAT,
  ],
  [Role.GUEST]: [Permission.RESOURCE_READ],
};
```

## Roles Guard Implementation

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
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
```

## Usage Examples

```typescript
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Get("users")
  @Roles(Role.ADMIN)
  getUsers() {
    return this.usersService.findAll();
  }
}
```

## Input Validation & Sanitization

```typescript
class CreateResourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) => sanitizeHtml(value))
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @Transform(({ value }) => sanitizeHtml(value))
  description?: string;

  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  url: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  tags: string[];
}

// Global validation pipe
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true, // Strip unknown properties
    forbidNonWhitelisted: true, // Throw on unknown properties
    transform: true, // Transform to DTO types
    transformOptions: {
      enableImplicitConversion: true,
    },
  }),
);
```

## Security Headers (Helmet)

```typescript
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.openai.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "same-origin" },
    frameguard: { action: "deny" },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    noSniff: true,
    xssFilter: true,
  }),
);

// CORS configuration
app.enableCors({
  origin: configService.get("CORS_ORIGINS").split(","),
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
});
```

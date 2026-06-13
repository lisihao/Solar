---
name: API Developer
description: |
  Design and implement RESTful APIs with NestJS for GenesisPod.
  Trigger keywords: api, rest, nestjs, controller, service, dto, endpoint
  Not for: Schema design (-> schema-architect), Security (-> security-specialist)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [api, nestjs, rest, backend]
boundaries:
  includes:
    - RESTful API design
    - NestJS controller/service patterns
    - DTO validation
    - Swagger documentation
  excludes:
    - Database schema design
    - Authentication/authorization design
  handoff:
    - skill: schema-architect
      when: Schema changes needed
    - skill: security-specialist
      when: Auth design needed
---

# API Developer

> NestJS API development for GenesisPod.

## Backend Architecture

```
backend/src/
├── modules/
│   ├── core/           # Auth, admin, storage
│   ├── content/        # Resources, collections
│   ├── ai/             # AI service integration
│   └── data-services/  # Crawlers, deduplication
├── shared/             # DTOs, guards, decorators
└── config/             # Database, swagger configs
```

## Service Pattern

```typescript
@Injectable()
export class ResourceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(options: PaginationDto): Promise<PaginatedResult<Resource>> {
    const [items, total] = await Promise.all([
      this.prisma.resource.findMany({
        skip: options.skip,
        take: options.take,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.resource.count(),
    ]);
    return { items, total, ...options };
  }
}
```

## Controller Pattern

```typescript
@Controller("resources")
@ApiTags("Resources")
export class ResourceController {
  constructor(private readonly service: ResourceService) {}

  @Get()
  @ApiOperation({ summary: "List all resources" })
  async findAll(@Query() query: PaginationDto) {
    return this.service.findAll(query);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async create(@Body() dto: CreateResourceDto, @User() user: UserEntity) {
    return this.service.create(dto, user.id);
  }
}
```

## DTO Validation

```typescript
export class CreateResourceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @ApiProperty({ example: "Article Title" })
  title: string;

  @IsUrl()
  @ApiProperty({ example: "https://example.com" })
  url: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
```

## RESTful Conventions

| Method | Endpoint                | Action   |
| ------ | ----------------------- | -------- |
| GET    | `/api/v1/resources`     | List all |
| GET    | `/api/v1/resources/:id` | Get one  |
| POST   | `/api/v1/resources`     | Create   |
| PATCH  | `/api/v1/resources/:id` | Update   |
| DELETE | `/api/v1/resources/:id` | Delete   |

## Response Format

```typescript
// Success
{ "data": {...}, "meta": { "timestamp": "..." } }

// Error
{ "statusCode": 400, "message": "Validation failed", "errors": [...] }

// Pagination
{ "items": [...], "total": 100, "page": 1, "pageSize": 20 }
```

## Responsibilities

1. Design clean, RESTful API endpoints
2. Implement proper input validation with DTOs
3. Add Swagger documentation for all endpoints
4. Handle errors consistently with proper status codes
5. Implement authentication guards where needed
6. Write unit tests for services and controllers
7. Optimize database queries for performance

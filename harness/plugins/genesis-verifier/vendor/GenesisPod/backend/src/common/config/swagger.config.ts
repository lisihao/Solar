import { INestApplication, Logger } from "@nestjs/common";
import { APP_CONFIG } from "./app.config";

/**
 * Swagger API 文档配置
 *
 * 使用方法:
 * 1. 安装依赖: npm install @nestjs/swagger swagger-ui-express
 * 2. 在 main.ts 中调用 setupSwagger(app)
 *
 * 访问地址: /api/docs
 */
export async function setupSwagger(app: INestApplication): Promise<void> {
  const logger = new Logger("Swagger");
  try {
    // 动态导入 Swagger 模块（如果未安装则跳过）
    const { DocumentBuilder, SwaggerModule } = await import("@nestjs/swagger");

    const config = new DocumentBuilder()
      .setTitle(`${APP_CONFIG.brand.fullName} API`)
      .setDescription(
        `
## ${APP_CONFIG.brand.fullName} - REST API

Enterprise AI deep research and content management platform.

### Authentication

**Internal API** (JWT): All internal endpoints require Bearer token:
\`\`\`
Authorization: Bearer <jwt_access_token>
\`\`\`

**Public API** (API Key): Public endpoints accept either header format:
\`\`\`
Authorization: Bearer <api_key>
X-API-Key: <api_key>
\`\`\`

### Public API Endpoints

The Public API (\`/api/v1/public/*\`) provides external access to AI capabilities:
- **Discovery**: \`/discovery/tools\`, \`/discovery/models\`, \`/discovery/capabilities\`
- **Research**: Deep multi-step research with planning and synthesis
- **Chat / Ask**: General chat and Q&A with configurable models
- **Debate**: Multi-agent structured debate
- **Writing**: Content improvement, summarization, proofreading
- **Analysis**: Multi-dimensional content analysis

### Success Response Envelope

All successful internal REST responses are wrapped by a transform interceptor:
\`\`\`json
{
  "success": true,
  "data": { "...": "endpoint-specific payload" },
  "metadata": {
    "requestId": "req_1717000000000_ab12cd3",
    "timestamp": "2026-05-30T12:00:00.000Z",
    "duration": 42
  }
}
\`\`\`
The actual endpoint payload is always under \`data\`. \`metadata.requestId\` is
echoed in the \`X-Request-Id\` response header. (Endpoints decorated to skip
transform — e.g. file/stream downloads — return their raw body instead.)

### Error Response Format

Errors are produced by the global exception filter with this exact shape:
\`\`\`json
{
  "statusCode": 400,
  "timestamp": "2026-05-30T12:00:00.000Z",
  "path": "/api/v1/public/research",
  "method": "POST",
  "message": "Error description",
  "code": "VALIDATION_ERROR",
  "requestId": "req_1717000000000_ab12cd3",
  "traceId": "trace-abc123"
}
\`\`\`
Field notes:
- \`statusCode\` — HTTP status (also the HTTP response status line).
- \`code\` — stable machine-readable error code (e.g. \`INTERNAL_ERROR\`,
  \`NOT_FOUND\`, \`DUPLICATE_ERROR\`, \`VALIDATION_ERROR\`); prefer this over
  matching on \`message\`.
- \`message\` — human-readable description.
- \`requestId\` / \`traceId\` — present when available; quote them in support requests.
- \`details\` — optional object with structured error context (present for
  some validation/database errors).
- \`stack\` — included only when the server runs in development mode.

Note: the **Public API** family (\`/api/v1/public/*\`) speaks two protocols with
their own JSON-RPC error envelopes — MCP (\`/mcp\`) and A2A (\`/a2a\`) return
\`{ "jsonrpc": "2.0", "id": ..., "error": { "code": <number>, "message": "..." } }\`
instead of the REST shape above. See \`backend/src/common/errors/protocol-error-codes.ts\`
for the cross-protocol error-code reference.
      `,
      )
      .setVersion("1.0.0")
      .setContact(
        APP_CONFIG.brand.fullName,
        `https://github.com/${APP_CONFIG.github.owner}/${APP_CONFIG.github.repo}`,
        APP_CONFIG.brand.contactEmail,
      )
      .setLicense("MIT", "https://opensource.org/licenses/MIT")
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          name: "Authorization",
          description: "JWT access token for internal API",
          in: "header",
        },
        "access-token",
      )
      .addApiKey(
        {
          type: "apiKey",
          name: "X-API-Key",
          in: "header",
          description: "MCP API Key for Public API endpoints",
        },
        "api-key",
      )
      .addTag(
        "Public API",
        "External-facing REST API for OpenClaw and integrations",
      )
      .addTag("auth", "User authentication")
      .addTag("ai-studio", "AI Studio deep research")
      .addTag("ai-office", "AI Office document generation")
      .addTag("ai-teams", "AI Teams collaboration")
      .addTag("ai-ask", "AI Ask Q&A assistant")
      .addTag("ai-image", "AI Image generation")
      .addTag("explore", "Resource discovery")
      .addTag("library", "Personal library")
      .addTag("notes", "Notes management")
      .addTag("webhooks", "Webhook subscriptions")
      .addTag("admin", "System administration")
      .build();

    const document = SwaggerModule.createDocument(app, config, {
      // 深度扫描所有模块
      deepScanRoutes: true,
    });

    SwaggerModule.setup("api/docs", app, document, {
      customSiteTitle: `${APP_CONFIG.brand.fullName} API Docs`,
      customfavIcon: "/favicon.ico",
      customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info { margin: 20px 0 }
        .swagger-ui .info .title { font-size: 28px }
      `,
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: "none",
        filter: true,
        showRequestDuration: true,
      },
    });

    // 添加 JSON 导出端点
    const httpAdapter = app.getHttpAdapter();
    httpAdapter.get(
      "/api/openapi.json",
      (_req: unknown, res: { json: (doc: object) => void }) => {
        res.json(document);
      },
    );

    logger.log("📚 Swagger API docs available at /api/docs");
    logger.log("📄 OpenAPI JSON available at /api/openapi.json");
  } catch {
    logger.log(
      "⚠️  Swagger not available (install: npm install @nestjs/swagger swagger-ui-express)",
    );
  }
}

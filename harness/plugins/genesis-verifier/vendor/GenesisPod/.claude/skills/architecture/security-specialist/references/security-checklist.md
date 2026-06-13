# Security Checklist

## OWASP Top 10 Mitigation

| Vulnerability            | Mitigation                                       |
| ------------------------ | ------------------------------------------------ |
| Injection                | Parameterized queries, input validation          |
| Broken Auth              | JWT with refresh tokens, secure password hashing |
| Sensitive Data Exposure  | HTTPS, encryption at rest, secure headers        |
| XXE                      | Disable external entities in XML parsers         |
| Broken Access Control    | RBAC, guards, ownership validation               |
| Security Misconfig       | Secure defaults, remove debug modes              |
| XSS                      | Input sanitization, CSP headers                  |
| Insecure Deserialization | Type validation, schema validation               |
| Known Vulnerabilities    | Regular dependency updates, audits               |
| Insufficient Logging     | Audit logs, error tracking                       |

## Audit Logging

```typescript
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    return next.handle().pipe(
      tap({
        next: (data) => {
          this.auditService.log({
            userId: user?.id,
            action: `${request.method} ${request.path}`,
            resource: context.getClass().name,
            ip: request.ip,
            userAgent: request.headers["user-agent"],
            status: "success",
            timestamp: new Date(),
          });
        },
        error: (error) => {
          this.auditService.log({
            userId: user?.id,
            action: `${request.method} ${request.path}`,
            resource: context.getClass().name,
            ip: request.ip,
            userAgent: request.headers["user-agent"],
            status: "error",
            error: error.message,
            timestamp: new Date(),
          });
        },
      }),
    );
  }
}
```

## SQL Injection Prevention

```typescript
// SAFE: Prisma parameterized queries
const user = await this.prisma.user.findFirst({
  where: { email: email },
});

// UNSAFE: Never do this
// const user = await this.prisma.$queryRaw`SELECT * FROM users WHERE email = '${email}'`;
```

## Security Review Checklist

### Authentication

- [ ] JWT tokens expire appropriately (1h access, 7d refresh)
- [ ] Refresh token rotation implemented
- [ ] Password change invalidates existing tokens
- [ ] Rate limiting on auth endpoints

### Authorization

- [ ] RBAC guards on protected routes
- [ ] Ownership validation for user resources
- [ ] No privilege escalation vulnerabilities

### Data Protection

- [ ] Input validation on all DTOs
- [ ] HTML sanitization for user content
- [ ] Parameterized database queries
- [ ] Sensitive data encrypted at rest

### Infrastructure

- [ ] HTTPS enforced
- [ ] Security headers configured (Helmet)
- [ ] CORS properly configured
- [ ] Rate limiting enabled

### Monitoring

- [ ] Audit logging for sensitive operations
- [ ] Error tracking without exposing internals
- [ ] Failed login attempt monitoring

## Responsibilities

1. Implement secure authentication flows
2. Design and enforce authorization policies
3. Configure rate limiting and throttling
4. Set up security headers and CORS
5. Validate and sanitize all inputs
6. Implement audit logging
7. Conduct security reviews and audits
8. Keep dependencies updated and secure

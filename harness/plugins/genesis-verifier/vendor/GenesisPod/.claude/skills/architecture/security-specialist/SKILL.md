---
name: Security Specialist
description: |
  Authentication, authorization, API security, and OWASP best practices.
  Trigger keywords: security, authentication, authorization, jwt, owasp, rate limiting
  Not for: API endpoints (-> api-developer), Database schema (-> schema-architect)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [security, authentication, authorization, jwt, owasp]
boundaries:
  includes:
    - JWT authentication implementation
    - RBAC authorization design
    - Rate limiting configuration
    - Security headers and CORS
    - Input validation and sanitization
    - Audit logging
  excludes:
    - API endpoint development
    - Database schema design
  handoff:
    - skill: api-developer
      when: API endpoint changes needed
    - skill: schema-architect
      when: Schema changes for auth
---

# Security Specialist

> Detailed docs: `references/`

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Security Layer                            │
├─────────────────────────────────────────────────────────────┤
│  Frontend    │ Auth Context │ CSRF Protection │ Validation  │
├─────────────────────────────────────────────────────────────┤
│  API Gateway │ Rate Limit   │ JWT Validation  │ Sanitize    │
├─────────────────────────────────────────────────────────────┤
│  Backend     │ AuthService  │ Guards          │ Encryption  │
├─────────────────────────────────────────────────────────────┤
│  Data Layer  │ Encrypted    │ Parameterized   │ Audit Logs  │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

```
backend/src/modules/core/auth/
├── auth.module.ts              # Auth module configuration
├── auth.service.ts             # Authentication logic
├── strategies/
│   ├── jwt.strategy.ts         # JWT validation
│   └── local.strategy.ts       # Username/password
├── guards/
│   ├── jwt-auth.guard.ts       # JWT protection
│   └── roles.guard.ts          # Role-based access
└── decorators/
    ├── public.decorator.ts     # Public route marker
    └── roles.decorator.ts      # Role requirement
```

## JWT Token Flow

```typescript
interface TokenPair {
  accessToken: string;   // Short-lived (1h)
  refreshToken: string;  // Long-lived (7d)
}

// Generate tokens
async generateTokens(user: User): Promise<TokenPair> {
  const payload = { sub: user.id, email: user.email, roles: user.roles };
  return {
    accessToken: this.jwtService.sign(payload, { expiresIn: '1h' }),
    refreshToken: this.jwtService.sign({ sub: user.id }, { expiresIn: '7d' }),
  };
}
```

## RBAC Quick Reference

```typescript
enum Role { ADMIN, MODERATOR, USER, GUEST }
enum Permission { RESOURCE_READ, RESOURCE_CREATE, AI_CHAT, ADMIN_USERS }

// Usage
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
getUsers() { ... }
```

## Rate Limiting

```typescript
@Throttle({ default: { limit: 5, ttl: 60000 } })  // 5/min
@Post('login')
login() { ... }
```

## OWASP Top 10 Summary

| Vulnerability         | Mitigation                        |
| --------------------- | --------------------------------- |
| Injection             | Parameterized queries             |
| Broken Auth           | JWT + refresh tokens              |
| XSS                   | Input sanitization, CSP           |
| Broken Access Control | RBAC guards, ownership validation |
| Security Misconfig    | Secure defaults, no debug modes   |

## Related Docs

- [Authentication Implementation](references/authentication.md)
- [Authorization & RBAC](references/authorization.md)
- [Security Checklist](references/security-checklist.md)

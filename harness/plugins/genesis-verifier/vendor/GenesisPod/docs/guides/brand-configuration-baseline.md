# Brand Configuration Baseline

> Centralized brand management system. All brand references use config objects; deploy-time switching via environment variables.

## Configuration Files

| Layer         | File                                              | Import                                                          |
| ------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| Frontend      | `frontend/lib/utils/config.ts`                    | `import { config } from '@/lib/utils/config'`                   |
| Backend       | `backend/src/common/config/app.config.ts`         | `import { APP_CONFIG } from "path/to/common/config/app.config"` |
| Frontend Logo | `frontend/components/brand/BrandLogo.tsx`         | `import { BrandLogo } from '@/components/brand/BrandLogo'`      |
| Backend Logo  | `backend/src/common/config/brand-logo.service.ts` | NestJS injectable `BrandLogoService`                            |

## Environment Variables

### Backend (`BRAND_*`)

| Variable              | Default                          | Description           |
| --------------------- | -------------------------------- | --------------------- |
| `BRAND_NAME`          | `GenesisPod`                     | Short brand name      |
| `BRAND_FULL_NAME`     | `GenesisPod`                     | Full brand name       |
| `BRAND_SUBTITLE`      | `AI ENGINE`                      | Logo subtitle text    |
| `RAILWAY_DOMAIN`      | `genesis-ai`                     | Railway domain prefix |
| `BRAND_EMAIL_FROM`    | `GenesisPod <noreply@gens.team>` | Email sender          |
| `BRAND_CONTACT_EMAIL` | `hello@gens.team`                | Contact email         |
| `BRAND_LOGO_SVG_PATH` | `brand/logo.svg`                 | Logo file path        |

### Frontend (`NEXT_PUBLIC_BRAND_*`)

| Variable                      | Default                        | Description           |
| ----------------------------- | ------------------------------ | --------------------- |
| `NEXT_PUBLIC_BRAND_NAME`      | `GenesisPod`                   | Short brand name      |
| `NEXT_PUBLIC_BRAND_FULL_NAME` | `GenesisPod`                   | Full brand name       |
| `NEXT_PUBLIC_BRAND_SUBTITLE`  | `AI ENGINE`                    | Logo subtitle         |
| `NEXT_PUBLIC_BRAND_TAGLINE`   | `AI-Powered Research Platform` | Page title tagline    |
| `NEXT_PUBLIC_RAILWAY_DOMAIN`  | `genesis-ai`                   | Railway domain prefix |
| `NEXT_PUBLIC_BRAND_LOGO_PATH` | `/favicon.svg`                 | Favicon/logo path     |

## Usage

### Frontend

```tsx
import { config } from '@/lib/utils/config';
import { BrandLogo } from '@/components/brand/BrandLogo';

// Text references
<title>{config.brand.fullName}</title>
<span>{config.brand.name}</span>

// Logo component
<BrandLogo variant="full" />   // icon + text
<BrandLogo variant="icon" />   // icon only
```

### Backend

```typescript
import { APP_CONFIG } from "../common/config/app.config";

// Text references
const title = APP_CONFIG.brand.fullName;
const userAgent = APP_CONFIG.brand.userAgent;

// Logo (in injectable services)
constructor(private readonly brandLogoService: BrandLogoService) {}
const svg = this.brandLogoService.getLogoSvg();
```

## Category C: Never Change

These contain storage keys, encryption salts, or bucket names. Changing them causes data loss.

| Key                                        | File                     | Reason              |
| ------------------------------------------ | ------------------------ | ------------------- |
| `deepdive-theme-storage`                   | themeStore.ts            | localStorage key    |
| `deepdive_auth_tokens` / `deepdive_user`   | auth.ts                  | Auth tokens         |
| `deepdive-locale`                          | i18n-context.tsx         | Language preference |
| `deepdive-secrets-salt-v1`                 | secrets.service.ts       | Encryption salt     |
| `deepdive-dev-only-key`                    | user-api-keys.service.ts | Dev encryption key  |
| `deepdive-default-encryption-key!`         | settings.service.ts      | Settings encryption |
| `deepdive-secret-key-change-in-production` | auth.module.ts           | JWT default         |
| `deepdive-images`                          | r2-storage.service.ts    | R2 bucket name      |
| `deepdive-admin-cleanup-2024`              | generation.controller.ts | Admin key           |
| `deepdive-dev-session-key`                 | session-crypto.ts        | Session encryption  |

---

Last updated: 2026-02-16

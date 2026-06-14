# EdgeOne Pages Deployment Guide

## Overview

[Tencent EdgeOne Pages](https://pages.edgeone.ai/) is an edge-native full-stack development platform that supports deploying Next.js applications with SSR, ISR, SSG, and CSR rendering modes.

## Prerequisites

- EdgeOne account: https://edgeone.ai/
- Node.js 18+
- npm or pnpm

## Project Structure

```
genesis/
├── frontend/          # Next.js 14 App Router
│   ├── edgeone.json   # EdgeOne routing config
│   └── next.config.mjs
├── backend/           # NestJS API (separate deployment)
└── infra/
    └── edgeone/       # EdgeOne configs
```

## Frontend Deployment

### 1. Connect Repository

1. Go to [EdgeOne Pages Console](https://console.cloud.tencent.com/edgeone/pages)
2. Click "Create Project" → "Import Git Repository"
3. Select your GitHub/GitLab repository
4. Configure build settings:
   - **Root Directory**: `frontend`
   - **Framework**: Next.js
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`

### 2. Environment Variables

Configure in EdgeOne Console → Project Settings → Environment Variables:

```bash
# Required
NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.com

# Optional
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
NEXT_PUBLIC_SENTRY_DSN=https://...
NODE_ENV=production
```

### 3. Custom Domain

1. Go to Project Settings → Domains
2. Add custom domain (e.g., `app.gens.team`)
3. Configure DNS CNAME record pointing to EdgeOne

### 4. Routing Configuration

EdgeOne uses `edgeone.json` for routing instead of Next.js rewrites:

```json
{
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "https://api.gens.team/api/$1",
      "headers": {
        "X-Forwarded-Host": "$host"
      }
    }
  ]
}
```

## Backend Deployment

EdgeOne Pages is optimized for frontend/static sites. For the NestJS backend, use:

1. **Railway** (recommended): See `infra/railway/`
2. **Docker + Cloud Run**: Use existing Dockerfile
3. **EdgeOne Cloud Functions**: For simple APIs only

### Option: EdgeOne Cloud Functions (Simple APIs)

Create `node-functions/api/health.js`:

```javascript
export default async function handler(req, res) {
  res.status(200).json({ status: "ok", timestamp: Date.now() });
}
```

## Build Configuration

### next.config.mjs adjustments for EdgeOne

```javascript
const nextConfig = {
  // For SSR/ISR (default)
  output: undefined,

  // For static export only
  // output: 'export',
  // images: { unoptimized: true },

  // EdgeOne handles these via edgeone.json
  async rewrites() {
    return [];
  },
  async redirects() {
    return [];
  },
};
```

## Deployment Commands

### Via EdgeOne CLI (eo)

```bash
# Install CLI
npm install -g @edgeone/cli

# Login
eo login

# Deploy
cd frontend
eo deploy

# Preview deployment
eo deploy --preview
```

### Via Git (Automatic)

Push to connected branch triggers automatic deployment:

```bash
git push origin main    # Production
git push origin develop # Preview
```

## Supported Features

| Feature                               | Status                  |
| ------------------------------------- | ----------------------- |
| SSR (Server-Side Rendering)           | Supported               |
| ISR (Incremental Static Regeneration) | Supported               |
| SSG (Static Site Generation)          | Supported               |
| CSR (Client-Side Rendering)           | Supported               |
| App Router                            | Supported (Recommended) |
| Pages Router                          | Supported (Legacy)      |
| API Routes                            | Supported               |
| Middleware                            | Supported               |
| Image Optimization                    | Supported               |
| Edge Functions                        | Supported               |
| Cloud Functions (Node.js)             | Supported               |

## Limitations

1. **Rewrites/Redirects**: Use `edgeone.json` instead of `next.config.js`
2. **Node.js Version**: 18.x or 20.x
3. **Build Timeout**: 30 minutes max
4. **Function Size**: 50MB max per function

## Monitoring

1. **Build Logs**: EdgeOne Console → Deployments
2. **Runtime Logs**: EdgeOne Console → Logs
3. **Analytics**: EdgeOne Console → Analytics

## Troubleshooting

### Build Fails

```bash
# Check Node.js version
node --version  # Should be 18.x or 20.x

# Clean build
rm -rf .next node_modules
npm install
npm run build
```

### SSR Not Working

Ensure `output` is not set to `'export'` in next.config.mjs.

### API Routes 404

Check that API routes are in `app/api/` (App Router) or `pages/api/` (Pages Router).

## References

- [EdgeOne Pages Docs](https://pages.edgeone.ai/document)
- [Next.js on EdgeOne](https://pages.edgeone.ai/document/framework-nextjs)
- [EdgeOne Console](https://console.cloud.tencent.com/edgeone/pages)

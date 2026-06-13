#!/bin/bash
# Open Prisma Studio against the Railway Postgres public proxy.
#
# Reads connection string from backend/.env.railway (gitignored). To
# create that file, copy infra/railway/envs/backend.env.railway.example
# and fill the proxy host / password from the Railway "Variables" panel.

set -e

PROJECT_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
ENV_FILE="$PROJECT_ROOT/backend/.env.railway"

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE not found." >&2
  echo "Copy infra/railway/envs/backend.env.railway.example to that path and fill in the values." >&2
  exit 1
fi

cd "$PROJECT_ROOT/backend"
exec npx dotenv -e "$ENV_FILE" -- prisma studio

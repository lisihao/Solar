#!/bin/bash
# Open a psql shell against the Railway Postgres public proxy.
#
# Same prerequisites as studio.sh — backend/.env.railway must exist and
# contain DATABASE_URL pointing at the public proxy (proxy.rlwy.net etc).
#
# Usage:
#   ./infra/railway/scripts/db-shell.sh
#
# Pass extra psql flags after --, e.g.:
#   ./infra/railway/scripts/db-shell.sh -- -c "SELECT count(*) FROM users;"

set -e

if ! command -v psql &> /dev/null; then
  echo "psql not found. Install postgresql-client or use prisma studio instead." >&2
  exit 1
fi

PROJECT_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
ENV_FILE="$PROJECT_ROOT/backend/.env.railway"

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE not found." >&2
  echo "Copy infra/railway/envs/backend.env.railway.example to that path and fill in the values." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

exec psql "$DATABASE_URL" "$@"

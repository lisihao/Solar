#!/bin/bash
# Railway Deployment Script for GenesisPod

set -e

echo "=========================================="
echo "  GenesisPod - Railway Deployment"
echo "=========================================="

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "Installing Railway CLI..."
    npm install -g @railway/cli
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo "Please login to Railway first:"
    railway login
fi

PROJECT_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)

echo ""
echo "Step 1: Creating Railway project..."
echo "--------------------------------------"
cd "$PROJECT_ROOT"

# Initialize project if not exists
if [ ! -f ".railway/config.json" ]; then
    railway init --name "genesis-ai"
fi

echo ""
echo "Step 2: Adding PostgreSQL database..."
echo "--------------------------------------"
echo "Please add PostgreSQL in Railway Dashboard:"
echo "  1. Open: railway open"
echo "  2. Click 'New' -> 'Database' -> 'Add PostgreSQL'"
echo ""
read -p "Press Enter when PostgreSQL is added..."

echo ""
echo "Step 3: Adding Redis cache..."
echo "--------------------------------------"
echo "Please add Redis in Railway Dashboard:"
echo "  1. Click 'New' -> 'Database' -> 'Add Redis'"
echo ""
read -p "Press Enter when Redis is added..."

echo ""
echo "Step 4: Deploying Backend..."
echo "--------------------------------------"
cd "$PROJECT_ROOT/backend"
railway link
railway up --detach

echo ""
echo "Step 5: Deploying Frontend..."
echo "--------------------------------------"
cd "$PROJECT_ROOT/frontend"
railway link
railway up --detach

echo ""
echo "=========================================="
echo "  Deployment initiated!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Open Railway Dashboard: railway open"
echo "  2. Configure environment variables for each service"
echo "  3. Wait for deployments to complete"
echo "  4. Get your public URLs from the Dashboard"
echo ""

# Prisma Studio - Railway Remote Database Connection
# Usage: .\scripts\studio-railway.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Prisma Studio - Railway Database" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if .env.railway exists
$envFile = Join-Path $PSScriptRoot "../.env.railway"
if (-not (Test-Path $envFile)) {
    Write-Host "[ERROR] .env.railway file not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please configure .env.railway file:" -ForegroundColor Yellow
    Write-Host "1. Open backend/.env.railway"
    Write-Host "2. Replace DATABASE_URL with your Railway database URL"
    Write-Host ""
    Write-Host "Get Railway DATABASE_URL from:" -ForegroundColor Yellow
    Write-Host "  Railway Dashboard -> PostgreSQL -> Variables -> DATABASE_URL"
    exit 1
}

# Read DATABASE_URL from .env.railway
$content = Get-Content $envFile -Raw
if ($content -match 'DATABASE_URL="([^"]+)"') {
    $dbUrl = $matches[1]

    # Check if it's still placeholder value
    if ($dbUrl -match "YOUR_PASSWORD|YOUR_HOST") {
        Write-Host "[ERROR] Please configure actual database URL" -ForegroundColor Red
        Write-Host ""
        Write-Host "Edit backend/.env.railway and replace DATABASE_URL with your actual value" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "[OK] Database config loaded" -ForegroundColor Green

    # Show connection info (hide password)
    if ($dbUrl -match "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)") {
        $user = $matches[1]
        $host = $matches[3]
        $port = $matches[4]
        $database = $matches[5]
        Write-Host ""
        Write-Host "Connection Info:" -ForegroundColor Cyan
        Write-Host "  Host:     $host"
        Write-Host "  Port:     $port"
        Write-Host "  Database: $database"
        Write-Host "  User:     $user"
        Write-Host ""
    }

    # Set env and start Prisma Studio
    Write-Host "Starting Prisma Studio..." -ForegroundColor Green
    Write-Host "(Browser will open http://localhost:5555)" -ForegroundColor Gray
    Write-Host ""

    $env:DATABASE_URL = $dbUrl
    Set-Location (Join-Path $PSScriptRoot "..")
    npx prisma studio
} else {
    Write-Host "[ERROR] Invalid .env.railway format" -ForegroundColor Red
    exit 1
}

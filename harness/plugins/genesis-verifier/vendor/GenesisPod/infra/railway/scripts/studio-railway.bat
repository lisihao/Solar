@echo off
echo ========================================
echo   Prisma Studio - Railway 远程数据库
echo ========================================
echo.

REM 检查 .env.railway 文件是否存在
if not exist "%~dp0..\.env.railway" (
    echo [错误] 未找到 .env.railway 文件
    echo.
    echo 请先配置 .env.railway 文件:
    echo 1. 打开 backend\.env.railway
    echo 2. 将 DATABASE_URL 替换为你的 Railway 数据库 URL
    echo.
    echo Railway 数据库 URL 获取方式:
    echo   Railway Dashboard -^> PostgreSQL -^> Variables -^> DATABASE_URL
    pause
    exit /b 1
)

REM 读取 DATABASE_URL
for /f "tokens=2 delims==" %%a in ('findstr /i "DATABASE_URL" "%~dp0..\.env.railway"') do (
    set "DB_URL=%%a"
)

REM 去除引号
set DB_URL=%DB_URL:"=%

REM 检查是否还是示例值
echo %DB_URL% | findstr /i "YOUR_PASSWORD YOUR_HOST" >nul
if %errorlevel%==0 (
    echo [错误] 请先配置实际的数据库 URL
    echo.
    echo 编辑 backend\.env.railway 文件，将 DATABASE_URL 替换为你的实际值
    pause
    exit /b 1
)

echo [OK] 已加载数据库配置
echo.
echo 正在启动 Prisma Studio...
echo (浏览器将自动打开 http://localhost:5555)
echo.

REM 设置环境变量并启动 Prisma Studio
set DATABASE_URL=%DB_URL%
cd /d "%~dp0.."
npx prisma studio

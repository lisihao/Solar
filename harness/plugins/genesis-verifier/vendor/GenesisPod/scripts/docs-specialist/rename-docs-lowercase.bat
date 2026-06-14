@echo off
REM 文档文件批量重命名脚本 (Windows版本)
REM 用途：将不符合命名规范的文档文件重命名为小写
REM 依据：project-rules.md v2.1 文件命名规范
REM 使用：scripts\rename-docs-lowercase.bat [--dry-run]

setlocal enabledelayedexpansion

set DRY_RUN=0
if "%1"=="--dry-run" (
  set DRY_RUN=1
  echo [33m模拟运行模式（不会实际修改文件）[0m
) else (
  echo [33m警告：将真实执行文件重命名！[0m
  echo 如需模拟运行，请使用: %0 --dry-run
  echo.
  set /p CONFIRM="确认继续？(y/N) "
  if /i not "!CONFIRM!"=="y" (
    echo 已取消
    exit /b 0
  )
)

echo.
echo ========================================
echo   文档文件命名规范修复脚本
echo ========================================
echo.

set TOTAL_FILES=0
set RENAMED_FILES=0
set SKIPPED_FILES=0

REM 定义重命名函数
goto :main

:rename_file
set "old_path=%~1"
set "new_path=%~2"
set /a TOTAL_FILES+=1

if "%old_path%"=="%new_path%" (
  echo [32m✓[0m 已符合规范: %old_path%
  set /a SKIPPED_FILES+=1
  goto :eof
)

echo [33m重命名:[0m
echo   From: [31m%old_path%[0m
echo   To:   [32m%new_path%[0m

if %DRY_RUN%==0 (
  if exist "%old_path%" (
    REM 确保目标目录存在
    for %%i in ("%new_path%") do set "new_dir=%%~dpi"
    if not exist "!new_dir!" mkdir "!new_dir!"

    REM 执行重命名
    git mv "%old_path%" "%new_path%" 2>nul || move "%old_path%" "%new_path%" >nul
    set /a RENAMED_FILES+=1
  ) else (
    echo [31m警告: 文件不存在 %old_path%[0m
  )
) else (
  set /a RENAMED_FILES+=1
)
goto :eof

:main

echo [34m阶段1: data-management/ 目录[0m
echo ----------------------------

call :rename_file "docs\data-management\README.md" "docs\data-management\readme.md"
call :rename_file "docs\data-management\ARCHITECTURE.md" "docs\data-management\architecture.md"
call :rename_file "docs\data-management\DATA-MODEL.md" "docs\data-management\data-model.md"
call :rename_file "docs\data-management\IMPLEMENTATION-ROADMAP.md" "docs\data-management\implementation-roadmap.md"
call :rename_file "docs\data-management\POLICY-CATEGORY-SETUP.md" "docs\data-management\policy-category-setup.md"
call :rename_file "docs\data-management\RUN-ERROR-FIX.md" "docs\data-management\run-error-fix.md"
call :rename_file "docs\data-management\UI-REDESIGN-SUMMARY.md" "docs\data-management\ui-redesign-summary.md"
call :rename_file "docs\data-management\UI-FIXES-SUMMARY.md" "docs\data-management\ui-fixes-summary.md"
call :rename_file "docs\data-management\COMPLETION-SUMMARY.md" "docs\data-management\completion-summary.md"
call :rename_file "docs\data-management\DATA-MANAGEMENT-VALIDATION.md" "docs\data-management\data-management-validation.md"
call :rename_file "docs\data-management\DATA-MANAGEMENT-QUICK-GUIDE.md" "docs\data-management\data-management-quick-guide.md"
call :rename_file "docs\data-management\DATA-MANAGEMENT-IMPLEMENTATION.md" "docs\data-management\data-management-implementation.md"
call :rename_file "docs\data-management\UI-REDESIGN-REPORT.md" "docs\data-management\ui-redesign-report.md"

echo.
echo [34m阶段2: features/ai-office/ 目录[0m
echo ----------------------------

call :rename_file "docs\features\ai-office\README_OPTIMIZATION.md" "docs\features\ai-office\readme-optimization.md"
call :rename_file "docs\features\ai-office\SERVICE_STATUS.md" "docs\features\ai-office\service-status.md"
call :rename_file "docs\features\ai-office\OPTIMIZATION_REPORT.md" "docs\features\ai-office\optimization-report.md"
call :rename_file "docs\features\ai-office\IMPLEMENTATION_GUIDE.md" "docs\features\ai-office\implementation-guide.md"
call :rename_file "docs\features\ai-office\GENSPARK_QUICK_START.md" "docs\features\ai-office\genspark-quick-start.md"
call :rename_file "docs\features\ai-office\GENSPARK_ANALYSIS.md" "docs\features\ai-office\genspark-analysis.md"
call :rename_file "docs\features\ai-office\EXECUTIVE_SUMMARY.md" "docs\features\ai-office\executive-summary.md"

echo.
echo [34m阶段3: api/ 目录[0m
echo ----------------------------

call :rename_file "docs\api\DATA-COLLECTION-API.md" "docs\api\data-collection-api.md"

echo.
echo [34m阶段4: docs/ 根目录[0m
echo ----------------------------

call :rename_file "docs\BLOG_COLLECTION_SYSTEM.md" "docs\blog-collection-system.md"
call :rename_file "docs\RAILWAY_ENV_CONFIG.md" "docs\railway-env-config.md"
call :rename_file "docs\GOOGLE_OAUTH_SETUP.md" "docs\google-oauth-setup.md"
call :rename_file "docs\UX_USABILITY_AUDIT.md" "docs\ux-usability-audit.md"
call :rename_file "docs\UI_OPTIMIZATION_PLAN.md" "docs\ui-optimization-plan.md"
call :rename_file "docs\BACKEND_TEST_ISSUES.md" "docs\backend-test-issues.md"
call :rename_file "docs\TESTING_ISSUES.md" "docs\testing-issues.md"
call :rename_file "docs\HARDENING_SUMMARY.md" "docs\hardening-summary.md"
call :rename_file "docs\OPTIMIZATION_PLAN.md" "docs\optimization-plan.md"
call :rename_file "docs\HARDENING_EXECUTION.md" "docs\hardening-execution.md"
call :rename_file "docs\DEPLOYMENT_GUIDE.md" "docs\deployment-guide.md"

echo.
echo [34m阶段5: prd/ 目录[0m
echo ----------------------------

if exist "docs\prd\prd-数据采集.md" (
  call :rename_file "docs\prd\prd-数据采集.md" "docs\prd\prd-data-collection-zh.md"
)

echo.
echo ========================================
echo [32m✅ 重命名完成！[0m
echo ========================================
echo.
echo 统计信息：
echo   总文件数: %TOTAL_FILES%
echo   已重命名: %RENAMED_FILES%
echo   已符合规范: %SKIPPED_FILES%
echo.

if %DRY_RUN%==0 (
  echo [33m下一步操作：[0m
  echo 1. 检查重命名结果是否正确
  echo 2. 手动更新文档中的引用链接（或运行 update-doc-links.sh）
  echo 3. 提交更改：
  echo    git add -A
  echo    git commit -m "refactor(docs): rename files to lowercase per v2.1 standard"
) else (
  echo [33m这是模拟运行，没有实际修改文件[0m
  echo 如需真实执行，运行: %0
)

pause

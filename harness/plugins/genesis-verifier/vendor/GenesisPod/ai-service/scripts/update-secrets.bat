@echo off
chcp 65001 >nul
REM 更新 GCP Secret Manager 中的 API 密钥 (Windows 版本)

set PROJECT_ID=deepdive-engine

echo ===================================
echo 更新 GCP Secret Manager API 密钥
echo ===================================
echo.

REM 更新 OpenAI API Key
set /p OPENAI_KEY="请输入你的 OpenAI API Key (从 https://platform.openai.com/api-keys 获取): "

if "%OPENAI_KEY%"=="" (
    echo ❌ OpenAI API Key 不能为空
    exit /b 1
)

echo 正在更新 openai-api-key...
echo %OPENAI_KEY%| gcloud secrets versions add openai-api-key --data-file=- --project=%PROJECT_ID%

if %ERRORLEVEL% EQU 0 (
    echo ✅ openai-api-key 更新成功
) else (
    echo ❌ openai-api-key 更新失败
    exit /b 1
)

echo.
echo ===================================
echo 验证更新
echo ===================================

REM 验证密钥
echo Grok API Key:
gcloud secrets versions access latest --secret="grok-api-key" --project=%PROJECT_ID% 2>nul | findstr /C:"xai-"
echo.

echo OpenAI API Key:
gcloud secrets versions access latest --secret="openai-api-key" --project=%PROJECT_ID% 2>nul | findstr /C:"sk-"
echo.

echo ✅ 所有密钥已更新！请重启 AI 服务。
pause

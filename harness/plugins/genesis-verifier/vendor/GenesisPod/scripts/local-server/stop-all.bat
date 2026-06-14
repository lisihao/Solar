@echo off
chcp 65001 >nul
echo ========================================
echo Stopping all DeepDive services...
echo ========================================

echo.
echo [1/4] Checking for processes on port 3000 (Frontend alternative)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Found process %%a on port 3000, killing...
    taskkill /F /PID %%a >nul 2>&1
)

echo [2/4] Checking for processes on port 3001 (Frontend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
    echo Found process %%a on port 3001, killing...
    taskkill /F /PID %%a >nul 2>&1
)

echo [3/4] Checking for processes on port 4000 (Backend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do (
    echo Found process %%a on port 4000, killing...
    taskkill /F /PID %%a >nul 2>&1
)

echo [4/4] Checking for processes on port 5000/5001 (AI Service)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo Found process %%a on port 5000, killing...
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5001" ^| findstr "LISTENING"') do (
    echo Found process %%a on port 5001, killing...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Waiting for ports to be released...
timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo All services stopped successfully!
echo ========================================

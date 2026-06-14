@echo off
chcp 65001 >nul
echo ========================================
echo Starting all DeepDive services...
echo ========================================

echo.
echo Step 1: Stopping any running services...
call "%~dp0stop-all.bat"

echo.
echo ========================================
echo Step 2: Starting services...
echo ========================================

echo.
echo [1/4] Starting Frontend (port 3000)...
cd /d "%~dp0..\frontend"
start "DeepDive Frontend" cmd /k "npm run dev"

echo Waiting for frontend to initialize...
timeout /t 3 /nobreak >nul

echo.
echo [2/4] Starting Backend (port 4000)...
cd /d "%~dp0..\backend"
start "DeepDive Backend" cmd /k "npm run dev"

echo Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

echo.
echo [3/4] Starting AI Service (port 5000)...
cd /d "%~dp0..\ai-service"
start "DeepDive AI Service" cmd /k "python -m uvicorn main:app --host 127.0.0.1 --port 5000 --reload"

echo Waiting for AI service to initialize...
timeout /t 5 /nobreak >nul

echo.
echo [4/4] Verifying services...
echo.
echo Checking ports:
netstat -ano | findstr ":3000.*LISTENING" && echo   Frontend: http://localhost:3000 || echo   Frontend: FAILED
netstat -ano | findstr ":4000.*LISTENING" && echo   Backend:  http://localhost:4000 || echo   Backend:  FAILED
netstat -ano | findstr ":5000.*LISTENING" && echo   AI Service: http://localhost:5000 || echo   AI Service: FAILED

echo.
echo ========================================
echo Services started!
echo ========================================
echo.
echo URLs:
echo   Frontend:   http://localhost:3000
echo   Backend:    http://localhost:4000/api/v1
echo   AI Service: http://localhost:5000/docs
echo.
echo Press any key to close this window...
pause >nul

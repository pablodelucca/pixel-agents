@echo off
echo ========================================
echo   Pixel Agents Remote Monitor
echo ========================================
echo.

REM Check if node is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

REM Kill any existing process on port 3000
echo [1/3] Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM Start the remote server
echo [2/3] Starting WebSocket server on port 3000...
cd /d "%~dp0remote-server"
start "Pixel Agents Server" cmd /c "npx tsx server.ts"
cd /d "%~dp0"

REM Wait for server to start
echo     Waiting for server...
timeout /t 3 /nobreak >nul

REM Start the webview dev server
echo [3/3] Starting webview on port 5175...
cd /d "%~dp0webview-ui"
start "Pixel Agents Webview" cmd /c "npm run dev"
cd /d "%~dp0"

REM Wait for webview to start
echo     Waiting for webview...
timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo   Servers started!
echo ========================================
echo.
echo   WebSocket Server: ws://localhost:3000
echo   Webview URL:      http://localhost:5175?remote
echo.
echo   Open the webview URL in your browser to view agents.
echo.
echo   Press any key to open browser...
pause >nul

REM Open browser
start http://localhost:5175?remote

echo.
echo   Browser opened. Close this window when done.
echo   (Servers will continue running in their own windows)
echo.
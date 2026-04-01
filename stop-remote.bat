@echo off
echo ========================================
echo   Stopping Pixel Agents Servers
echo ========================================
echo.

REM Kill process on port 3000 (WebSocket server)
echo [1/2] Stopping WebSocket server (port 3000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo     Killed PID %%a
)

REM Kill process on port 5175 (Webview dev server)
echo [2/2] Stopping Webview server (port 5175)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5175" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo     Killed PID %%a
)

echo.
echo ========================================
echo   All servers stopped.
echo ========================================
echo.
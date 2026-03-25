@echo off
REM Mock 'claude' executable for Pixel Agents e2e tests (Windows).
REM
REM Behaviour:
REM   1. Parses --session-id <id> from args.
REM   2. Appends an invocation record to %HOME%\.claude-mock\invocations.log.
REM   3. Creates the expected JSONL file under %HOME%\.claude\projects\<hash>\<id>.jsonl
REM   4. Stays alive for up to 30 s (tests can kill it once assertions pass).

setlocal enabledelayedexpansion

set "SESSION_ID="
set "PREV="

:parse_args
if "%~1"=="" goto done_args
if "!PREV!"=="--session-id" set "SESSION_ID=%~1"
set "PREV=%~1"
shift
goto parse_args
:done_args

REM Use HOME if set (our e2e sets it), fall back to USERPROFILE
if defined HOME (
  set "MOCK_HOME=%HOME%"
) else (
  set "MOCK_HOME=%USERPROFILE%"
)

set "LOG_DIR=%MOCK_HOME%\.claude-mock"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
echo %DATE% %TIME% session-id=%SESSION_ID% cwd=%CD% args=%* >> "%LOG_DIR%\invocations.log"

if "%SESSION_ID%"=="" goto stay_alive

REM Replicate agentManager.ts: workspacePath.replace(/[^a-zA-Z0-9-]/g, '-')
REM PowerShell one-liner to do the regex replace
for /f "delims=" %%D in ('powershell -NoProfile -Command "[regex]::Replace('%CD%', '[^a-zA-Z0-9-]', '-')"') do set "DIR_NAME=%%D"

set "PROJECT_DIR=%MOCK_HOME%\.claude\projects\%DIR_NAME%"
if not exist "%PROJECT_DIR%" mkdir "%PROJECT_DIR%"

set "JSONL_FILE=%PROJECT_DIR%\%SESSION_ID%.jsonl"
echo {"type":"system","subtype":"init","content":"mock-claude-ready"} >> "%JSONL_FILE%"

:stay_alive
REM Stay alive so the VS Code terminal doesn't immediately close.
REM Use ping to localhost as a cross-platform sleep (timeout command requires console).
ping -n 31 127.0.0.1 > nul 2>&1

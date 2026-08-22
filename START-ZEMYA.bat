@echo off
cd /d "C:\Projects\zemya"
title Zemya

echo ============================================================
echo    Z E M Y A
echo ============================================================
echo.

rem ---- one-time cleanup of everything that is no longer used ----
if exist "_previous-attempt\" (
  echo Removing _previous-attempt\ ...
  rmdir /s /q "_previous-attempt"
)
if exist "prototype\" (
  echo Removing prototype\ ...
  rmdir /s /q "prototype"
)
if exist ".git\index.lock" del /f /q /a ".git\index.lock" >nul 2>&1
if exist ".git\objects\maintenance.lock" del /f /q /a ".git\objects\maintenance.lock" >nul 2>&1
for /r ".git\objects" %%F in (tmp_pack_* tmp_idx_* tmp_obj_*) do del /f /q "%%F" >nul 2>&1

rem ---- Node.js must be present ----
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this machine.
  echo.
  echo   1. Go to  https://nodejs.org
  echo   2. Click the big green LTS button, run the installer,
  echo      accept every default, let it finish.
  echo   3. Close this window and double-click this file again.
  echo.
  pause
  exit /b 1
)

echo Node: 
node -v
echo.

rem ---- dependencies ----
if not exist "node_modules\" (
  echo Installing dependencies into C:\Projects\zemya\node_modules
  echo This takes a minute or two, and only happens once.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   ***  npm install failed. Copy this whole window to Claude.  ***
    pause
    exit /b 1
  )
  echo.
  echo Dependencies installed.
  echo.
)

rem ---- generate the route types tsconfig expects ----
echo Generating route types...
call npx react-router typegen
echo.

echo Starting the dev server.
echo Your browser will open at http://localhost:5173/ in a few seconds.
echo.
echo    ***  LEAVE THIS WINDOW OPEN while you use the app  ***
echo    To stop the app: click this window and press Ctrl+C
echo.

start "" cmd /c "timeout /t 10 >nul & start http://localhost:5173/"
call npm run dev

echo.
echo The server has stopped.
pause

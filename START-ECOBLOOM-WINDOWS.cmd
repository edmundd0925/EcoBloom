@echo off
setlocal
cd /d "%~dp0"
echo EcoBloom Person 3 - Windows launcher
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Reinstall Node.js LTS and reopen this folder.
  pause
  exit /b 1
)
if not exist package.json (
  echo This launcher must be beside package.json in the EcoBloom-main folder.
  pause
  exit /b 1
)
echo Removing the Mac-specific node_modules copy from this extracted folder...
if exist node_modules rmdir /s /q node_modules
if exist node_modules (
  echo The old node_modules folder could not be removed.
  echo Close editors using it and try again.
  pause
  exit /b 1
)
echo Installing Windows dependencies...
call npm.cmd install
if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection and the error above.
  pause
  exit /b 1
)
echo Starting EcoBloom. Keep this window open.
echo Dashboard: add ?dashboard=person3 to the localhost URL below.
call npm.cmd run dev
pause

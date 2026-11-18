@echo off
rem Floor Plan 2027 - starts the program on this computer and opens it in the browser.
rem Keep this window open while you use the program; close it to stop.
title Floor Plan 2027
cd /d "%~dp0"
set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY (python --version >nul 2>&1 && set "PY=python")
if not defined PY (
  echo Python was not found, so the program opens straight from its file.
  echo Most things work; for everything, install Python from https://www.python.org and run this again.
  start "" "%~dp0index.html"
  pause
  exit /b
)
echo Starting Floor Plan 2027 at http://localhost:8027 ...
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8027/"
echo The program is running. Keep this window open; close it to stop the program.
%PY% -m http.server 8027

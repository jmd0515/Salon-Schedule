@echo off
:: ============================================================
:: Salon Schedule Scraper - Run Script
:: Double-click this file to manually refresh the schedule,
:: or set it up with Task Scheduler to run automatically.
:: ============================================================

echo.
echo ========================================
echo   Salon Schedule Scraper
echo ========================================
echo.

:: Change to the folder where this script lives
cd /d "%~dp0"

:: Check that Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Please install from: https://nodejs.org
    pause
    exit /b 1
)

:: Run the scraper
echo [INFO] Starting scraper at %date% %time%
node scrape.js

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Schedule updated! Opening report...
    start "" "schedule_report.html"
) else (
    echo.
    echo [WARNING] Scraper encountered issues. Check output above.
    echo           Opening report with last available data...
    if exist "schedule_report.html" start "" "schedule_report.html"
    pause
)

# setup-schedule-task.ps1
# Sets up a scheduled task to run the Schedule scraper once daily at 6:00 AM

$TaskName    = "SalonScheduleScraper"
$Description = "Scrapes Salondata weekly schedule once daily and publishes to GitHub Pages"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "========================================"
Write-Host "  Schedule Scraper - Task Setup"
Write-Host "========================================"
Write-Host ""

Write-Host "[INFO] Setting up Task Scheduler..."
Write-Host "       Working dir: $ScriptDir"
Write-Host "       Runs: Daily at 6:00 AM"
Write-Host ""

# Remove existing task if it exists
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[INFO] Removed existing task."
}

# Trigger: Daily at 6:00 AM
$Trigger = New-ScheduledTaskTrigger -Daily -At "06:00"

# Action: run node scrape.js in the project directory
$Action = New-ScheduledTaskAction `
    -Execute "node" `
    -Argument "scrape.js" `
    -WorkingDirectory $ScriptDir

# Settings
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description $Description `
    -Trigger $Trigger `
    -Action $Action `
    -Settings $Settings `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host ""
Write-Host "[SUCCESS] Task '$TaskName' created!"
Write-Host ""
Write-Host "  Schedule: Daily at 6:00 AM"
Write-Host "  Action:   node scrape.js"
Write-Host ""
Read-Host "Press Enter to close"

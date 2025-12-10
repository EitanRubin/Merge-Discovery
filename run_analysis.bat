@echo off
REM Merge Discovery - Combined Analysis Pipeline
REM This script runs Noizz2025 to capture JS files and then Static_Analysis

echo ============================================================
echo Merge Discovery - Combined Analysis Pipeline
echo ============================================================

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    exit /b 1
)

REM Run the Python orchestration script with all arguments
python "%~dp0run_analysis.py" %*



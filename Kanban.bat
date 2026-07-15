@echo off
rem Windows launcher - double-click this file to start the Kanban board.
cd /d "%~dp0"
python kanban.py
if errorlevel 1 py kanban.py
pause

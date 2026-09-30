@echo off
rem Kanaban Mind on its own, for Windows -- UNTESTED: written on a Mac, never run on Windows.
rem Nothing to install: Python's standard library only. It needs ui\dist (built on a Mac, or
rem use the Kanban board's Kanban.bat, which ships it built).
cd /d "%~dp0"
python main.py
if errorlevel 1 py -3 main.py
pause

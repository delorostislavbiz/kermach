@echo off
rem kermach (t381, name since t396): Windows wrapper. Runs lib\kermach.js with the program exe in Node mode (KERMACH_NODE, set in Kermach terminals).
rem TERMINALUS_NODE - the same variable before t1307: tabs opened by a daemon started before the rename still have only it.
rem The old name terminalus.cmd next to it calls this file: agents in conversations started before the rename still call it.
rem The script is in lib\, not here: this folder is in PATH and .JS is in PATHEXT - "kermach.js" typed here would open Windows Script Host (t388).
rem No KERMACH_NODE (terminal opened outside Kermach or before the update) - node from PATH, the script itself explains; no node - code 2.
rem Messages here are in English: cmd reads this file in the OEM code page.
rem exit /b is the last command of its block: with more commands after it in the block cmd /c returns 0 instead of 2 (t381 probe).
setlocal
if not defined KERMACH_NODE if defined TERMINALUS_NODE set "KERMACH_NODE=%TERMINALUS_NODE%"
if defined KERMACH_NODE set ELECTRON_RUN_AS_NODE=1
if not defined KERMACH_NODE where node >nul 2>nul
if not defined KERMACH_NODE if errorlevel 1 (
  echo kermach: works only in a Kermach terminal. This one was opened outside Kermach or before the update - open a new tab. 1>&2
  exit /b 2
)
if not defined KERMACH_NODE set "KERMACH_NODE=node"
"%KERMACH_NODE%" "%~dp0lib\kermach.js" %*

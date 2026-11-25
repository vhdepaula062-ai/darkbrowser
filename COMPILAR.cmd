@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows-fast.ps1" %*
if errorlevel 1 (
  echo A compilacao falhou. Confira o erro acima.
) else (
  echo Compilacao concluida. O executavel esta na pasta .build.
)
pause

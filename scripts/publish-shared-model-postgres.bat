@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Publish shared model from VPS Postgres (Phase 6).
REM Default: git pull + train + commit/push. You deploy on VPS: ssh early@HOST /app/deploy-early.sh
REM Prereq: SSH tunnel, e.g. ssh -L 5433:127.0.0.1:5432 early@YOUR_VPS
REM Repo .env: DATABASE_URL=postgresql://earlyuser:PASS@127.0.0.1:5433/earlydb
REM Optional: MANIFEST_VERSION=0.92  MANIFEST_BUMP=major|minor

cd /d "%~dp0.."

set "STAGE=alphabet"
set "GIT_BRANCH=letter-writing-ml"
set "PUSH_ONLY=0"
set "API_HOST=https://early.gregtutors.com"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="deploy" set "PUSH_ONLY=1" & shift & goto parse_args
if /i "%~1"=="--deploy" set "PUSH_ONLY=1" & shift & goto parse_args
if /i "%~1"=="deploy-only" set "PUSH_ONLY=1" & shift & goto parse_args
if /i "%~1"=="push-only" set "PUSH_ONLY=1" & shift & goto parse_args
set "STAGE=%~1"
shift
goto parse_args

:args_done

echo [0] git pull origin %GIT_BRANCH%...
git pull origin %GIT_BRANCH%
if errorlevel 1 (
  echo git pull failed — fix conflicts or network, then retry.
  exit /b 1
)

if "%PUSH_ONLY%"=="1" goto git_push

if not defined DATABASE_URL if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%~A"=="DATABASE_URL" set "DATABASE_URL=%%~B"
  )
)

if not defined DATABASE_URL (
  echo.
  echo ERROR: DATABASE_URL is not set.
  echo   1. Start tunnel: ssh -L 5433:127.0.0.1:5432 early@YOUR_VPS
  echo   2. Add to .env: DATABASE_URL=postgresql://earlyuser:PASS@127.0.0.1:5433/earlydb
  echo.
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo ERROR: python not found on PATH.
  exit /b 1
)

if not exist "node_modules\pg\package.json" (
  echo Installing npm dependencies ^(pg, etc.^)...
  call npm install
  if errorlevel 1 exit /b 1
)

echo.
echo EARLY publish shared model ^(Postgres^)  stage=%STAGE%
echo ========================================
echo.

echo [1/6] Checking live API sample count...
powershell -NoProfile -Command "try { $c = Invoke-RestMethod -Uri '%API_HOST%/api/calibration?stage=%STAGE%' -TimeoutSec 20; $v = Invoke-RestMethod -Uri '%API_HOST%/api/voice-bank?stage=%STAGE%' -TimeoutSec 20; $t = $c.total + $v.total; Write-Host ('  Judgments: ' + $c.total + ', voice: ' + $v.total + ', total: ' + $t); if ($t -lt 5) { exit 2 } } catch { Write-Host '  (could not reach API — continuing anyway)' }"
if errorlevel 2 (
  echo Need at least 5 cloud samples. Collect more judgments on %API_HOST% first.
  exit /b 1
)

echo [2/6] Pull samples from Postgres...
call npm run calibration:pull:postgres
if errorlevel 1 (
  echo FAILED at calibration:pull:postgres
  echo Is the SSH tunnel open and DATABASE_URL correct?
  exit /b 1
)

echo.
echo [3/6] Merge into training archive...
call npm run training:archive
if errorlevel 1 exit /b 1

echo.
echo [4/6] Train TensorFlow.js model...
if defined MANIFEST_VERSION (
  if defined MANIFEST_BUMP (
    python tools\train_global_model.py --stage %STAGE% --manifest-version %MANIFEST_VERSION% --manifest-bump %MANIFEST_BUMP%
  ) else (
    python tools\train_global_model.py --stage %STAGE% --manifest-version %MANIFEST_VERSION%
  )
) else if defined MANIFEST_BUMP (
  python tools\train_global_model.py --stage %STAGE% --manifest-bump %MANIFEST_BUMP%
) else (
  python tools\train_global_model.py --stage %STAGE%
)
if errorlevel 1 (
  echo FAILED at train_global_model.py
  echo If packages missing: pip install -r tools\requirements-train.txt
  exit /b 1
)

echo.
echo [5/6] Bump app version...
call npm run version:bump
if errorlevel 1 exit /b 1

echo.
echo Model: public\models\%STAGE%\
type public\models\%STAGE%\manifest.json 2>nul
echo.

:git_push
echo [6/6] Build, commit, and push to %GIT_BRANCH%...
call npm run build
if errorlevel 1 (
  echo BUILD FAILED — fix errors before pushing.
  exit /b 1
)

git add public/models/%STAGE% data/training-archive src/version.ts package.json package-lock.json
git commit -m "Publish shared %STAGE% model from Postgres calibration"
if errorlevel 1 (
  echo git commit failed ^(nothing to commit?^)
  exit /b 1
)
git push origin %GIT_BRANCH%
if errorlevel 1 exit /b 1

echo.
echo Done. Pushed to origin/%GIT_BRANCH%.
echo On VPS:  ssh early@early.gregtutors.com /app/deploy-early.sh
echo Devices load the new model on next visit to %API_HOST%.

endlocal
exit /b 0

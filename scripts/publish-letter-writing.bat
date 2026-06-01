@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

REM Pull teacher writing judgments from the VPS Postgres, retrain the
REM letter-writing CNN from teacher seed + judgments, commit, and push.
REM
REM Requires:
REM   - SSH tunnel:  ssh -L 5433:127.0.0.1:5432 early@YOUR_VPS
REM   - .env entry:  DATABASE_URL=postgresql://earlyuser:PASS@127.0.0.1:5433/earlydb
REM   - python with tools/requirements-train.txt installed
REM
REM Flags:
REM   skip-pull   Use existing data/writing-calibration/*.json (offline retrain).
REM   push-only   Skip pull+train, just rebuild and push current model files.

set "GIT_BRANCH=main"
set "PUSH_ONLY=0"
set "SKIP_PULL=0"
set "API_HOST=https://early.gregtutors.com"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="push-only" set "PUSH_ONLY=1" & shift & goto parse_args
if /i "%~1"=="skip-pull" set "SKIP_PULL=1" & shift & goto parse_args
shift
goto parse_args

:args_done

echo [0] git pull origin %GIT_BRANCH%...
git pull origin %GIT_BRANCH%
if errorlevel 1 exit /b 1

if "%PUSH_ONLY%"=="1" goto git_push

if not exist "data\writing-bank\teacher-seed.json" (
  echo.
  echo ERROR: data\writing-bank\teacher-seed.json not found.
  echo Export writing seed from the app ^(collector panel - Export writing seed^).
  echo.
  exit /b 1
)

if "%SKIP_PULL%"=="1" goto train

if not defined DATABASE_URL if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%~A"=="DATABASE_URL" set "DATABASE_URL=%%~B"
  )
)

if not defined DATABASE_URL (
  echo.
  echo ERROR: DATABASE_URL is not set.
  echo   1. Open SSH tunnel:  ssh -L 5433:127.0.0.1:5432 early@YOUR_VPS
  echo   2. Add to .env:      DATABASE_URL=postgresql://earlyuser:PASS@127.0.0.1:5433/earlydb
  echo.
  echo Or rerun with "skip-pull" to train from cached data\writing-calibration\ only.
  exit /b 1
)

echo.
echo [1/5] Pull writing judgments from VPS Postgres...
call npm run writing:pull
if errorlevel 1 (
  echo FAILED to pull writing judgments. Is the SSH tunnel open?
  exit /b 1
)

:train
echo.
echo [2/5] Retrain letter-writing CNN ^(teacher seed + judgments^)...
python tools\train_letter_writing_model.py
if errorlevel 1 exit /b 1

echo.
echo [3/5] Bump app version...
call npm run version:bump
if errorlevel 1 exit /b 1

echo.
echo Model: public\models\letter-writing\
type public\models\letter-writing\manifest.json 2>nul
echo.

:git_push
echo [4/5] Build...
call npm run build
if errorlevel 1 exit /b 1

echo [5/5] Commit and push to %GIT_BRANCH%...
git add public/models/letter-writing data/writing-bank src/version.ts package.json package-lock.json
git commit -m "Retrain letter-writing model from teacher seed + cloud judgments"
if errorlevel 1 (
  echo git commit failed ^(nothing to commit?^)
  exit /b 1
)
git push origin %GIT_BRANCH%
if errorlevel 1 exit /b 1

echo.
echo Done. Deploy VPS: ssh early@early.gregtutors.com /app/deploy_early.sh
endlocal
exit /b 0

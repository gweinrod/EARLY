@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "GIT_BRANCH=letter-writing-ml"
set "PUSH_ONLY=0"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="push-only" set "PUSH_ONLY=1" & shift & goto parse_args
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

echo.
echo [1/4] Train letter-writing CNN from bootstrap seed...
node tools\train_letter_writing_model.mjs
if errorlevel 1 exit /b 1

echo.
echo [2/4] Bump app version...
call npm run version:bump
if errorlevel 1 exit /b 1

echo.
echo Model: public\models\letter-writing\
type public\models\letter-writing\manifest.json 2>nul
echo.

:git_push
echo [3/4] Build...
call npm run build
if errorlevel 1 exit /b 1

echo [4/4] Commit and push to %GIT_BRANCH%...
git add public/models/letter-writing data/writing-bank src/version.ts package.json package-lock.json
git commit -m "Publish shared letter-writing model from teacher bootstrap seed"
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

@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

REM Pull ALL Unit 1 training data from Postgres and retrain shared models:
REM   - Letter Names   (alphabet)
REM   - Letter Sounds  (consonants)
REM   - Letter Writing (letter-writing CNN)
REM
REM Requires:
REM   - SSH tunnel:  ssh -L 5433:127.0.0.1:5432 early@YOUR_VPS
REM   - .env:        DATABASE_URL=postgresql://earlyuser:PASS@127.0.0.1:5433/earlydb
REM   - data\writing-bank\teacher-seed.json (export from app)
REM
REM Flags:
REM   skip-pull   Use cached data\ folders (offline retrain)
REM   push-only   Skip pull+train; build and push current model files

set "GIT_BRANCH=letter-writing-ml"
set "PUSH_ONLY=0"
set "SKIP_PULL=0"

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
  echo Export writing seed from collector panel, save to data\writing-bank\teacher-seed.json
  echo.
  exit /b 1
)

if "%SKIP_PULL%"=="1" goto archive

if not defined DATABASE_URL if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%~A"=="DATABASE_URL" set "DATABASE_URL=%%~B"
  )
)

if not defined DATABASE_URL (
  echo.
  echo ERROR: DATABASE_URL is not set. Open SSH tunnel and set .env, or use skip-pull.
  exit /b 1
)

echo.
echo [1/8] Pull all training samples from Postgres...
call npm run training:pull
if errorlevel 1 exit /b 1

:archive
echo.
echo [2/8] Archive pulled samples locally...
call npm run training:archive
if errorlevel 1 exit /b 1

echo.
echo [3/8] Train Letter Names model ^(alphabet^)...
python tools\train_global_model.py --stage alphabet
if errorlevel 1 exit /b 1

echo.
echo [4/8] Train Letter Sounds model ^(consonants^)...
python tools\train_global_model.py --stage consonants
if errorlevel 1 exit /b 1

echo.
echo [5/8] Train Letter Writing model ^(seed + judgments^)...
python tools\train_letter_writing_model.py
if errorlevel 1 exit /b 1

echo.
echo [6/8] Bump app version...
call npm run version:bump
if errorlevel 1 exit /b 1

echo.
echo Models:
type public\models\alphabet\manifest.json 2>nul
type public\models\consonants\manifest.json 2>nul
type public\models\letter-writing\manifest.json 2>nul
echo.

:git_push
echo [7/8] Build...
call npm run build
if errorlevel 1 exit /b 1

echo [8/8] Commit and push...
git add public/models/alphabet public/models/consonants public/models/letter-writing data/writing-bank src/version.ts package.json package-lock.json
git commit -m "Retrain Unit 1 models: letter names, letter sounds, letter writing"
if errorlevel 1 (
  echo git commit failed ^(nothing to commit?^)
  exit /b 1
)
git push origin %GIT_BRANCH%
if errorlevel 1 exit /b 1

echo.
echo Done. Deploy VPS: ssh early@early.gregtutors.com /app/deploy-early.sh
endlocal
exit /b 0

@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Run from repo root (parent of scripts/)
cd /d "%~dp0.."

set "STAGE=alphabet"
set "DO_DEPLOY=0"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="deploy" set "DO_DEPLOY=1" & shift & goto parse_args
if /i "%~1"=="--deploy" set "DO_DEPLOY=1" & shift & goto parse_args
set "STAGE=%~1"
shift
goto parse_args

:args_done

REM Load BLOB_READ_WRITE_TOKEN from .env if not already set
if not defined BLOB_READ_WRITE_TOKEN if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%~A"=="BLOB_READ_WRITE_TOKEN" set "BLOB_READ_WRITE_TOKEN=%%~B"
  )
)

if not defined BLOB_READ_WRITE_TOKEN (
  echo.
  echo ERROR: BLOB_READ_WRITE_TOKEN is not set.
  echo   - Add it to .env in the repo root, or
  echo   - set BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... in this terminal
  echo.
  echo Get the token from Vercel - Storage - Blob - your store - .env.local tab.
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo ERROR: python not found on PATH.
  exit /b 1
)

echo.
echo EARLY publish shared model  stage=%STAGE%
echo ========================================
echo.

echo Checking cloud sample count...
powershell -NoProfile -Command "try { $c = Invoke-RestMethod -Uri 'https://early-sigma.vercel.app/api/calibration?stage=%STAGE%' -TimeoutSec 20; $v = Invoke-RestMethod -Uri 'https://early-sigma.vercel.app/api/voice-bank?stage=%STAGE%' -TimeoutSec 20; $t = $c.total + $v.total; Write-Host ('  Judgments: ' + $c.total + ', voice: ' + $v.total + ', total: ' + $t); if ($t -lt 5) { exit 2 } } catch { Write-Host '  (could not reach API — continuing anyway)' }"
if errorlevel 2 (
  echo.
  echo Need at least 5 cloud samples total ^(voice recordings + teacher accepts^).
  echo Finish voice setup and/or practice accepts on the live app ^(v0.12+^), then retry.
  exit /b 1
)

echo [1/5] Pull samples from Vercel Blob...
call npm run calibration:pull
if errorlevel 1 (
  echo FAILED at calibration:pull
  exit /b 1
)

echo.
echo [2/5] Archive samples locally (kept after you clear cloud)...
call npm run training:archive
if errorlevel 1 (
  echo FAILED at training:archive
  exit /b 1
)

echo.
echo [3/5] Train TensorFlow.js model (fine-tune if base-weights.json exists)...
python tools\train_global_model.py --stage %STAGE%
if errorlevel 1 (
  echo FAILED at train_global_model.py
  echo If Python packages are missing: pip install -r tools\requirements-train.txt
  exit /b 1
)

echo.
echo [4/5] Bump app version...
call npm run version:bump
if errorlevel 1 (
  echo FAILED at version:bump
  exit /b 1
)

echo.
echo [5/5] Done. Model files: public\models\%STAGE%\
type public\models\%STAGE%\manifest.json 2>nul
echo.

if "%DO_DEPLOY%"=="0" (
  echo To deploy to Vercel, run:
  echo   scripts\publish-shared-model.bat %STAGE% deploy
  echo.
  echo Or manually:
  echo   git add public/models src/version.ts package.json
  echo   git commit -m "Publish shared %STAGE% model"
  echo   git push origin main
  goto :eof
)

echo Committing and pushing...
git add public/models/%STAGE% src/version.ts package.json
git commit -m "Publish shared %STAGE% model from cloud calibration"
if errorlevel 1 (
  echo git commit failed ^(nothing to commit?^)
  exit /b 1
)
git push origin main
if errorlevel 1 (
  echo git push failed
  exit /b 1
)
echo.
echo Pushed. Vercel will redeploy; devices load the new model on next visit.

endlocal

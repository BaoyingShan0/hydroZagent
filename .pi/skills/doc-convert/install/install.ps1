# Install the document-processing toolchain for doc-convert + Anthropic docx/
# xlsx/pptx/pdf skills. Windows. Idempotent: safe to re-run.
#
#   powershell -ExecutionPolicy Bypass -File install\install.ps1
#
#Requires -Version 5.0
$ErrorActionPreference = "Stop"

function Have($n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }

$py = if (Have python) { "python" } elseif (Have py) { "py" } else { $null }
if (-not $py) {
    Write-Error "Python not found. Install from https://python.org (and tick 'Add to PATH'), then re-run."
}
$pip = @($py, "-m", "pip", "install", "--upgrade")
$pylibs = @("openpyxl","pandas","pypdf","pdfplumber","reportlab","python-pptx","Pillow","markitdown[all]")
$pylibs_opt = @("pytesseract","pdf2image")

Write-Host "==> System packages (pandoc, LibreOffice, poppler, qpdf)"
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
    winget install --id JohnMacFarlane.Pandoc --accept-source-agreements --accept-package-agreements
    winget install --id TheDocumentFoundation.LibreOffice --accept-source-agreements --accept-package-agreements
    winget install --id QPDF.QPDF --accept-source-agreements --accept-package-agreements
    Write-Warning "Poppler has no official winget id. Download poppler for Windows from`n  https://github.com/oschwartz10612/poppler-windows/releases`nand add its 'Library\bin' to PATH (for pdftotext/pdftoppm)."
} else {
    Write-Warning "winget not found. Install manually: pandoc, LibreOffice, poppler (Windows build), qpdf.`nOr use Chocolatey: choco install pandoc libreoffice poppler qpdf"
}

Write-Host "==> Python libraries (required)"
& $pip @pylibs

Write-Host "==> Python libraries (optional OCR)"
try { & $pip @pylibs_opt } catch { Write-Warning "optional OCR libs failed; skipped" }

Write-Host "==> Node libraries (docx, pptxgenjs)"
if (Have npm) {
    npm install -g docx pptxgenjs
} else {
    Write-Warning "npm not found; skip docx/pptxgenjs (only needed to CREATE new docx/pptx)"
}

Write-Host ""
Write-Host "==> Verifying with doctor.py"
& $py "$PSScriptRoot\..\scripts\doctor.py"

Write-Host ""
Write-Host "Done. If the doctor still reports missing tools, re-run it with --fix for hints."
Write-Host "NOTE: restart your terminal after installs so PATH changes take effect."

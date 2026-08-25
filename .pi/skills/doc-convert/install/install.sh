#!/usr/bin/env bash
# Install the document-processing toolchain for doc-convert + Anthropic docx/
# xlsx/pptx/pdf skills. macOS and Linux. Idempotent: safe to re-run.
#
#   bash install/install.sh
#
set -euo pipefail

PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1; then
  PY="python"
fi
PIP=("$PY" -m pip install --upgrade)
PYLIBS=(openpyxl pandas pypdf pdfplumber reportlab python-pptx Pillow "markitdown[all]")
PYLIBS_OPT=(pytesseract pdf2image)
NPM=(npm install -g)

have() { command -v "$1" >/dev/null 2>&1; }

install_system() {
  if [[ "$(uname)" == "Darwin" ]]; then
    if ! have brew; then
      echo "[!] Homebrew not found. Install from https://brew.sh, then re-run." >&2
      exit 1
    fi
    brew install pandoc libreoffice poppler qpdf tesseract
  elif have apt-get; then
    sudo apt-get update
    sudo apt-get install -y pandoc libreoffice poppler-utils qpdf tesseract-ocr fonts-noto-cjk
  elif have dnf; then
    sudo dnf install -y pandoc libreoffice poppler-utils qpdf tesseract fonts-noto-sans-cjk
  elif have pacman; then
    sudo pacman -S --noconfirm pandoc libreoffice-fresh poppler qpdf tesseract fonts-noto-cjk
  elif have apk; then
    sudo apk add --no-cache pandoc libreoffice poppler-utils qpdf tesseract-ocr font-noto-cjk
  else
    echo "[!] Unknown package manager. Install manually: pandoc libreoffice poppler qpdf tesseract + a CJK font." >&2
    exit 1
  fi
}

echo "==> System packages (pandoc, LibreOffice, poppler, qpdf, tesseract, CJK font)"
install_system

echo "==> Python libraries (required)"
"${PIP[@]}" "${PYLIBS[@]}"

echo "==> Python libraries (optional OCR)"
"${PIP[@]}" "${PYLIBS_OPT[@]}" || echo "[!] optional OCR libs failed; skipped"

echo "==> Node libraries (docx, pptxgenjs)"
if have npm; then
  "${NPM[@]}" docx pptxgenjs
else
  echo "[!] npm not found; skip docx/pptxgenjs (only needed to CREATE new docx/pptx)" >&2
fi

echo
echo "==> Verifying with doctor.py"
"$PY" "$(dirname "$0")/../scripts/doctor.py" || true

echo
echo "Done. If the doctor still reports missing tools, re-run it with --fix for hints."

#!/usr/bin/env python3
"""Check the document-processing toolchain the doc-convert + Anthropic docx/xlsx/
pptx/pdf skills rely on. Prints a report; exits 0 if all REQUIRED tools are
present, 1 otherwise. `--fix` also prints the install commands for your OS.

Cross-platform (Windows/macOS/Linux), Python 3.8+, stdlib only.
"""
from __future__ import annotations

import importlib
import os
import platform
import shutil
import subprocess
import sys


def which(name):
    return shutil.which(name) or shutil.which(name + ".exe")


def win_dirs():
    return [
        r"C:\Program Files\LibreOffice\program",
        r"C:\Program Files (x86)\LibreOffice\program",
    ]


def find_soffice():
    p = which("soffice") or which("libreoffice")
    if p:
        return p
    if os.name == "nt":
        for d in win_dirs():
            cand = os.path.join(d, "soffice.exe")
            if os.path.exists(cand):
                return cand
    return None


def py_version():
    try:
        return sys.version.split()[0]
    except Exception:
        return "?"


def py_lib(name):
    try:
        m = importlib.import_module(name)
        return getattr(m, "__version__", "ok")
    except Exception:
        return None


def node_lib(name):
    try:
        r = subprocess.run(["node", "-e", f"require.resolve('{name}')"],
                           capture_output=True, text=True)
        return "ok" if r.returncode == 0 else None
    except Exception:
        return None


def cjk_font():
    """Best-effort check that a CJK font is installed (so LibreOffice renders
    Chinese/Japanese/Korean instead of tofu boxes)."""
    plat = platform.system()
    try:
        if plat == "Linux":
            for d in ["/usr/share/fonts", os.path.expanduser("~/.fonts"), os.path.expanduser("~/.local/share/fonts")]:
                if os.path.isdir(d):
                    for root, _, files in os.walk(d):
                        for f in files:
                            if any(k in f.lower() for k in ("noto", "cjk", "wqy", "yahei", "pingfang", "sourcehansans")):
                                return f
            return None
        if plat == "Darwin":
            d = "/System/Library/Fonts", os.path.expanduser("~/Library/Fonts")
            for dd in d:
                if os.path.isdir(dd):
                    for f in os.listdir(dd):
                        if any(k in f.lower() for k in ("pingfang", "yahei", "hiragino", "noto")):
                            return f
            return None
        if plat == "Windows":
            for d in [r"C:\Windows\Fonts", os.path.expanduser(r"~\AppData\Local\Microsoft\Windows\Fonts")]:
                if os.path.isdir(d):
                    for f in os.listdir(d):
                        if any(k in f.lower() for k in ("msyh", "simhei", "simsun", "yahei", "noto")):
                            return f
            return None
    except Exception:
        return None
    return "unknown-platform"


CHECKS = [
    # (label, category, required, getter)
    ("python", "core", True, lambda: py_version()),
    ("node", "core", True, lambda: which("node") and subprocess.run(["node", "-v"], capture_output=True).stdout.decode().strip() or None),
    ("pandoc", "core", True, lambda: _cli_version(["pandoc", "--version"])),
    ("soffice (LibreOffice)", "core", True, find_soffice),
    ("pdftotext (poppler)", "core", True, lambda: which("pdftotext")),
    ("pdftoppm (poppler)", "core", True, lambda: which("pdftoppm")),
    ("qpdf", "core", False, lambda: which("qpdf")),
    ("tesseract (OCR)", "core", False, lambda: which("tesseract")),
    ("markitdown", "python", True, lambda: which("markitdown") or py_lib("markitdown")),
    ("openpyxl", "python", True, lambda: py_lib("openpyxl")),
    ("pandas", "python", True, lambda: py_lib("pandas")),
    ("pypdf", "python", True, lambda: py_lib("pypdf")),
    ("pdfplumber", "python", True, lambda: py_lib("pdfplumber")),
    ("reportlab", "python", True, lambda: py_lib("reportlab")),
    ("python-pptx", "python", True, lambda: py_lib("pptx")),
    ("Pillow", "python", True, lambda: py_lib("PIL")),
    ("pytesseract (OCR)", "python", False, lambda: py_lib("pytesseract")),
    ("pdf2image (OCR)", "python", False, lambda: py_lib("pdf2image")),
    ("docx (npm)", "node", True, lambda: node_lib("docx")),
    ("pptxgenjs (npm)", "node", True, lambda: node_lib("pptxgenjs")),
    ("CJK font", "fonts", False, cjk_font),
]


def _cli_version(cmd):
    if not which(cmd[0]):
        return None
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        first = (r.stdout or r.stderr).splitlines()[0] if (r.stdout or r.stderr) else ""
        return first.strip()[:60] or "ok"
    except Exception:
        return "ok"


def install_commands():
    plat = platform.system()
    py = sys.executable
    pip = f'"{py}" -m pip install --upgrade'
    pylibs = "openpyxl pandas pypdf pdfplumber reportlab python-pptx Pillow markitdown[all]"
    pylibs_opt = "pytesseract pdf2image"
    npm = "npm install -g"
    lines = ["# Install commands for your platform:"]
    if plat == "Darwin":
        lines += [
            "brew install pandoc libreoffice poppler qpdf tesseract",
            f"{pip} {pylibs}",
            f"{pip} {pylibs_opt}   # optional OCR",
            f"{npm} docx pptxgenjs",
            "# CJK fonts ship with macOS (PingFang).",
        ]
    elif plat == "Linux":
        lines += [
            "# Debian/Ubuntu:",
            "sudo apt-get update",
            "sudo apt-get install -y pandoc libreoffice poppler-utils qpdf tesseract-ocr fonts-noto-cjk",
            f"{pip} {pylibs}",
            f"{pip} {pylibs_opt}   # optional OCR",
            f"{npm} docx pptxgenjs",
            "# Fedora: sudo dnf install pandoc libreoffice poppler-utils qpdf tesseract fonts-noto-sans-cjk",
        ]
    elif plat == "Windows":
        lines += [
            "# Option A — winget (Windows 10/11):",
            "winget install --id JohnMacFarlane.Pandoc",
            "winget install --id TheDocumentFoundation.LibreOffice",
            "winget install --id oschwartz10612.Poppler   # or download poppler for Windows and add to PATH",
            "winget install --id QPDF.QPDF",
            "# Option B — Chocolatey: choco install pandoc libreoffice poppler qpdf",
            f"{pip} {pylibs}",
            f"{pip} {pylibs_opt}   # optional OCR",
            f"{npm} docx pptxgenjs",
            "# CJK fonts: Windows ships Microsoft YaHei (msyh).",
        ]
    else:
        lines.append(f"# Unsupported platform {plat}; install pandoc, LibreOffice, poppler, qpdf, then the pip/npm libs.")
    return "\n".join(lines)


def main():
    fix = "--fix" in sys.argv
    print(f"doc-convert toolchain doctor  (platform: {platform.system()} {platform.machine()})")
    print(f"{'tool':<24} {'category':<10} {'req':<5} status")
    print("-" * 70)
    missing_required = []
    for label, cat, req, getter in CHECKS:
        try:
            val = getter()
        except Exception as e:
            val = f"error: {e}"
        if val:
            status = val
        else:
            status = "MISSING (optional)" if not req else "*** MISSING ***"
            if req:
                missing_required.append(label)
        print(f"{label:<24} {cat:<10} {'yes' if req else 'no':<5} {status}")
    print("-" * 70)
    if missing_required:
        print(f"\nRequired tools missing: {', '.join(missing_required)}")
        print("The doc-convert and Anthropic docx/xlsx/pptx/pdf skills will fail without them.")
    else:
        print("\nAll required tools present.")
    if fix or missing_required:
        print()
        print(install_commands())
    sys.exit(1 if missing_required else 0)


if __name__ == "__main__":
    main()

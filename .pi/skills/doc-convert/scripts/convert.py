#!/usr/bin/env python3
"""doc-convert router: any office/PDF format -> any other, plus PDF page ops.

Thin dispatcher over the canonical engines (LibreOffice, pandoc, markitdown,
poppler, pypdf). It picks the engine per (input, output) pair and shells out;
it does not re-implement conversion. If a required tool is missing it prints a
pointed "run doctor.py" hint and exits non-zero rather than silently failing.

Usage:
  python convert.py <input> -t <ext> [-o output]     # single-file conversion
  python convert.py merge <pdf...> -o <out.pdf>
  python convert.py split <in.pdf> [-o <outdir>]
  python convert.py rotate <in.pdf> <degrees> -o <out.pdf>

Cross-platform (Windows/macOS/Linux), Python 3.8+, stdlib only except a lazy
import of pypdf for merge/split/rotate.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Canonical skill dir = parent of this script's dir (scripts/).
SKILL_DIR = Path(__file__).resolve().parent.parent
DOCTOR = SKILL_DIR / "scripts" / "doctor.py"

# Format families.
DOC_FAMILY = {"docx", "odt", "rtf", "html", "htm", "epub", "tex", "latex", "md", "markdown", "txt"}
LEGACY = {"doc", "dot", "xls", "xlt", "ppt", "pot"}
SHEET = {"xlsx", "xlsm", "xls", "ods", "csv", "tsv"}
SLIDE = {"pptx", "ppt", "odp"}
IMAGE = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif"}


class ToolMissing(Exception):
    pass


def find_tool(names, extra_paths=()):
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    for base in extra_paths:
        for n in names:
            cand = Path(base) / (n + (".exe" if os.name == "nt" else ""))
            if cand.exists():
                return str(cand)
    return None


def find_soffice():
    """Locate LibreOffice. Tries PATH, common Windows install dirs, then the
    Anthropic skill's soffice.py wrapper (which itself locates soffice)."""
    p = find_tool(["soffice", "libreoffice", "soffice.exe"])
    if p:
        return [p]
    win_dirs = [
        r"C:\Program Files\LibreOffice\program",
        r"C:\Program Files (x86)\LibreOffice\program",
    ]
    p = find_tool(["soffice", "soffice.exe"], win_dirs)
    if p:
        return [p]
    # Fall back to the Anthropic wrapper (it knows how to find soffice and
    # avoids the "bare soffice hangs in sandbox" issue).
    wrapper = SKILL_DIR.parent.parent / "git" / "github.com" / "anthropics" / "skills" / "skills" / "docx" / "scripts" / "office" / "soffice.py"
    if wrapper.exists():
        return [sys.executable, str(wrapper)]
    return None


def run(cmd):
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError as e:
        raise ToolMissing(cmd[0]) from e


def soffice_convert(in_path: Path, target_ext: str, outdir: Path):
    soffice = find_soffice()
    if not soffice:
        raise ToolMissing("soffice (LibreOffice)")
    outdir.mkdir(parents=True, exist_ok=True)
    run(soffice + ["--headless", "--convert-to", target_ext, "--outdir", str(outdir), str(in_path)])
    # LibreOffice names output <basename>.<ext>.
    expected = outdir / (in_path.stem + "." + target_ext)
    if not expected.exists():
        # Some filters (e.g. csv) keep the stem; find any produced file.
        produced = sorted(outdir.glob(in_path.stem + "*"))
        produced = [f for f in produced if f.suffix.lower().lstrip(".") == target_ext.lower()]
        if not produced:
            raise RuntimeError(f"LibreOffice produced no .{target_ext} file in {outdir}")
        return produced[0]
    return expected


def need(tool_label, cmd):
    """Run cmd; if the binary is missing, raise ToolMissing(tool_label)."""
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        raise ToolMissing(tool_label)


def convert_single(in_path: Path, out_ext: str, out_path: Path | None):
    in_ext = in_path.suffix.lower().lstrip(".")
    out_ext = out_ext.lower().lstrip(".")
    if not out_path:
        out_path = in_path.with_suffix("." + out_ext)
    if in_ext == out_ext:
        if out_path.resolve() == in_path.resolve():
            print(out_path)  # already in target format; nothing to do
            return
        shutil.copy2(in_path, out_path)
        print(out_path)
        return

    tmp = Path(os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp"))) / f"doc-convert-{os.getpid()}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        _route(in_path, in_ext, out_ext, out_path, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(out_path)


def _route(in_path, in_ext, out_ext, out_path, tmp):
    # 1. Reading anything into markdown -> markitdown (best for context).
    if out_ext in ("md", "markdown"):
        md = _markitdown(in_path, tmp)
        shutil.move(str(md), str(out_path))
        return

    # 2. PDF input is terminal.
    if in_ext == "pdf":
        if out_ext == "txt":
            need("pdftotext (poppler)", ["pdftotext", "-layout", str(in_path), str(out_path)])
            return
        if out_ext == "pdf":
            shutil.copy2(in_path, out_path)
            return
        if out_ext in IMAGE:
            prefix = tmp / in_path.stem
            need("pdftoppm (poppler)", ["pdftoppm", "-jpeg" if out_ext in ("jpg", "jpeg") else "-png", "-r", "150", str(in_path), str(prefix)])
            imgs = sorted(tmp.glob(in_path.stem + "*"))
            if len(imgs) == 1:
                shutil.move(str(imgs[0]), str(out_path))
            else:
                # Multiple pages: keep them in tmp and copy next to output with -N suffix.
                for i, im in enumerate(imgs, 1):
                    shutil.copy2(im, out_path.with_suffix(f".{i}{out_path.suffix}" if len(imgs) > 1 else out_path.suffix))
                print(f"# pdf had {len(imgs)} pages; wrote {len(imgs)} files next to {out_path.name}", file=sys.stderr)
            return
        if out_ext in SHEET:
            _pdf_tables_to_sheet(in_path, out_ext, out_path)
            return
        # pdf -> docx/html/etc.: lossy. markitdown -> md, then pandoc md -> target.
        sys.stderr.write("warning: PDF is a terminal format; round-tripping to "
                         f".{out_ext} is lossy (text/tables only, layout lost).\n")
        md = _markitdown(in_path, tmp)
        if out_ext == "md":
            shutil.move(str(md), str(out_path))
            return
        _pandoc(md, out_ext, out_path)
        return

    # 3. Anything -> PDF -> LibreOffice (one engine covers office + image + html).
    #    Markdown is the exception: LibreOffice cannot import .md, so go md->docx
    #    via pandoc, then docx->pdf via LibreOffice.
    if out_ext == "pdf":
        if in_ext in ("md", "markdown"):
            docx = tmp / (in_path.stem + ".docx")
            _pandoc(in_path, "docx", docx)
            produced = soffice_convert(docx, "pdf", tmp)
        else:
            produced = soffice_convert(in_path, "pdf", tmp)
        shutil.move(str(produced), str(out_path))
        return

    # 4. Image input.
    if in_ext in IMAGE:
        if out_ext in IMAGE:
            _pillow_convert(in_path, out_ext, out_path)
            return
        if out_ext == "pdf":
            produced = soffice_convert(in_path, "pdf", tmp)
            shutil.move(str(produced), str(out_path))
            return
        raise SystemExit(f"Unsupported: .{in_ext} -> .{out_ext} (image can only go to image/pdf)")

    # 5. Legacy binary office -> modern first, then re-route.
    if in_ext in LEGACY:
        modern = {"doc": "docx", "dot": "docx", "xls": "xlsx", "xlt": "xlsx", "ppt": "pptx", "pot": "pptx"}[in_ext]
        if out_ext == modern:
            produced = soffice_convert(in_path, modern, tmp)
            shutil.move(str(produced), str(out_path))
            return
        produced = soffice_convert(in_path, modern, tmp)
        _route(produced, modern, out_ext, out_path, tmp)
        return

    # 6. Document family <-> document family -> pandoc (best fidelity).
    if in_ext in DOC_FAMILY and out_ext in DOC_FAMILY:
        _pandoc(in_path, out_ext, out_path)
        return

    # 7. Spreadsheet <-> spreadsheet -> LibreOffice.
    if in_ext in SHEET and out_ext in SHEET:
        produced = soffice_convert(in_path, out_ext, tmp)
        shutil.move(str(produced), str(out_path))
        return

    # 8. Presentation <-> presentation -> LibreOffice.
    if in_ext in SLIDE and out_ext in SLIDE:
        produced = soffice_convert(in_path, out_ext, tmp)
        shutil.move(str(produced), str(out_path))
        return

    # 9. Cross-family that LibreOffice can still do (e.g. docx->html already
    # handled by pandoc; xlsx->html, pptx->html, sheet/slide -> txt).
    if out_ext in ("txt", "html", "htm") and (in_ext in SHEET or in_ext in SLIDE):
        produced = soffice_convert(in_path, out_ext, tmp)
        shutil.move(str(produced), str(out_path))
        return

    raise SystemExit(f"Unsupported conversion: .{in_ext} -> .{out_ext}. "
                     f"See the SKILL.md matrix; for deep create/edit load the docx/xlsx/pptx skill.")


def _markitdown(in_path: Path, tmp: Path) -> Path:
    md = shutil.which("markitdown")
    if not md:
        # Try python -m markitdown
        try:
            subprocess.run([sys.executable, "-m", "markitdown", "--help"], check=True,
                           capture_output=True)
            md = None
        except Exception:
            raise ToolMissing("markitdown")
    out = tmp / (in_path.stem + ".md")
    cmd = [sys.executable, "-m", "markitdown"] if md is None else [md]
    cmd += [str(in_path), "-o", str(out)]
    run(cmd)
    return out


def _pandoc(in_path: Path, out_ext: str, out_path: Path):
    pandoc = shutil.which("pandoc")
    if not pandoc:
        raise ToolMissing("pandoc")
    fmt = {"htm": "html", "markdown": "markdown", "tex": "latex", "latex": "latex"}.get(out_ext, out_ext)
    run([pandoc, str(in_path), "-o", str(out_path), "-t", fmt])


def _pillow_convert(in_path: Path, out_ext: str, out_path: Path):
    try:
        from PIL import Image
    except ImportError:
        raise ToolMissing("Pillow (pip install Pillow)")
    Image.open(in_path).convert("RGB").save(out_path, out_ext.upper() if out_ext != "jpg" else "JPEG")


def _pdf_tables_to_sheet(in_path: Path, out_ext: str, out_path: Path):
    try:
        import pdfplumber
    except ImportError:
        raise ToolMissing("pdfplumber (pip install pdfplumber)")
    try:
        import openpyxl
    except ImportError:
        raise ToolMissing("openpyxl (pip install openpyxl)")
    wb = openpyxl.Workbook()
    ws = wb.active
    row = 1
    with pdfplumber.open(in_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for tr in table:
                    for col_idx, cell in enumerate(tr, 1):
                        ws.cell(row=row, column=col_idx, value=(cell or ""))
                    row += 1
                row += 1  # blank row between tables
    if out_ext == "csv":
        import csv
        with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            for r in ws.iter_rows(values_only=True):
                w.writerow(r)
    else:
        wb.save(out_path)
    sys.stderr.write(f"warning: extracted tables from PDF best-effort (no formatting, "
                     f"layout heuristics). Verify in the output .{out_ext}.\n")


# --- PDF page operations (pypdf, in-process) -------------------------------

def pdf_merge(inputs, out_path: Path):
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        raise ToolMissing("pypdf (pip install pypdf)")
    w = PdfWriter()
    for f in inputs:
        for page in PdfReader(f).pages:
            w.add_page(page)
    with open(out_path, "wb") as fh:
        w.write(fh)
    print(out_path)


def pdf_split(in_path: Path, outdir: Path):
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        raise ToolMissing("pypdf (pip install pypdf)")
    outdir.mkdir(parents=True, exist_ok=True)
    r = PdfReader(in_path)
    n = len(r.pages)
    for i, page in enumerate(r.pages, 1):
        w = PdfWriter()
        w.add_page(page)
        with open(outdir / f"{in_path.stem}-{i}.pdf", "wb") as fh:
            w.write(fh)
    print(f"# wrote {n} files in {outdir}")


def pdf_rotate(in_path: Path, degrees: int, out_path: Path):
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        raise ToolMissing("pypdf (pip install pypdf)")
    r = PdfReader(in_path)
    w = PdfWriter()
    for page in r.pages:
        page.rotate(degrees)
        w.add_page(page)
    with open(out_path, "wb") as fh:
        w.write(fh)
    print(out_path)


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0 if args else 2)
    cmd = args[0]
    try:
        if cmd == "merge":
            ap = argparse.ArgumentParser(prog="convert.py merge")
            ap.add_argument("inputs", nargs="+")
            ap.add_argument("-o", "--out", required=True)
            a = ap.parse_args(args[1:])
            pdf_merge(a.inputs, Path(a.out))
        elif cmd == "split":
            ap = argparse.ArgumentParser(prog="convert.py split")
            ap.add_argument("input")
            ap.add_argument("-o", "--outdir", default=None)
            a = ap.parse_args(args[1:])
            pdf_split(Path(a.input), Path(a.outdir or Path(a.input).stem))
        elif cmd == "rotate":
            ap = argparse.ArgumentParser(prog="convert.py rotate")
            ap.add_argument("input")
            ap.add_argument("degrees", type=int)
            ap.add_argument("-o", "--out", required=True)
            a = ap.parse_args(args[1:])
            pdf_rotate(Path(a.input), a.degrees, Path(a.out))
        else:
            # Bare convert form: <input> -t <ext> [-o output]
            ap = argparse.ArgumentParser(prog="convert.py")
            ap.add_argument("input")
            ap.add_argument("-t", "--to", required=True, help="output extension, e.g. pdf, docx, md, csv")
            ap.add_argument("-o", "--output", help="output path (default: <input-stem>.<ext>)")
            a = ap.parse_args(args)
            convert_single(Path(a.input), a.to, Path(a.output) if a.output else None)
    except ToolMissing as e:
        sys.stderr.write(f"Missing required tool: {e}\n")
        sys.stderr.write(f"Run: python \"{DOCTOR}\" --fix\n")
        sys.exit(2)
    except SystemExit:
        raise
    except subprocess.CalledProcessError as e:
        sys.stderr.write(f"Engine failed (exit {e.returncode}): {' '.join(map(str, e.cmd))}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()

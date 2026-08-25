---
name: doc-convert
description: "Quickly convert, extract, merge, split, or create office documents and PDFs — Word/Excel/PPT/PDF/HTML/Markdown/CSV/images. Use whenever the user wants to turn one office/PDF format into another (e.g. docx→pdf, xlsx→csv, pdf→txt, pptx→pdf, md→docx, doc→docx, xls→xlsx, ppt→pptx), extract text/tables from a document, merge or split PDFs, or read a document's content into the conversation. Triggers: 'convert', '转格式', '转成', '导出为 PDF', '提取文字', '合并/拆分 PDF', and any mention of .docx/.doc/.xlsx/.xls/.pptx/.ppt/.odt/.ods/.odp/.rtf/.pdf/.csv/.tsv/.html/.md with a conversion or extraction intent. For deep create/edit of a single format (formatting, formulas, slides, tracked changes), load the dedicated docx / xlsx / pptx / pdf skills instead."
license: MIT
---

# Document conversion & quick processing

One decision tree for **any → any** office/PDF conversion. Use the thin router `scripts/convert.py` for the common 80%; fall back to the engine commands below for the long tail. For deep create/edit of a single format, load the matching Anthropic skill (`docx` / `xlsx` / `pptx` / `pdf`) — this skill does not duplicate their formatting guidance.

> Script paths are relative to this skill's directory.

## 0. First run: check the toolchain

The Anthropic doc skills (and this one) assume a toolchain that is **not** present on a fresh machine. Check it before any conversion:

```bash
python scripts/doctor.py          # prints a tool-by-tool report; exit 1 if a required tool is missing
python scripts/doctor.py --fix    # also prints the exact install commands for your OS
```

If anything required is missing, install it once:

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File install/install.ps1
# macOS / Linux
bash install/install.sh
```

Required: `python`, `pandoc`, LibreOffice (`soffice`), Poppler (`pdftotext`, `pdftoppm`). Optional: `qpdf`, `tesseract` (OCR), CJK fonts (for Chinese/Japanese/Korean → PDF). Python libs: `openpyxl`, `pandas`, `pypdf`, `pdfplumber`, `reportlab`, `markitdown[all]`, `python-pptx`, `Pillow`. Node libs: `docx`, `pptxgenjs`.

## 1. Quick conversion — `convert.py`

```bash
python scripts/convert.py <input> -t <output_ext> [-o output_file]
python scripts/convert.py report.docx -t pdf                 # → report.pdf (LibreOffice)
python scripts/convert.py data.xlsx  -t csv                  # → data.csv
python scripts/convert.py slide.pptx -t pdf                  # → slide.pdf
python scripts/convert.py scan.pdf   -t txt                  # → scan.txt (pdftotext -layout)
python scripts/convert.py notes.md   -t docx                 # → notes.docx (pandoc)
python scripts/convert.py old.doc    -t docx                 # → old.docx (legacy → modern via LibreOffice)
python scripts/convert.py budget.xls -t xlsx
python scripts/convert.py report.docx -t pdf -o 上报.pdf      # explicit output name
```

The router picks the engine per pair (see matrix below) and errors with a `run doctor.py` hint if a tool is absent. It never silently degrades.

### PDF page operations (multi-file)

```bash
python scripts/convert.py merge a.pdf b.pdf c.pdf -o merged.pdf
python scripts/convert.py split in.pdf            # → in-1.pdf, in-2.pdf, …
python scripts/convert.py rotate in.pdf 90 -o rotated.pdf
```

## 2. Engine selection matrix (target column → engine)

| Target → | `.md` | `.txt` | `.html` | `.docx`/`.odt`/`.rtf`/`.epub`/`.tex` | `.pdf` | `.xlsx`/`.ods`/`.csv`/`.tsv` | `.pptx`/`.odp` | `.png`/`.jpg` |
|---|---|---|---|---|---|---|---|---|
| **docx/odt/rtf/html/md** | pandoc | pandoc | pandoc | pandoc | LibreOffice | — | — | — |
| **.doc/.ppt/.xls** (legacy) | LO→modern→pandoc | LO | LO | LO→modern | LibreOffice | LO | LO | — |
| **xlsx/ods** | markitdown | LO | LO | — | LibreOffice | LibreOffice | — | — |
| **pptx/odp** | markitdown | LO | — | — | LibreOffice | — | LibreOffice | — |
| **pdf** | markitdown | pdftotext | markitdown→md→pandoc | markitdown→md→pandoc (lossy) | (copy/qpdf) | pdfplumber (tables) | — | pdftoppm |
| **png/jpg** | (OCR: tesseract) | — | — | — | LibreOffice | — | — | Pillow |

Rules the router follows:

- **Reading a doc into the conversation → always `.md` via `markitdown`.** It preserves tables, headings, and slide structure far better than naive text dump. `pandoc -t markdown` is the fallback for docx/html/odt/rtf.
- **Anything → `.pdf` → LibreOffice (`soffice --headless --convert-to pdf`).** One engine handles docx/doc/odt/rtf/html/xlsx/xls/ods/csv/pptx/ppt/odp/png/jpg. For `md → pdf`, the router does `pandoc md→docx` then `soffice docx→pdf` (pandoc's own PDF engines like wkhtmltopdf/latex are rarely installed).
- **Document family ↔ document family (docx/odt/rtf/html/epub/latex/md) → `pandoc`.** Best semantic fidelity. LibreOffice is the fallback only for legacy `.doc` (pandoc cannot read it): `soffice .doc→.docx` first.
- **Spreadsheet ↔ spreadsheet, presentation ↔ presentation, legacy → modern → LibreOffice.**
- **PDF is a terminal format.** Going PDF → docx/xlsx/pptx is always lossy: extract to `.md`/`.txt`/tables first, then rebuild with the dedicated skill. Say this to the user; do not pretend a clean round-trip exists.

## 3. Engine quick reference (when you bypass the router)

```bash
# LibreOffice — universal office converter (legacy↔modern, anything→pdf)
python ../../git/github.com/anthropics/skills/skills/docx/scripts/office/soffice.py --headless --convert-to pdf --outdir . report.docx
# bare soffice works too if on PATH: soffice --headless --convert-to pdf --outdir . report.docx

# pandoc — document family (md/html/docx/odt/rtf/epub/latex)
pandoc notes.md -o notes.docx
pandoc report.docx -t markdown -o report.md

# markitdown — anything → markdown (best for reading into context)
markitdown report.docx -o report.md
markitdown deck.pptx -o deck.md
markitdown data.xlsx -o data.md        # one ## section per sheet

# poppler — PDF text & images
pdftotext -layout scan.pdf scan.txt
pdftoppm -jpeg -r 150 deck.pdf slide    # → slide-1.jpg, slide-2.jpg, …

# qpdf — PDF merge/split/rotate/decrypt (if installed)
qpdf --empty --pages a.pdf b.pdf -- merged.pdf
qpdf in.pdf --pages . 1-5 -- pages1-5.pdf

# pypdf — PDF ops in Python (no extra binary)
python scripts/convert.py merge a.pdf b.pdf -o out.pdf
```

## 4. Worked flows for hydrology tasks

- **规程规范 PDF → 可检索/可引用文本** (read a regulation PDF into context): `markitdown GB-standard.pdf -o gb.md`, then answer from `gb.md`. Scanned/image PDF → OCR first (see `pdf` skill: `pytesseract` + `pdf2image`), then markitdown.
- **水情简报 Word → PDF 上报**: `convert.py 简报.docx -t pdf`. Verify CJK renders (see §5).
- **雨量 Excel → CSV 喂模型**: `convert.py rain.xlsx -t csv`, or read into context: `markitdown rain.xlsx -o rain.md`.
- **汇报 PPT → PDF 存档**: `convert.py 汇报.pptx -t pdf`.
- **旧版 .doc/.xls/.ppt 批量转新版**: `convert.py old.doc -t docx` (LibreOffice). Loop over a directory.
- **多份 PDF 合并 / 拆分**: `convert.py merge a.pdf b.pdf -o all.pdf` / `convert.py split all.pdf`.

## 5. Gotchas

- **CJK (中文) → PDF needs a CJK font installed**, or LibreOffice renders boxes/tofu. `doctor.py` checks for one. On a minimal server install `apt install fonts-noto-cjk` (Linux) or ensure Windows/macOS has Microsoft YaHei / PingFang. This is the #1 failure for Chinese hydrology docs.
- **`.doc`/`.xls`/`.ppt` (legacy binary) can only be read by LibreOffice**, not pandoc/openpyxl/python-pptx. Always convert legacy → modern first.
- **openpyxl writes formulas with no cached values** — after generating xlsx, recalc with the `xlsx` skill's `recalc.py` (LibreOffice) or the file shows blanks in previewers.
- **PDF → editable format is lossy.** Set expectations: extract text/tables, then rebuild. Do not claim fidelity you cannot verify.
- **Verify conversions that will be seen by humans**: render to PDF + images and look at them (`soffice → pdf`, then `pdftoppm`), the same QA loop the `docx`/`pptx` skills use. Never ship a converted file you have not visually checked when layout matters (tables, slides, letters).

## 6. When to use a different skill

| Task | Skill |
|---|---|
| Create/edit a `.docx` with formatting, TOC, tracked changes, comments | `docx` |
| Create/edit `.xlsx` with formulas, formatting, charts; recalc | `xlsx` |
| Create/edit `.pptx` decks, templates, charts | `pptx` |
| PDF forms, OCR, advanced extraction, encryption | `pdf` |
| Multi-author document drafting | `doc-coauthoring` |
| Anything else (convert/extract/merge/split/quick-create) | **this skill** |

## Dependencies

`pandoc` · LibreOffice (`soffice`) · Poppler (`pdftotext`, `pdftoppm`) · `qpdf` (optional) · `tesseract` (optional, OCR) · Python: `markitdown[all]`, `pypdf`, `pdfplumber`, `pandas`, `openpyxl`, `reportlab`, `python-pptx`, `Pillow` · Node: `docx`, `pptxgenjs` (only if creating new docx/pptx). See `scripts/doctor.py`.

---
description: "Quick office/PDF document task — convert, extract, merge, split, or create Word/Excel/PPT/PDF/HTML/Markdown/CSV. Handles format-to-format conversion and mutual conversion between office formats."
argument-hint: "<task or file path>"
---
Handle a document task: $ARGUMENTS

This prompt covers the *quick* path: format conversion, content extraction, PDF page ops, and light creation. It does NOT replace the dedicated `docx` / `xlsx` / `pptx` / `pdf` skills for deep formatting work — if the task is "build a formatted report / spreadsheet with formulas / slide deck", load that skill instead.

## Workflow

1. **Read the `doc-convert` skill first.** Run `/skill:doc-convert` (or `read` its SKILL.md) before doing anything, so you use the correct engine per format pair. Do not guess engines from memory.

2. **Classify the task** from `$ARGUMENTS` and history:
   - **convert** — one format to another (docx→pdf, xlsx→csv, pdf→txt, pptx→pdf, md→docx, doc→docx, xls→xlsx, …)
   - **extract** — pull text/tables out of a document into the conversation or a file
   - **merge / split / rotate** — PDF page operations
   - **create (light)** — a simple one-off doc/sheet from given content (for anything non-trivial, defer to the dedicated skill)
   - **edit (deep)** — STOP and load the dedicated `docx`/`xlsx`/`pptx`/`pdf` skill instead.

3. **Check the toolchain once** if you haven't this session:
   ```bash
   python .pi/skills/doc-convert/scripts/doctor.py
   ```
   If it reports a required tool missing, tell the user the exact install command (`doctor.py --fix` prints it; or run `install/install.sh` / `install/install.ps1`), and stop until they install it or confirm to proceed without. Do not attempt conversions you know will fail.

4. **Run the conversion** via the router for the common 80%:
   ```bash
   python .pi/skills/doc-convert/scripts/convert.py <input> -t <ext> [-o output]
   python .pi/skills/doc-convert/scripts/convert.py merge a.pdf b.pdf -o out.pdf
   python .pi/skills/doc-convert/scripts/convert.py split in.pdf
   python .pi/skills/doc-convert/scripts/convert.py rotate in.pdf 90 -o out.pdf
   ```
   For pairs the router does not cover, follow the engine matrix in the `doc-convert` SKILL.md and call the engine directly (pandoc / markitdown / soffice / pdftotext / qpdf).

5. **Verify output before declaring success.**
   - For anything a human will look at (PDF, docx, xlsx, pptx): render to PDF + images and inspect them — `soffice --headless --convert-to pdf <file>`, then `pdftoppm -jpeg -r 100 <pdf> <prefix>`, then read the images. Check text overflow, CJK rendering (tofu boxes = missing CJK font), table layout, page count.
   - For extraction: read the produced `.md`/`.txt` and confirm it captured the content the user asked about; if a scanned PDF returned garbage, say so and offer OCR (`tesseract` via the `pdf` skill).
   - For PDF ops: confirm the page count of the result matches expectations.

6. **Report** the absolute output path(s), what engine was used, and any caveats (e.g. "PDF→docx is lossy: layout was not preserved, only text and tables"). If you converted to PDF and CJK text may be involved, explicitly state whether CJK rendered correctly in your QA images.

## Rules

- Always say which engine you used and why (transparency over magic).
- PDF is a terminal format: never claim a clean PDF→editable round-trip. Set expectations to "lossy text/table extraction".
- Legacy `.doc`/`.xls`/`.ppt` must go through LibreOffice first; pandoc/openpyxl/python-pptx cannot read them.
- If `$ARGUMENTS` is empty or ambiguous, ask the user for the input file path and the desired output format/intent before running anything.
- Do not install system packages (pandoc/LibreOffice) without telling the user; `doctor.py --fix` only *prints* the commands. Let the user run them.
- For Chinese (中文) documents going to PDF, verify a CJK font rendered — this is the single most common silent failure for hydrology reports.

#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

import pdfplumber


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_page_text(text: str, max_chars: int = 1600):
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks = []
    current = []
    current_len = 0

    for paragraph in paragraphs:
      if current and current_len + len(paragraph) + 2 > max_chars:
        chunks.append("\n\n".join(current))
        current = [paragraph]
        current_len = len(paragraph)
      else:
        current.append(paragraph)
        current_len += len(paragraph) + 2

    if current:
      chunks.append("\n\n".join(current))

    return chunks


def build_page_records(path: Path):
    with pdfplumber.open(path) as pdf:
        pages = []
        for idx, page in enumerate(pdf.pages, start=1):
            text = normalize_text(page.extract_text() or "")
            if not text:
                continue
            page_chunks = chunk_page_text(text)
            pages.append(
                {
                    "pageNumber": idx,
                    "chunks": [
                        {
                            "pageNumber": idx,
                            "chunkIndex": chunk_index,
                            "heading": text.split("\n", 1)[0][:200],
                            "content": chunk_text,
                            "metadata": {},
                        }
                        for chunk_index, chunk_text in enumerate(page_chunks)
                    ],
                }
            )
        return {
            "title": path.stem,
            "pageCount": len(pdf.pages),
            "pages": pages,
        }


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: extract_pdf_chunks.py <pdf_path>")

    path = Path(sys.argv[1]).expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"File not found: {path}")

    payload = build_page_records(path)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()

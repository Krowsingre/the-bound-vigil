import sys
from pypdf import PdfReader

pages = PdfReader(sys.argv[1]).pages
assert len(pages) > 0
assert any("Initial words" in page.extract_text() for page in pages)

"""Build the complete Fiji Master write-back Apps Script (one file to paste)."""
from pathlib import Path
import argparse
p = argparse.ArgumentParser(); p.add_argument('output'); args = p.parse_args()
root = Path(__file__).resolve().parents[1]
Path(args.output).write_text(
    '// Complete Fiji Master write-back Apps Script. Paste this entire file over all existing code. Preserve all Script Properties.\n'
    + (root / 'apps-script/master-writeback.gs').read_text() + '\n'
    + (root / 'apps-script/news-events.gs').read_text())
print(args.output)

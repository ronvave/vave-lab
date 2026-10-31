"""Build the complete Vanuatu Master write-back Apps Script (one file to paste)."""
from pathlib import Path
import argparse
p = argparse.ArgumentParser(); p.add_argument('output'); args = p.parse_args()
root = Path(__file__).resolve().parents[1]
Path(args.output).write_text(
    '// Complete Vanuatu Master write-back Apps Script. Paste this entire file over all existing code in the main code file (the one with doPost). Leave the other project files as they are. Preserve all Script Properties.\n'
    + (root / 'apps-script/vanuatu-master-writeback.gs').read_text() + '\n'
    + (root / 'apps-script/vanuatu-news.gs').read_text() + '\n'
    + (root / 'apps-script/news-events.gs').read_text())
print(args.output)

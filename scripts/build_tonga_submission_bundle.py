"""Build the complete Tonga Apps Script source without private configuration."""
from pathlib import Path
import argparse
p=argparse.ArgumentParser();p.add_argument('output');args=p.parse_args()
root=Path(__file__).resolve().parents[1]
backend=(root/'apps-script/deployed/tonga-submissions-v1.gs').read_text()
verifier=(root/'apps-script/vendor/tonga-jwt.gs').read_text()
Path(args.output).write_text('// Complete Tonga review backend v4. Preserve all existing Script Properties.\n'+verifier+'\n'+backend)
print(args.output)

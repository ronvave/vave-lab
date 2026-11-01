#!/usr/bin/env python3
"""Serve /tmp/kit/preview/<key> over the repo (overlay first, repo second).
    python3 scripts/country_kit/serve_preview.py 8766 cook fsm"""
import http.server, sys, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PORT = int(sys.argv[1]); KEYS = sys.argv[2:]
OVERLAYS = [Path(os.environ.get("KIT_OVERLAY_ROOT", "/tmp/kit/preview")) / k for k in KEYS]

class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        for o in OVERLAYS:
            p = o / rel
            if rel and p.exists():
                return str(p)
        return str(ROOT / rel)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()

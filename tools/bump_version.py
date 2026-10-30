#!/usr/bin/env python3
"""Erhöht die Cache-Version (?v=N) in web/index.html und allen Modulen unter web/js/."""
import pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent / 'web'
files = [root / 'index.html', *sorted((root / 'js').glob('*.js'))]
current = max(int(v) for f in files for v in re.findall(r'\?v=(\d+)', f.read_text()))
new = current + 1
for f in files:
    f.write_text(re.sub(r'\?v=\d+', f'?v={new}', f.read_text()))
print(f'Version {current} -> {new}')

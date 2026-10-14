"""
Replace ComicReader's hardcoded alpha-white chrome with theme tokens.

The comic reader painted its UI with a fixed dark palette (`text-white/*`,
`bg-white/*`, `bg-black/*`) regardless of the selected reading theme, so it
ignored the app theme entirely and looked like a different app from the EPUB
reader. This maps each raw alpha-white step onto the theme tokens that the EPUB
reader already uses, verified against the inventory taken before the edit.

Run once; it is idempotent-guarded (no-op if the tokens are already present).
"""
import io
import re
import sys

PATH = r"D:\Wafig\Hermes\kora-repo\src\components\ComicReader.tsx"
src = io.open(PATH, encoding="utf-8").read()

# Guard on the BULK migration specifically: the top bar was themed by hand
# before this script ran, so "activeTheme.text" appearing in the file does not
# mean the alpha ramp was already replaced.
if "text-kindle-text-muted" in src:
    print("already migrated — nothing to do")
    sys.exit(0)

# Ordered longest-first so e.g. text-white/80 is not clipped by text-white/8.
MAP = [
    # primary text
    ("text-white/90", "text-kindle-text"),
    ("text-white/80", "text-kindle-text"),
    ("text-white/75", "text-kindle-text"),
    ("text-white/70", "text-kindle-text/80"),
    # secondary / tertiary
    ("text-white/60", "text-kindle-text-muted"),
    ("text-white/50", "text-kindle-text-muted"),
    ("text-white/40", "text-kindle-text-muted/70"),
    ("text-white/35", "text-kindle-text-muted/60"),
    # borders
    ("border-white/25", "border-kindle-border"),
    ("border-white/20", "border-kindle-border"),
    ("border-white/10", "border-kindle-border"),
    # fills (hover / chip / track)
    ("bg-white/70", "bg-kindle-text/70"),
    ("bg-white/25", "bg-kindle-text/25"),
    ("bg-white/15", "bg-kindle-text/15"),
    ("bg-white/10", "bg-kindle-text/10"),
    # surfaces
    ("bg-black/95", "bg-kindle-card"),
    ("bg-black/85", "bg-kindle-card"),
    ("bg-black/80", "bg-kindle-card"),
    ("bg-black", "bg-kindle-bg"),
    # native control accent
    ("accent-white", "accent-kindle-accent"),
]

counts = {}
for raw, token in MAP:
    n = src.count(raw)
    if n:
        counts[raw] = n
        src = src.replace(raw, token)

# Segmented-control "selected" pill was `bg-white text-black` — a fixed
# light-on-dark chip regardless of theme.
n = src.count("bg-white text-black")
if n:
    counts["bg-white text-black"] = n
    src = src.replace("bg-white text-black", "bg-kindle-text text-kindle-bg shadow")

io.open(PATH, "w", encoding="utf-8", newline="").write(src)

print("replacements applied:")
for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
    print(f"   {v:3}x  {k}")

left = re.findall(r"(?:text|bg|border|accent)-white/[0-9]+|(?:text|bg)-black(?:/[0-9]+)?|accent-white", src)
print(f"\nremaining raw white/black utilities: {len(left)}")
for x in sorted(set(left)):
    print("   ", x)
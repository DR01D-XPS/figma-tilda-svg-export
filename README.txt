Root-based v3.
Fixes common runtime crash:
- Mixed text props in Figma are Symbols (figma.mixed). We guard lineHeight/letterSpacing/fontSize.
- UTF-8 decoding fallback if TextDecoder missing.
- Export frames even if they contain nested frames.

Install: Plugins → Development → Import plugin from manifest… (manifest.json)

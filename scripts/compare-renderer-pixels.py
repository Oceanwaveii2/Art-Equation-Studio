import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

root = Path(sys.argv[1])
with Image.open(root / 'classic.png') as source:
    classic = source.convert('RGBA')
with Image.open(root / 'hybrid.png') as source:
    hybrid = source.convert('RGBA')
if classic.size != hybrid.size:
    raise ValueError('Renderer screenshot dimensions differ')
histogram = ImageChops.difference(classic, hybrid).histogram()
channels = classic.width * classic.height * 4
total = sum((i % 256) * count for i, count in enumerate(histogram))
maximum = max(i % 256 for i, count in enumerate(histogram) if count)
over32 = sum(count for i, count in enumerate(histogram) if i % 256 > 32)
if max(high - low for low, high in classic.getextrema()[:3]) < 100:
    raise ValueError('Reference capture is blank or contains no expected artwork')
print(json.dumps({'width': classic.width, 'height': classic.height,
                 'channels': channels, 'meanError': total / channels,
                 'maxError': maximum, 'over32Fraction': over32 / channels,
                 'capture': 'browser compositor PNG; RGBA8 comparison',
                 'exactPixelMatch': total == 0}))

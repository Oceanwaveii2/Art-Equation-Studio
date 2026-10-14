import { execSync } from 'node:child_process'
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const contentDir = 'C:/Users/User/Downloads/Testing Art Equation/Real Time Board  Ultra Graph Test 1/Content'
const outputDir = 'D:/0/Art_Equation_Studio_2026-08-27_v81-combined-with-desktop-scope/desktop-app/artifacts/recreation/miro_assets'

mkdirSync(outputDir, { recursive: true })

console.log('=== Step 1: Processing Content Directory Assets ===')
const files = readdirSync(contentDir)

// 1. Process MP4 videos: extract high quality poster frames
const mp4Files = files.filter(f => f.toLowerCase().endsWith('.mp4'))
console.log(`Found ${mp4Files.length} MP4 videos. Extracting poster frames...`)

for (const mp4 of mp4Files) {
  const inputPath = join(contentDir, mp4)
  const safeName = mp4.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
  const posterPng = join(outputDir, `${safeName}_poster.png`)
  try {
    execSync(`ffmpeg -y -ss 00:00:03 -i "${inputPath}" -vframes 1 "${posterPng}"`, { stdio: 'ignore' })
    console.log(`✔ Extracted poster for: ${mp4}`)
  } catch (err) {
    execSync(`ffmpeg -y -ss 00:00:00 -i "${inputPath}" -vframes 1 "${posterPng}"`, { stdio: 'ignore' })
  }
}

// 2. Convert all images to canonical sRGB premultiplied RGBA8 buffers
console.log('\n=== Step 2: Converting Images to Canonical Premultiplied RGBA8 (Max Edge 512px) ===')

const pyScript = `
import os
import json
import re
import numpy as np
from PIL import Image

content_dir = r"${contentDir.replace(/\//g, '\\\\')}"
output_dir = r"${outputDir.replace(/\//g, '\\\\')}"

files = os.listdir(content_dir)
manifest = {}

# Also include extracted video posters
for f in os.listdir(output_dir):
    if f.endswith('_poster.png'):
        files.append(os.path.join(output_dir, f))

MAX_EDGE = 512

for item in files:
    if item.endswith('.mp4'):
        continue
    if os.path.isabs(item):
        src_path = item
        fname = os.path.basename(item)
    else:
        src_path = os.path.join(content_dir, item)
        fname = item

    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', os.path.splitext(fname)[0]).lower()
    raw_fname = f"{safe_id}.rgba"
    raw_path = os.path.join(output_dir, raw_fname)

    try:
        im = Image.open(src_path).convert('RGBA')
        w, h = im.size
        
        # Scale to max edge 512px with high-quality Lanczos resampling
        if max(w, h) > MAX_EDGE:
            scale = MAX_EDGE / max(w, h)
            nw = max(1, int(round(w * scale)))
            nh = max(1, int(round(h * scale)))
            im = im.resize((nw, nh), Image.Resampling.LANCZOS)
            w, h = nw, nh

        raw_bytes = im.tobytes()
        
        # Convert to canonical sRGB premultiplied RGBA8: R <= A, G <= A, B <= A
        arr = np.frombuffer(raw_bytes, dtype=np.uint8).reshape((h, w, 4)).astype(np.float32)
        alpha = arr[:, :, 3:4] / 255.0
        arr[:, :, :3] = np.round(arr[:, :, :3] * alpha)
        
        # Clamp strictly so rounding never causes R > A, G > A, B > A
        arr[:, :, 0] = np.minimum(arr[:, :, 0], arr[:, :, 3])
        arr[:, :, 1] = np.minimum(arr[:, :, 1], arr[:, :, 3])
        arr[:, :, 2] = np.minimum(arr[:, :, 2], arr[:, :, 3])
        
        premul_bytes = arr.astype(np.uint8).tobytes()

        with open(raw_path, 'wb') as rf:
            rf.write(premul_bytes)

        manifest[safe_id] = {
            "sourceFile": fname,
            "raw": raw_fname,
            "width": w,
            "height": h,
            "bytes": len(premul_bytes)
        }
    except Exception as e:
        print(f"Error processing {fname}: {e}")

with open(os.path.join(output_dir, "manifest.json"), "w", encoding="utf-8") as mf:
    json.dump(manifest, mf, indent=2)

total_mb = sum(info["bytes"] for info in manifest.values()) / (1024 * 1024)
print(f"Total processed textures: {len(manifest)}, Total uncompressed memory: {total_mb:.2f} MiB (Budget <= 64 MiB)")
`

writeFileSync(join(outputDir, 'process_images.py'), pyScript, 'utf8')
execSync(`python "${join(outputDir, 'process_images.py')}"`, { stdio: 'inherit' })

console.log('\n✔ All Miro assets prepared successfully in miro_assets/!')

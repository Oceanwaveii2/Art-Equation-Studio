/**
 * Prepare Ultra Graph Test 1 V2 Assets
 *
 * Ingests the 25 authentic card crops from assets/card_crops_v2/,
 * the high-resolution video frames & filmstrips from assets/video_frames/,
 * and converts them to canonical premultiplied sRGB RGBA8 raw textures.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const testPackageDir = 'C:/Users/User/Downloads/Testing Art Equation/Real Time Board  Ultra Graph Test 1'
const cardCropsDir = join(testPackageDir, 'assets/card_crops_v2')
const videoFramesDir = join(testPackageDir, 'assets/video_frames')
const outputDir = 'C:/Users/User/Downloads/Art_Equation_Studio_2026-08-27_v81-combined-with-desktop-scope/desktop-app/artifacts/recreation/miro_assets_v2'

mkdirSync(outputDir, { recursive: true })

console.log('=== Ingesting Authentic Card Crops & Video Frames ===')

const pyScript = `
import os
import json
import re
import numpy as np
from PIL import Image

card_dir = r"${cardCropsDir.replace(/\//g, '\\\\')}"
video_dir = r"${videoFramesDir.replace(/\//g, '\\\\')}"
output_dir = r"${outputDir.replace(/\//g, '\\\\')}"

manifest = {}

def process_file(src_path, prefix=""):
    fname = os.path.basename(src_path)
    base_id = os.path.splitext(fname)[0]
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', f"{prefix}{base_id}").lower()
    raw_fname = f"{safe_id}.rgba"
    raw_path = os.path.join(output_dir, raw_fname)

    im = Image.open(src_path).convert('RGBA')
    orig_w, orig_h = im.size
    
    # Cap edge to 640px to stay well within 64 MiB memory budget while retaining crystal-clear detail
    MAX_EDGE = 640
    if max(orig_w, orig_h) > MAX_EDGE:
        scale = MAX_EDGE / max(orig_w, orig_h)
        nw = max(1, int(round(orig_w * scale)))
        nh = max(1, int(round(orig_h * scale)))
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
        w, h = nw, nh
    else:
        w, h = orig_w, orig_h

    raw_bytes = im.tobytes()
    arr = np.frombuffer(raw_bytes, dtype=np.uint8).reshape((h, w, 4)).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    arr[:, :, :3] = np.round(arr[:, :, :3] * alpha)
    arr[:, :, 0] = np.minimum(arr[:, :, 0], arr[:, :, 3])
    arr[:, :, 1] = np.minimum(arr[:, :, 1], arr[:, :, 3])
    arr[:, :, 2] = np.minimum(arr[:, :, 2], arr[:, :, 3])
    
    premul_bytes = arr.astype(np.uint8).tobytes()

    with open(raw_path, 'wb') as rf:
        rf.write(premul_bytes)

    manifest[safe_id] = {
        "sourceFile": fname,
        "raw": raw_fname,
        "intrinsicWidth": orig_w,
        "intrinsicHeight": orig_h,
        "width": w,
        "height": h,
        "bytes": len(premul_bytes),
        "aspectRatio": orig_w / orig_h
    }
    print(f"[OK] Processed {fname} -> {safe_id} ({w}x{h}, {len(premul_bytes)} bytes)")

# 1. Process 25 authentic card crops
if os.path.exists(card_dir):
    for f in os.listdir(card_dir):
        if f.lower().endswith(('.png', '.jpg', '.jpeg')):
            process_file(os.path.join(card_dir, f), prefix="crop_")

# 2. Process video frames and filmstrips
if os.path.exists(video_dir):
    for f in os.listdir(video_dir):
        if f.lower().endswith(('.png', '.jpg', '.jpeg')):
            process_file(os.path.join(video_dir, f), prefix="vid_")

manifest_path = os.path.join(output_dir, 'manifest_v2.json')
with open(manifest_path, 'w', encoding='utf-8') as mf:
    json.dump(manifest, mf, indent=2)

total_bytes = sum(item['bytes'] for item in manifest.values())
print(f"\\n[OK] Manifest saved to {manifest_path}")
print(f"[OK] Total textures: {len(manifest)}, Total memory: {total_bytes / (1024*1024):.2f} MiB (Budget limit: 64.0 MiB)")
`

execFileSync('python', ['-c', pyScript], { stdio: 'inherit' })

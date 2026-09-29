#!/bin/bash
# 从 build/icon.svg（全出血版，与 web favicon 同设计）+ icon-mac.svg（Apple 留白版）
# 重新生成三端打包图标：
#   build/icon.png   1024 通用 PNG（fallback）
#   build/icon.icns  macOS（824/1024 留白 squircle，iconutil 生成）
#   build/icon.ico   Windows（16-256 七档，PNG-in-ICO）
#   build/icons/     Linux hicolor（16-512 九档）
# 依赖：rsvg-convert（brew librsvg）、iconutil（macOS 自带）、python3
set -euo pipefail
cd "$(dirname "$0")"

rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png

rm -rf icon.iconset && mkdir icon.iconset
for spec in "16:icon_16x16.png" "32:icon_16x16@2x.png" "32:icon_32x32.png" \
            "64:icon_32x32@2x.png" "128:icon_128x128.png" "256:icon_128x128@2x.png" \
            "256:icon_256x256.png" "512:icon_256x256@2x.png" "512:icon_512x512.png" \
            "1024:icon_512x512@2x.png"; do
  rsvg-convert -w "${spec%%:*}" -h "${spec%%:*}" icon-mac.svg -o "icon.iconset/${spec#*:}"
done
iconutil -c icns icon.iconset -o icon.icns && rm -rf icon.iconset

rm -rf icons && mkdir -p icons
for size in 16 24 32 48 64 96 128 256 512; do
  rsvg-convert -w "$size" -h "$size" icon.svg -o "icons/${size}x${size}.png"
done

python3 - <<'PY'
import struct, subprocess
sizes = [16, 24, 32, 48, 64, 128, 256]
pngs = []
for s in sizes:
    p = f'/tmp/nf-ico-{s}.png'
    subprocess.run(['rsvg-convert','-w',str(s),'-h',str(s),'icon.svg','-o',p],check=True)
    pngs.append((s, open(p,'rb').read()))
out = struct.pack('<HHH', 0, 1, len(pngs))
offset = 6 + 16*len(pngs)
entries = b''
for s, data in pngs:
    entries += struct.pack('<BBBBHHII', 0 if s>=256 else s, 0 if s>=256 else s, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open('icon.ico','wb').write(out + entries + b''.join(d for _,d in pngs))
print('icon.ico ok')
PY

echo "done: icon.png / icon.icns / icon.ico / icons/ 均已重新生成"

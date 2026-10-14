These explicit test fonts are downloaded from the official Google Fonts repository and licensed under the adjacent SIL Open Font License files. They are real shaping fixtures, not a substitute for installed app font families.

- NotoSans-wdth-wght.ttf: https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf
  SHA-256 bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d
- NotoSansArabic-wdth-wght.ttf: https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf
  SHA-256 63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e

Copies under docs/engine-p0/2026-10-03/shaped-text/fixtures remain preserved. These engine-local inputs make Rust include_bytes! fixtures part of the engine source manifest. Native Windows TTC and font receipts are runtime environment evidence; Windows font files are not redistributed here.

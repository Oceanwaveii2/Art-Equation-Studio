import fs from 'node:fs';

fs.copyFileSync('desktop-app/prototypes/ui-workspace-2026-09-30/MediaHealthReview.tsx', 'desktop-app/src/media/MediaHealthReview.tsx');
fs.copyFileSync('desktop-app/prototypes/ui-workspace-2026-09-30/MediaHealthReview.css', 'desktop-app/src/media/MediaHealthReview.css');

let afr = fs.readFileSync('desktop-app/prototypes/ui-workspace-2026-09-30/ArtworkFramingReview.tsx', 'utf8');
afr = afr.replace("import house from './assets/house.svg'", "import house from '../assets/house.svg'");
fs.writeFileSync('desktop-app/src/media/ArtworkFramingReview.tsx', afr, 'utf8');
fs.copyFileSync('desktop-app/prototypes/ui-workspace-2026-09-30/ArtworkFramingReview.css', 'desktop-app/src/media/ArtworkFramingReview.css');

console.log('Successfully set up MediaHealthReview and ArtworkFramingReview in src/media');

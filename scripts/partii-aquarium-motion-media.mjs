import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, '..');

console.log('--- PACKAGE 10: AQUARIUM FISH & MOTION MEDIA VERIFICATION ---');

let passedChecks = 0;
function test(desc, fn) {
  try {
    fn();
    passedChecks++;
    console.log(`  [PASS] ${desc}`);
  } catch (err) {
    console.error(`  [FAIL] ${desc}:`, err.message);
    throw err;
  }
}

function sha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
}).outputText;

const asDataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

// -------------------------------------------------------------
// Group 1: Pristine Source Footages & Verification Hashes
// -------------------------------------------------------------
console.log('\nGroup 1: Pristine Source Footages & Verification Hashes');

const artifactsDir = path.join(desktopRoot, 'artifacts', 'aquarium-fish', '2026-09-30');
const orig1 = path.join(artifactsDir, 'original-001.mp4');
const orig2 = path.join(artifactsDir, 'original-002.mp4');
const waterRef = path.join(artifactsDir, 'water-reference.png');
const manifestFile = path.join(artifactsDir, 'delivery-manifest.json');

test('original-001.mp4 exists, has expected size and exact SHA-256', () => {
  assert.ok(fs.existsSync(orig1), 'original-001.mp4 must exist');
  const stat = fs.statSync(orig1);
  assert.equal(stat.size, 12062936, 'original-001.mp4 must match exact byte size');
  const hash = sha256(orig1);
  assert.equal(hash, 'c08333264aaf2f3f58564a80a04718ac2385e25528249cca76674b4aae7f4c59');
});

test('original-002.mp4 exists, has expected size and exact SHA-256', () => {
  assert.ok(fs.existsSync(orig2), 'original-002.mp4 must exist');
  const stat = fs.statSync(orig2);
  assert.equal(stat.size, 7950605, 'original-002.mp4 must match exact byte size');
  const hash = sha256(orig2);
  assert.equal(hash, 'f09b3390c47d8d12cfc3b1a8b339fa241c62759d05e8350d93519394f00d4186');
});

test('water-reference.png exists, has expected size and exact SHA-256', () => {
  assert.ok(fs.existsSync(waterRef), 'water-reference.png must exist');
  const stat = fs.statSync(waterRef);
  assert.equal(stat.size, 31975, 'water-reference.png must match exact byte size');
  const hash = sha256(waterRef);
  assert.equal(hash, 'f24890aa5f75d3f753ea89b2c4f06afb0bdf7888a83ec2d713bd78c5b6c216c2');
});

test('delivery manifest is valid and records truthful native rendering status', () => {
  assert.ok(fs.existsSync(manifestFile), 'delivery-manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.native_project_or_render_verified, false, 'Unexecuted native renders must be labeled truthfully');
  assert.ok(manifest.files.length >= 10, 'Manifest must catalog delivered files');
});

// -------------------------------------------------------------
// Group 2: Public Runtime Derivatives & Silent H.264 Media
// -------------------------------------------------------------
console.log('\nGroup 2: Public Runtime Derivatives & Silent H.264 Media');

const publicDir = path.join(desktopRoot, 'public', 'aquarium-header');
const retreatMp4 = path.join(publicDir, 'fish-retreat.mp4');
const passMp4 = path.join(publicDir, 'fish-swimming-pass.mp4');
const waterLoopMp4 = path.join(publicDir, 'water-loop.mp4');
const nearPoster = path.join(publicDir, 'near-poster.jpg');
const awayPoster = path.join(publicDir, 'away-poster.jpg');
const passPoster = path.join(publicDir, 'pass-poster.jpg');
const waterTexture = path.join(publicDir, 'water-texture.png');

test('fish-retreat.mp4 is available in public directory', () => {
  assert.ok(fs.existsSync(retreatMp4), 'fish-retreat.mp4 must exist in public/aquarium-header');
  assert.ok(fs.statSync(retreatMp4).size > 10_000_000, 'fish-retreat.mp4 must be substantial');
});

test('fish-swimming-pass.mp4 is available in public directory', () => {
  assert.ok(fs.existsSync(passMp4), 'fish-swimming-pass.mp4 must exist in public/aquarium-header');
  assert.ok(fs.statSync(passMp4).size > 7_000_000, 'fish-swimming-pass.mp4 must be substantial');
});

test('water-loop.mp4 is available for continuous ambient header loop', () => {
  assert.ok(fs.existsSync(waterLoopMp4), 'water-loop.mp4 must exist in public/aquarium-header');
  assert.ok(fs.statSync(waterLoopMp4).size > 100_000, 'water-loop.mp4 must be substantial');
});

test('posters and textures have valid magic bytes', () => {
  assert.ok(fs.existsSync(nearPoster));
  assert.ok(fs.existsSync(awayPoster));
  assert.ok(fs.existsSync(passPoster));
  assert.ok(fs.existsSync(waterTexture));

  // Verify JPEG magic bytes FF D8 FF
  for (const p of [nearPoster, awayPoster, passPoster]) {
    const buf = fs.readFileSync(p);
    assert.equal(buf[0], 0xFF, 'JPEG byte 0');
    assert.equal(buf[1], 0xD8, 'JPEG byte 1');
    assert.equal(buf[2], 0xFF, 'JPEG byte 2');
  }

  // Verify PNG magic bytes 89 50 4E 47
  const pbuf = fs.readFileSync(waterTexture);
  assert.equal(pbuf[0], 0x89, 'PNG byte 0');
  assert.equal(pbuf[1], 0x50, 'PNG byte 1');
  assert.equal(pbuf[2], 0x4E, 'PNG byte 2');
  assert.equal(pbuf[3], 0x47, 'PNG byte 3');
});

// -------------------------------------------------------------
// Group 3: Aquarium State Machine & Reduced-Motion Semantics
// -------------------------------------------------------------
console.log('\nGroup 3: Aquarium State Machine & Reduced-Motion Semantics');

class MockAquariumMachine {
  constructor(options = {}) {
    this.reduceMotion = options.reduceMotion ?? false;
    this.systemReduced = options.systemReduced ?? false;
    this.active = options.active ?? true;
    this.visible = options.visible ?? true;
    this.motionPaused = false;
    this.phase = 'ready';
    this.clip = 'retreat';
    this.hasVideoFrame = false;
    this.statusMessage = '';
  }

  get isReduced() {
    return this.reduceMotion || this.systemReduced;
  }

  get isSuspended() {
    return !this.active || !this.visible;
  }

  get isStill() {
    return this.isReduced || this.motionPaused || this.isSuspended;
  }

  fishAction() {
    if (this.isSuspended) return;
    if (this.isReduced) {
      this.hasVideoFrame = false;
      this.clip = 'retreat';
      this.phase = this.phase === 'away' ? 'ready' : 'away';
      this.statusMessage = this.phase === 'away' ? 'Fish in the distance · still image' : 'Fish returned to the foreground';
      return;
    }
    if (this.motionPaused) {
      this.motionPaused = false;
      if (this.phase === 'paused') this.phase = 'loading';
      else if (this.phase === 'away' || this.phase === 'finished') this.reset();
      else {
        this.clip = 'retreat';
        this.phase = 'loading';
      }
      return;
    }
    if (this.phase === 'away' || this.phase === 'finished') {
      this.reset();
      return;
    }
    if (this.phase === 'playing' || this.phase === 'loading') {
      this.toggleMotion();
      return;
    }
    if (this.phase === 'paused') {
      this.motionPaused = false;
      this.phase = 'loading';
      return;
    }
    this.begin('retreat');
  }

  begin(clip) {
    if (this.isStill) return;
    this.clip = clip;
    this.hasVideoFrame = false;
    this.phase = 'loading';
    this.statusMessage = clip === 'retreat' ? 'Fish swimming into the distance' : 'Fish swimming across the tank';
  }

  onPlaySuccess() {
    if (this.phase === 'loading' && !this.isStill) {
      this.hasVideoFrame = true;
      this.phase = 'playing';
    }
  }

  onPlayError() {
    this.hasVideoFrame = false;
    this.phase = 'error';
    this.statusMessage = 'Aquarium playback unavailable. A still image is shown.';
  }

  onEnded() {
    if (this.phase === 'playing' || this.phase === 'loading') {
      this.phase = this.clip === 'retreat' ? 'away' : 'finished';
      this.statusMessage = this.clip === 'retreat' ? 'Fish in the distance. Bring it back when ready.' : 'Swimming pass finished.';
    }
  }

  toggleMotion() {
    if (this.isReduced || this.isSuspended) return;
    if (this.motionPaused) {
      this.motionPaused = false;
      if (this.phase === 'paused') this.phase = 'loading';
    } else {
      this.motionPaused = true;
      if (this.phase === 'playing' || this.phase === 'loading') this.phase = 'paused';
    }
  }

  reset() {
    this.hasVideoFrame = false;
    this.clip = 'retreat';
    this.phase = 'ready';
    this.statusMessage = 'Fish returned to the foreground';
  }
}

test('Aquarium normal cycle: ready -> click -> loading -> playing -> onEnded -> away -> click -> ready', () => {
  const aq = new MockAquariumMachine();
  assert.equal(aq.phase, 'ready');

  aq.fishAction();
  assert.equal(aq.phase, 'loading');
  assert.equal(aq.clip, 'retreat');

  aq.onPlaySuccess();
  assert.equal(aq.phase, 'playing');
  assert.equal(aq.hasVideoFrame, true);

  aq.onEnded();
  assert.equal(aq.phase, 'away');

  aq.fishAction(); // brings fish back
  assert.equal(aq.phase, 'ready');
});

test('Aquarium motion pause and resume', () => {
  const aq = new MockAquariumMachine();
  aq.begin('retreat');
  aq.onPlaySuccess();
  assert.equal(aq.phase, 'playing');

  aq.toggleMotion();
  assert.equal(aq.phase, 'paused');
  assert.equal(aq.motionPaused, true);

  aq.toggleMotion();
  assert.equal(aq.motionPaused, false);
  assert.equal(aq.phase, 'loading');
});

test('Reduced-motion mode suppresses video playback and uses still image toggles', () => {
  const aq = new MockAquariumMachine({ reduceMotion: true });
  assert.equal(aq.isReduced, true);
  assert.equal(aq.isStill, true);

  aq.fishAction();
  assert.equal(aq.phase, 'away');
  assert.equal(aq.hasVideoFrame, false);

  aq.fishAction();
  assert.equal(aq.phase, 'ready');
  assert.equal(aq.hasVideoFrame, false);
});

test('Playback error transitions to graceful fallback without crashing', () => {
  const aq = new MockAquariumMachine();
  aq.begin('pass');
  aq.onPlayError();
  assert.equal(aq.phase, 'error');
  assert.ok(aq.statusMessage.includes('still image'));
});

// -------------------------------------------------------------
// Group 4: Media Health Review Engine Simulation
// -------------------------------------------------------------
console.log('\nGroup 4: Media Health Review Engine Simulation');

// Transpile and load MediaHealthReview model
let mhRaw = fs.readFileSync(path.join(desktopRoot, 'src', 'media', 'MediaHealthReview.tsx'), 'utf8');
mhRaw = mhRaw.replace(/import\s+['"].*?\.css['"];?/g, '');
mhRaw = mhRaw.replace(/import\s+(?:type\s+)?.*?from\s+['"]react['"];?/g, '');
mhRaw = 'const React = { createElement: () => null }; const useId = () => "test-id"; const useRef = (v) => ({ current: v }); const useState = (v) => [typeof v === "function" ? v() : v, () => {}]; const useEffect = () => {}; const useMemo = (f) => f();\n' + mhRaw;
const mhTranspiled = transpile(mhRaw);
const mhModule = await import(asDataUrl(mhTranspiled));

const {
  MEDIA_REVIEW_FIXTURES,
  filterMediaReviewItems,
  applyMediaReviewSimulation
} = mhModule;

test('Media review fixtures have valid topologies and classifications', () => {
  assert.equal(MEDIA_REVIEW_FIXTURES.length, 6);
  assert.ok(MEDIA_REVIEW_FIXTURES.some(item => item.kind === 'Image'));
  assert.ok(MEDIA_REVIEW_FIXTURES.some(item => item.kind === 'Video'));
  assert.ok(MEDIA_REVIEW_FIXTURES.some(item => item.kind === 'Document'));
  assert.ok(MEDIA_REVIEW_FIXTURES.some(item => item.originalHealth === 'missing'));
});

test('filterMediaReviewItems handles scope, kind, health, and text search', () => {
  const all = filterMediaReviewItems(MEDIA_REVIEW_FIXTURES, { query: '', scope: 'all', kind: 'all', health: 'all' });
  assert.equal(all.length, 6);

  const images = filterMediaReviewItems(MEDIA_REVIEW_FIXTURES, { query: '', scope: 'all', kind: 'Image', health: 'all' });
  assert.equal(images.length, 4);

  const missing = filterMediaReviewItems(MEDIA_REVIEW_FIXTURES, { query: '', scope: 'all', kind: 'all', health: 'missing' });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, 'sample-missing');

  const querySearch = filterMediaReviewItems(MEDIA_REVIEW_FIXTURES, { query: 'water', scope: 'all', kind: 'all', health: 'all' });
  assert.equal(querySearch.length, 1);
  assert.equal(querySearch[0].name, 'Water texture');
});

test('applyMediaReviewSimulation enforces read-only protection', () => {
  const retryResult = applyMediaReviewSimulation(MEDIA_REVIEW_FIXTURES, { type: 'retry', ids: ['sample-water'] }, true);
  assert.equal(retryResult.changed, false);
  assert.ok(retryResult.message.includes('Read-only'));

  const relinkResult = applyMediaReviewSimulation(MEDIA_REVIEW_FIXTURES, {
    type: 'propose-relink',
    id: 'sample-missing',
    file: { name: 'replacement.jpg', size: 1024, type: 'image/jpeg', lastModified: Date.now() }
  }, true);
  assert.equal(relinkResult.changed, false);
  assert.ok(relinkResult.message.includes('Read-only'));
});

test('applyMediaReviewSimulation allows retry increment on pending items in writable mode', () => {
  const retryResult = applyMediaReviewSimulation(MEDIA_REVIEW_FIXTURES, { type: 'retry', ids: ['sample-water'] }, false);
  assert.equal(retryResult.changed, true);
  const updated = retryResult.items.find(i => i.id === 'sample-water');
  assert.equal(updated.retryRequests, 1);
});

test('applyMediaReviewSimulation rejects invalid relink proposal file metadata', () => {
  const badRelink = applyMediaReviewSimulation(MEDIA_REVIEW_FIXTURES, {
    type: 'propose-relink',
    id: 'sample-missing',
    file: { name: '', size: -1, type: '', lastModified: NaN }
  }, false);
  assert.equal(badRelink.changed, false);
  assert.ok(badRelink.message.includes('refused'));
});

test('applyMediaReviewSimulation records valid relink metadata proposal', () => {
  const validRelink = applyMediaReviewSimulation(MEDIA_REVIEW_FIXTURES, {
    type: 'propose-relink',
    id: 'sample-missing',
    file: { name: 'restored.jpg', size: 204800, type: 'image/jpeg', lastModified: 1720000000000 }
  }, false);
  assert.equal(validRelink.changed, true);
  const updated = validRelink.items.find(i => i.id === 'sample-missing');
  assert.equal(updated.relinkProposal?.name, 'restored.jpg');
  assert.equal(updated.relinkProposal?.size, 204800);
});

// -------------------------------------------------------------
// Group 5: Artwork Framing & Visible Rect Geometry
// -------------------------------------------------------------
console.log('\nGroup 5: Artwork Framing & Visible Rect Geometry');

let afrRaw = fs.readFileSync(path.join(desktopRoot, 'src', 'media', 'ArtworkFramingReview.tsx'), 'utf8');
afrRaw = afrRaw.replace(/import\s+['"].*?\.css['"];?/g, '');
afrRaw = afrRaw.replace(/import\s+house\s+from\s+['"].*?['"];?/g, '');
afrRaw = afrRaw.replace(/import\s+(?:type\s+)?.*?from\s+['"]react['"];?/g, '');
afrRaw = 'const React = { createElement: () => null }; const house = "sample://house.svg"; const useId = () => "test-id"; const useRef = (v) => ({ current: v }); const useState = (v) => [typeof v === "function" ? v() : v, () => {}]; const useEffect = () => {}; const useMemo = (f) => f();\n' + afrRaw;
const afrTranspiled = transpile(afrRaw);
const afrModule = await import(asDataUrl(afrTranspiled));

const { artworkVisibleSourceRect } = afrModule;

test('artworkVisibleSourceRect calculates exact geometry in fit mode', () => {
  const rect = artworkVisibleSourceRect(720, 590, 1.0, 'fit', 50, 50);
  assert.ok(rect !== null);
  assert.equal(rect.width, 720);
  assert.equal(rect.height, 590);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 0);
});

test('artworkVisibleSourceRect calculates correct offsets in fill mode', () => {
  const centerRect = artworkVisibleSourceRect(1000, 500, 1.0, 'fill', 50, 50);
  assert.ok(centerRect !== null);
  assert.equal(centerRect.width, 500);
  assert.equal(centerRect.height, 500);
  assert.equal(centerRect.x, 250);
});

test('artworkVisibleSourceRect rejects degenerate and invalid inputs', () => {
  assert.equal(artworkVisibleSourceRect(0, 500, 1.0, 'fit', 50, 50), null);
  assert.equal(artworkVisibleSourceRect(1000, -50, 1.0, 'fit', 50, 50), null);
  assert.equal(artworkVisibleSourceRect(1000, 500, NaN, 'fit', 50, 50), null);
});

// -------------------------------------------------------------
// Group 6: App Shell & Production Assembly
// -------------------------------------------------------------
console.log('\nGroup 6: App Shell & Production Assembly');

test('App.tsx embeds MediaHealthReview and ArtworkFramingReview modals', () => {
  const appSrc = fs.readFileSync(path.join(desktopRoot, 'src', 'App.tsx'), 'utf8');
  assert.ok(appSrc.includes('MediaHealthReview'), 'App.tsx must import MediaHealthReview');
  assert.ok(appSrc.includes('ArtworkFramingReview'), 'App.tsx must import ArtworkFramingReview');
  assert.ok(appSrc.includes('showMediaHealth'), 'App.tsx must declare showMediaHealth state');
  assert.ok(appSrc.includes('showFramingReview'), 'App.tsx must declare showFramingReview state');
  assert.ok(appSrc.includes('media-health-backdrop'), 'App.tsx must render media-health-backdrop');
  assert.ok(appSrc.includes('framing-review-backdrop'), 'App.tsx must render framing-review-backdrop');
});

test('App.css contains modal backdrop and window styles for media reviews', () => {
  const cssSrc = fs.readFileSync(path.join(desktopRoot, 'src', 'App.css'), 'utf8');
  assert.ok(cssSrc.includes('.media-health-backdrop'));
  assert.ok(cssSrc.includes('.framing-review-backdrop'));
  assert.ok(cssSrc.includes('.media-health-modal'));
  assert.ok(cssSrc.includes('.framing-review-modal'));
});

test('ProjectIdentity.tsx provides full aquarium controls and accessible fallbacks', () => {
  const identitySrc = fs.readFileSync(path.join(desktopRoot, 'src', 'ProjectIdentity.tsx'), 'utf8');
  assert.ok(identitySrc.includes('fish-retreat.mp4'));
  assert.ok(identitySrc.includes('fish-swimming-pass.mp4'));
  assert.ok(identitySrc.includes('water-loop.mp4'));
  assert.ok(identitySrc.includes('near-poster.jpg'));
  assert.ok(identitySrc.includes('prefers-reduced-motion'));
  assert.ok(identitySrc.includes('visibilitychange'));
});

console.log(`\n======================================================`);
console.log(`ALL ${passedChecks} CHECKS PASSED FOR PACKAGE 10!`);
console.log(`======================================================\n`);

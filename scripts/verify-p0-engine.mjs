import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ENGINE = 'engine/vello-surface';
const FRONTEND = 'src/project-b/p0-surface/generated';
const BINDINGS = [
  'p0_engine_wasm.js',
  'p0_engine_wasm.d.ts',
  'p0_engine_wasm_bg.wasm',
  'p0_engine_wasm_bg.wasm.d.ts',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function validateRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || relative.startsWith('/')) {
    throw new Error(`Unsafe manifest path: ${JSON.stringify(relative)}`);
  }
  const pieces = relative.split('/');
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) {
    throw new Error(`Unsafe manifest path: ${JSON.stringify(relative)}`);
  }
  return pieces;
}

async function safeFile(root, relative) {
  const pieces = validateRelative(relative);
  let filename = root;
  for (const piece of pieces) {
    filename = path.join(filename, piece);
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not accepted in engine inputs: ${relative}`);
  }
  const resolved = await realpath(filename);
  if (!inside(root, resolved)) throw new Error(`Engine input escapes desktop root: ${relative}`);
  if (!(await lstat(resolved)).isFile()) throw new Error(`Expected engine file: ${relative}`);
  return resolved;
}

async function inventory(root, relative, include) {
  validateRelative(relative);
  const directory = path.join(root, relative);
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !inside(root, await realpath(directory))) {
    throw new Error(`Unsafe engine directory: ${relative}`);
  }
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not accepted in engine inputs: ${name}`);
    if (entry.isDirectory()) result.push(...await inventory(root, name, include));
    else if (entry.isFile() && include(name)) result.push(name);
    else if (!entry.isFile()) throw new Error(`Unsupported engine input: ${name}`);
  }
  return result.sort();
}

/** Fingerprint verification, not a substitute for CPU/GPU runtime acceptance. */
export async function verifyEngineManifest(desktopRoot = fileURLToPath(new URL('..', import.meta.url))) {
  const root = await realpath(desktopRoot);
  const manifestPath = `${ENGINE}/SOURCE_MANIFEST.json`;
  const manifestBytes = await readFile(await safeFile(root, manifestPath));
  if (manifestBytes.length > 1_048_576) throw new Error('Engine manifest exceeds its size bound');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!plainObject(manifest) || manifest.schema !== 'art-equation.vello-engine-source' || manifest.schemaVersion !== 1) {
    throw new Error('Unsupported engine source manifest schema');
  }
  if (!plainObject(manifest.files) || !Object.keys(manifest.files).length) throw new Error('Engine manifest files must be a nonempty map');
  if (Object.keys(manifest.files).length > 2_048) throw new Error('Engine manifest exceeds its file count bound');
  const names = Object.keys(manifest.files).map((name) => name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error('Engine manifest contains case-colliding paths');
  if (!plainObject(manifest.engineVersions) || !Object.keys(manifest.engineVersions).length ||
      Object.entries(manifest.engineVersions).some(([key, value]) => !key || typeof value !== 'string' || !value || value.length > 128)) {
    throw new Error('Engine manifest engineVersions must contain version strings');
  }

  const sourceFiles = await inventory(root, `${ENGINE}/rust/src`, () => true);
  if (!sourceFiles.some((name) => name.endsWith('/lib.rs'))) throw new Error('Engine crate lib.rs is missing');
  const required = new Set([`${ENGINE}/rust/Cargo.toml`, `${ENGINE}/rust/Cargo.lock`, ...sourceFiles]);
  // Include build scripts and compile-time fixtures too, without traversing caches or receipts.
  for (const entry of await readdir(path.join(root, ENGINE, 'rust'), { withFileTypes: true })) {
    if (['src', 'target', 'pkg', '.git', '.cargo-home'].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not accepted in engine crate: ${entry.name}`);
    if (entry.isFile() && entry.name !== 'build-verification.json') required.add(`${ENGINE}/rust/${entry.name}`);
    if (entry.isDirectory() && !['src', 'target', 'pkg', '.git', '.cargo-home'].includes(entry.name)) {
      for (const name of await inventory(root, `${ENGINE}/rust/${entry.name}`, () => true)) required.add(name);
    }
  }
  const isBinding = (name) => /\.(?:js|mjs|cjs|ts|wasm)$/.test(name);
  const engineBindings = await inventory(root, `${ENGINE}/generated`, isBinding);
  const frontendBindings = await inventory(root, FRONTEND, isBinding);
  for (const name of [...engineBindings, ...frontendBindings]) required.add(name);
  for (const name of BINDINGS) {
    required.add(`${ENGINE}/generated/${name}`);
    required.add(`${FRONTEND}/${name}`);
  }
  for (const name of required) {
    if (!Object.hasOwn(manifest.files, name)) throw new Error(`Engine manifest omits required input: ${name}`);
  }
  const artifacts = [];
  for (const [relative, expected] of Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))) {
    validateRelative(relative);
    if (!relative.startsWith(`${ENGINE}/rust/`) && !relative.startsWith(`${ENGINE}/generated/`) && !relative.startsWith(`${FRONTEND}/`)) {
      throw new Error(`Unexpected engine manifest input: ${relative}`);
    }
    if (typeof expected !== 'string' || !/^[a-f\d]{64}$/i.test(expected)) throw new Error(`Invalid SHA-256 in engine manifest: ${relative}`);
    const bytes = await readFile(await safeFile(root, relative));
    const actual = sha256(bytes);
    if (actual !== expected.toUpperCase()) throw new Error(`Engine manifest fingerprint mismatch: ${relative}`);
    artifacts.push({ path: relative, bytes: bytes.length, sha256: actual });
  }
  // Copies must be byte-identical, including any future binding files.
  const engineNames = engineBindings.map((name) => name.slice(`${ENGINE}/generated/`.length));
  const frontendNames = frontendBindings.map((name) => name.slice(`${FRONTEND}/`.length));
  if (JSON.stringify(engineNames) !== JSON.stringify(frontendNames)) throw new Error('Engine/frontend generated binding inventories differ');
  for (const name of engineNames) {
    if (manifest.files[`${ENGINE}/generated/${name}`].toUpperCase() !== manifest.files[`${FRONTEND}/${name}`].toUpperCase()) {
      throw new Error(`Engine/frontend generated binding copies differ: ${name}`);
    }
  }
  return {
    schema: 'art-equation.vello-engine-verification', schemaVersion: 1,
    manifest: manifestPath, manifestSha256: sha256(manifestBytes),
    engineVersions: manifest.engineVersions, files: artifacts,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/verify-p0-engine.mjs');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await verifyEngineManifest(), null, 2)); }
    catch (error) { console.error(`P0_ENGINE_VERIFY_FAILED: ${error.message}`); process.exitCode = 1; }
  }
}

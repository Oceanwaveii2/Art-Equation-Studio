import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The disposable C experiment deliberately tests the current implementation,
// while using the authoritative project's already-installed TypeScript runtime.
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const sourceUrl = new URL('../src/board/measuredCardPaint.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: fileURLToPath(sourceUrl),
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
// Runtime imports would make this cease to be a pure numerical unit test.
assert.ok(!/^\s*import\s/m.test(compiled), 'pure helpers must not import a DOM/runtime module');
const { normalizeMeasuredColor, borderBoxSize, reconstructWorldMatrix, normalizeCornerRadii, roundedRectCommands, compileMeasuredSurface } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
for (const helper of [normalizeMeasuredColor, borderBoxSize, reconstructWorldMatrix, normalizeCornerRadii, roundedRectCommands]) assert.equal(typeof helper, 'function');

function near(actual, expected, context = '') {
  assert.ok(Number.isFinite(actual), `${context}: nonfinite result`);
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${context}: ${actual} != ${expected}`);
}
function nearArray(actual, expected, context = '') {
  assert.ok(Array.isArray(actual), `${context}: expected array`);
  assert.equal(actual.length, expected.length, `${context}: length`);
  actual.forEach((value, index) => Array.isArray(expected[index]) ? nearArray(value, expected[index], `${context}[${index}]`) : near(value, expected[index], `${context}[${index}]`));
}
const style = (extra = {}) => ({
  width: '120.5px', height: '80.25px', boxSizing: 'border-box',
  paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px',
  borderLeftWidth: '0px', borderRightWidth: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
  ...extra,
});

// This oracle forwards the four local corners through the supplied true affine
// map. It does not share the implementation's inverse/AABB reconstruction.
function projectedRect(size, matrix, camera, stageOrigin) {
  const [a, b, c, d, e, f] = matrix;
  const corners = [[0, 0], [size.width, 0], [size.width, size.height], [0, size.height]];
  const points = corners.map(([x, y]) => ({
    x: stageOrigin.x + camera.x + camera.scale * (a * x + c * y + e),
    y: stageOrigin.y + camera.y + camera.scale * (b * x + d * y + f),
  }));
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x)), bottom = Math.max(...points.map(point => point.y));
  return { x, y, left: x, top: y, right, bottom, width: right - x, height: bottom - y };
}
function roundTrip(size, matrix, camera, stageOrigin) {
  const rect = projectedRect(size, matrix, camera, stageOrigin);
  const result = reconstructWorldMatrix(rect, size, matrix.slice(0, 4), camera, stageOrigin);
  nearArray(result, matrix, 'reconstructed world matrix');
  const reprojection = projectedRect(size, result, camera, stageOrigin);
  for (const key of ['left', 'top', 'width', 'height']) near(reprojection[key], rect[key], `reprojected ${key}`);
}

test('measured rgb bytes and transparent rgba preserve channel and alpha meaning', () => {
  assert.equal(normalizeMeasuredColor('rgb(12, 34, 56)'), '#0c2238ff');
  assert.equal(normalizeMeasuredColor('rgba(12, 34, 56, 0.5)'), '#0c223880');
  assert.equal(normalizeMeasuredColor('rgba(240, 20, 60, 0)'), '#f0143c00');
});
test('modern rgb slash syntax and fractional channels round only at byte conversion', () => {
  assert.equal(normalizeMeasuredColor('rgb(255 0 128 / 0.25)'), '#ff008040');
  assert.equal(normalizeMeasuredColor('rgb(0.5 1.5 254.5)'), '#0102ffff');
  assert.equal(normalizeMeasuredColor('rgba(1,2,3)'), '#010203ff');
});
test('measured color(srgb) uses unit channels and independent alpha', () => {
  assert.equal(normalizeMeasuredColor('color(srgb 0.125 0.5 0.75)'), '#2080bfff');
  assert.equal(normalizeMeasuredColor('color(srgb 1 0 0.5 / 0.4)'), '#ff008066');
});
test('qualified sRGB values clamp CSS out-of-gamut channels and alpha independently', () => {
  assert.equal(normalizeMeasuredColor('color(srgb 1.5 -0.25 0.5 / 2)'), '#ff0080ff');
  assert.equal(normalizeMeasuredColor('rgb(120% -10% 50% / 20%)'), '#ff008033');
});
test('color normalization tolerates surrounding whitespace without changing values', () => {
  assert.equal(normalizeMeasuredColor('  rgba( 18 , 52 , 86 , 1 )  '), '#123456ff');
});
test('unqualified color spaces and unresolved paint are not guessed as sRGB', () => {
  for (const value of ['color(display-p3 1 0 0)', 'color(rec2020 1 0 0)', 'currentColor', 'var(--node-accent)', 'linear-gradient(red,blue)', 'color-mix(in srgb,red,blue)', 'none']) assert.equal(normalizeMeasuredColor(value), null, value);
});
test('malformed and nonfinite measured colors refuse rather than turn black', () => {
  for (const value of ['', 'rgb(1,2)', 'rgb(NaN 0 0)', 'rgba(1,2,3,Infinity)', 'rgb(1 2 3) trailing', 'color(srgb 1 0)', 'color(srgb NaN 0 0)']) assert.equal(normalizeMeasuredColor(value), null, value);
});

test('border-box measured fractions are not rounded or inflated by padding', () => {
  assert.deepEqual(borderBoxSize(style({ paddingLeft: '11px', borderRightWidth: '7px' })), { width: 120.5, height: 80.25 });
});
test('content-box sums asymmetric fractional padding and borders once', () => {
  assert.deepEqual(borderBoxSize(style({
    boxSizing: 'content-box', paddingLeft: '1.25px', paddingRight: '2.5px', paddingTop: '3.75px', paddingBottom: '4.125px',
    borderLeftWidth: '.5px', borderRightWidth: '.75px', borderTopWidth: '1.125px', borderBottomWidth: '1.5px',
  })), { width: 125.5, height: 90.75 });
});
test('unresolved box dimensions and unsupported sizing modes refuse', () => {
  for (const patch of [{ width: 'auto' }, { height: '50%' }, { width: 'calc(20px + 1px)' }, { boxSizing: 'padding-box' }, { width: 'NaNpx' }, { height: 'Infinitypx' }]) assert.equal(borderBoxSize(style(patch)), null, JSON.stringify(patch));
});
test('negative box terms and numeric overflow refuse', () => {
  for (const patch of [{ width: '-1px' }, { paddingLeft: '-1px', boxSizing: 'content-box' }, { borderTopWidth: '-1px', boxSizing: 'content-box' }, { width: '1e308px', paddingLeft: '1e308px', boxSizing: 'content-box' }]) assert.equal(borderBoxSize(style(patch)), null, JSON.stringify(patch));
});
test('zero-size box measurements do not certify visible paint ownership', () => {
  assert.equal(borderBoxSize(style({ width: '0px' })), null);
  assert.equal(borderBoxSize(style({ height: '0px' })), null);
});

test('world reconstruction independently removes stage origin, pan and all camera scales', () => {
  for (const scale of [.5, 1, 2]) roundTrip({ width: 240.5, height: 160.25 }, [1, 0, 0, 1, 100.125, 80.5], { x: 37.25, y: -19.5, scale }, { x: 291.5, y: 142.25 });
});
test('rotated client AABB does not replace true unrotated border-box size', () => {
  const angle = Math.PI / 6, a = Math.cos(angle), b = Math.sin(angle);
  for (const scale of [.5, 1, 2]) roundTrip({ width: 240, height: 160 }, [a, b, -b, a, 173.39745962155615, 70.7179676972449], { x: -237, y: 119, scale }, { x: 33, y: 61 });
});
test('quarter turns and negative rotations reconstruct exact translation', () => {
  for (const linear of [[0, 1, -1, 0], [0, -1, 1, 0], [-1, 0, 0, -1]]) roundTrip({ width: 83.5, height: 44.125 }, [...linear, -50.75, 17.25], { x: 42, y: -13, scale: 2 }, { x: 300, y: 70 });
});
test('nonorthogonal skew uses all four local corners as independent oracle', () => {
  roundTrip({ width: 80.5, height: 123.25 }, [1, -.35, .6, 1.2, -137.125, 69.75], { x: -8.5, y: 20.25, scale: .5 }, { x: 400.75, y: 188.5 });
});
test('reflections and unequal positive scales preserve orientation', () => {
  for (const linear of [[-1, 0, 0, 1], [1, 0, 0, -1], [-1.3, .2, .4, .8], [2, 0, 0, .75]]) roundTrip({ width: 117.25, height: 39.5 }, [...linear, 9.125, -33.5], { x: 99.5, y: 201.25, scale: 1.5 }, { x: 12.5, y: 61.25 });
});
test('invalid dimensions, nonfinite transforms and nonpositive cameras refuse', () => {
  const size = { width: 10, height: 20 }, linear = [1, 0, 0, 1], camera = { x: 0, y: 0, scale: 1 }, origin = { x: 0, y: 0 };
  const rect = projectedRect(size, [...linear, 0, 0], camera, origin);
  const values = [
    [rect, { width: 0, height: 20 }, linear, camera, origin], [rect, { width: 10, height: -1 }, linear, camera, origin],
    [rect, size, [1, NaN, 0, 1], camera, origin], [rect, size, linear, { ...camera, scale: 0 }, origin],
    [rect, size, linear, { ...camera, scale: -1 }, origin], [rect, size, linear, { ...camera, x: Infinity }, origin],
    [rect, size, linear, camera, { ...origin, y: NaN }], [{ ...rect, left: Infinity, x: Infinity }, size, linear, camera, origin],
  ];
  for (const args of values) assert.equal(reconstructWorldMatrix(...args), null);
});
test('singular affine maps cannot become complete measured ownership', () => {
  const size = { width: 10, height: 20 }, camera = { x: 0, y: 0, scale: 1 }, origin = { x: 0, y: 0 };
  for (const linear of [[0, 0, 0, 0], [1, 2, 2, 4], [1, 0, 0, 0]]) assert.equal(reconstructWorldMatrix(projectedRect(size, [...linear, 0, 0], camera, origin), size, linear, camera, origin), null);
});
test('stale or unrelated transformed AABB dimensions refuse without fabricating translation', () => {
  const size = { width: 80.5, height: 123.25 }, matrix = [1, -.35, .6, 1.2, -137.125, 69.75];
  const camera = { x: -8.5, y: 20.25, scale: .5 }, origin = { x: 400.75, y: 188.5 };
  const rect = projectedRect(size, matrix, camera, origin);
  for (const patch of [{ width: rect.width + .25 }, { height: rect.height - .25 }, { width: size.width, height: size.height }, { width: 0 }, { height: -1 }]) assert.equal(reconstructWorldMatrix({ ...rect, ...patch }, size, matrix.slice(0, 4), camera, origin), null);
});

test('pixel radii preserve distinct corners and elliptical axes', () => {
  nearArray(normalizeCornerRadii(['12px 8px', '20px 14px', '16px 10px', '6px 18px'], { width: 100, height: 80 }), [[12, 8], [20, 14], [16, 10], [6, 18]]);
});
test('percentage corner axes resolve against width and height independently', () => {
  nearArray(normalizeCornerRadii(['25% 50%', '50% 25%', '0px', '12.5%'], { width: 160, height: 80 }), [[40, 40], [80, 20], [0, 0], [20, 10]]);
});
test('one CSS overlap factor scales all eight radii rather than clamping individual corners', () => {
  nearArray(normalizeCornerRadii(['80px 50px', '40px 20px', '30px 40px', '20px 30px'], { width: 100, height: 60 }), [[60, 37.5], [30, 15], [22.5, 30], [15, 22.5]]);
});
test('overlap factor considers bottom and right edges too', () => {
  nearArray(normalizeCornerRadii(['10px 5px', '10px 60px', '90px 40px', '90px 5px'], { width: 100, height: 80 }), [[50 / 9, 25 / 9], [50 / 9, 100 / 3], [50, 200 / 9], [50, 25 / 9]]);
});
test('single lengths duplicate axes but percentages do not duplicate resolved pixels', () => {
  nearArray(normalizeCornerRadii(['7.5px', '10%', '0px 5px', '3px 0px'], { width: 200, height: 100 }), [[7.5, 7.5], [20, 10], [0, 5], [3, 0]]);
});
test('negative, unresolved, nonfinite and malformed radius fields refuse', () => {
  for (const value of ['-1px', 'calc(1px + 2px)', 'NaNpx', 'Infinitypx', '1px 2px 3px', '1px / 2px', 'var(--radius)', '']) assert.equal(normalizeCornerRadii([value, '0px', '0px', '0px'], { width: 100, height: 80 }), null, value);
});

function inspectPath(commands, size) {
  assert.ok(Array.isArray(commands));
  assert.equal(commands[0][0], 'M');
  assert.equal(commands.at(-1)[0], 'Z');
  let previous;
  const curves = [];
  for (const command of commands) {
    assert.ok(['M', 'L', 'C', 'Z'].includes(command[0]), `unexpected command ${command[0]}`);
    assert.equal(command.length, { M: 3, L: 3, C: 7, Z: 1 }[command[0]]);
    for (let i = 1; i < command.length; i += 2) {
      assert.ok(Number.isFinite(command[i]) && Number.isFinite(command[i + 1]));
      assert.ok(command[i] >= -1e-9 && command[i] <= size.width + 1e-9, `x outside local box: ${command[i]}`);
      assert.ok(command[i + 1] >= -1e-9 && command[i + 1] <= size.height + 1e-9, `y outside local box: ${command[i + 1]}`);
    }
    if (command[0] === 'C') curves.push({ from: previous, control1: command.slice(1, 3), control2: command.slice(3, 5), to: command.slice(5, 7) });
    if (command[0] !== 'Z') previous = command.slice(-2);
  }
  return curves;
}
test('rounded rectangle cubic endpoints match each asymmetric corner ellipse', () => {
  const size = { width: 100, height: 80 }, radii = [[12, 8], [20, 14], [16, 10], [6, 18]];
  const curves = inspectPath(roundedRectCommands(size, radii), size);
  assert.equal(curves.length, 4);
  const expected = [[[80, 0], [100, 14]], [[100, 70], [84, 80]], [[6, 80], [0, 62]], [[0, 8], [12, 0]]];
  for (const [from, to] of expected) {
    const curve = curves.find(item => Math.abs(item.from[0] - from[0]) < 1e-9 && Math.abs(item.from[1] - from[1]) < 1e-9);
    assert.ok(curve, `missing corner from ${from}`);
    nearArray(curve.to, to);
    // At an axis-aligned quarter ellipse, each endpoint tangent is exactly
    // horizontal or vertical, independently of the cubic approximation factor.
    assert.ok(curve.control1[0] === from[0] || curve.control1[1] === from[1]);
    assert.ok(curve.control2[0] === to[0] || curve.control2[1] === to[1]);
  }
});
test('zero radii and tiny fractional rectangles produce finite closed local paths', () => {
  inspectPath(roundedRectCommands({ width: .125, height: .375 }, [[0, 0], [0, 0], [0, 0], [0, 0]]), { width: .125, height: .375 });
});
test('CSS-overlap-reduced corner paths remain entirely inside their border box', () => {
  const size = { width: 17.25, height: 8.5 };
  const radii = normalizeCornerRadii(['90% 80%', '100% 70%', '65% 120%', '75% 90%'], size);
  inspectPath(roundedRectCommands(size, radii), size);
});


const surface = (extra={}) => ({role:'article',size:{width:80,height:60},worldMatrix:[1,0,0,1,10,10],layoutBounds:{x:10,y:10,width:80,height:60},radii:[[12,12],[12,12],[12,12],[12,12]],background:'#00ffffff',backgroundImage:'none',opacity:1,borderWidths:[3,3,3,3],borderColors:Array(4).fill('#ff00ffff'),borderStyles:Array(4).fill('solid'),overflowX:'visible',overflowY:'visible',isolation:'auto',blendMode:'normal',boxShadow:'none',filter:'none',backdropFilter:'none',blockers:[],...extra});
test('qualified surface contributes background and evenodd border without complete card ownership',()=>{
 const result=compileMeasuredSurface(surface(),'s');assert.equal(result.completePaint,false);assert.equal(result.operations.length,2);assert.equal(result.operations[1].object.payload.vectorFillRule,'evenodd');assert.deepEqual(result.operations.map(o=>o.object.id),['s:background','s:border']);assert.equal(result.operations[0].object.transform[4],10);
});
test('uncompiled effects, subtree alpha, asymmetry and malformed measurements cannot become surface paint',()=>{
 for(const extra of [{boxShadow:'0 10px 28px black'},{backgroundImage:'linear-gradient(red,blue)'},{filter:'blur(2px)'},{blendMode:'multiply'},{opacity:.5},{borderWidths:[1,2,3,4]},{borderWidths:[NaN,NaN,NaN,NaN]},{size:{width:0,height:60}},{worldMatrix:[1,0,0,1,Infinity,0]},{background:'not-a-color'},{blockers:['TEXT_SHAPING_PENDING']},{borderStyles:['solid','none','solid','none']}]){const result=compileMeasuredSurface(surface(extra),'s');assert.equal(result.completePaint,false);assert.equal(result.operations.length,0);assert.ok(result.blockers.length)}
});
const engine=await import(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm.js',import.meta.url));
await engine.default({module_or_path:await readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm',import.meta.url))});
const snapshot=operations=>({schema:'art-equation.display-list',schemaVersion:2,sceneId:'measured-surface-tests',revision:'1',environment:{background:'#00000000',colorSpace:'srgb'},resources:[],operations});
test('measured rounded surface derivative has exact genuineCPU interior/background/border pixels',()=>{
 const {operations}=compileMeasuredSurface(surface(),'pixels');const pixels=engine.render_cpu_snapshot(128,100,JSON.stringify(snapshot(operations)),1,0,0);const at=(x,y)=>[...pixels.slice((y*128+x)*4,(y*128+x)*4+4)];
 assert.deepEqual(at(40,40),[0,255,255,255]);assert.deepEqual(at(11,40),[255,0,255,255]);assert.deepEqual(at(10,10),[0,0,0,0]);assert.deepEqual(at(0,0),[0,0,0,0]);
});
test('measured contribution uses the same explicit transform and order at both backing scales',()=>{
 const ops=compileMeasuredSurface(surface(),'ordered').operations;for(const backing of [1,2]){const width=128*backing,pixels=engine.render_cpu_snapshot(width,100*backing,JSON.stringify(snapshot(ops)),backing,0,0);const index=(40*backing*width+40*backing)*4;assert.deepEqual([...pixels.slice(index,index+4)],[0,255,255,255])}
});

// Review repro: valid outer CSS radii can overrun the inset corner box.
test('extreme inset corner overlap refuses the entire diagnostic ring',()=>{
 const result=compileMeasuredSurface(surface({size:{width:100,height:100},radii:[[1,1],[99,99],[1,1],[1,1]],borderWidths:[10,10,10,10]}),'inset-overlap');
 assert.equal(result.operations.length,0);assert.equal(result.completePaint,false);assert.ok(result.blockers.includes('INSET_RADIUS_OVERLAP_PENDING'));
});

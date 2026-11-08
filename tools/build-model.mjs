// Builds public/models/icw-nav-aid.glb from the KiCad board and the printed cover.
// Run with npm run model, optionally followed by the path to the icw-nav-aid project.
// The output is in millimetres, centred on the card, with y = 0 at the back of the PCB.
// Each part is a named group so the page can move it on its own.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join as joinPath, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, join, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(process.argv[2] ?? joinPath(here, '../../icw-nav-aid'));
const output = resolve(here, '../public/models/icw-nav-aid.glb');
const kicadCli = process.env.KICAD_CLI ?? 'C:/Program Files/KiCad/10.0/bin/kicad-cli.exe';

const BOARD_SIZE = [85.6, 54.0];
const BOARD_ORIGIN = [100.0, 70.0]; // top left corner of the card on the KiCad sheet
const CENTRE = [BOARD_ORIGIN[0] + BOARD_SIZE[0] / 2, BOARD_ORIGIN[1] + BOARD_SIZE[1] / 2];
const PCB_THICKNESS = 1.6;
const COVER_TOP = PCB_THICKNESS + 6.2; // clear_h + top_t in cover.scad

// KiCad writes every source colour as a metal, so each one is mapped to a real finish.
// The white mask and blue silkscreen come from the board's own stackup.
const FINISHES = {
  '0.53,0.53,0.53': { name: 'metal', metallic: 1, roughness: 0.34, color: '#c9ccd0' },
  '0.00,0.00,0.00': { name: 'marking', metallic: 0, roughness: 0.6 },
  '0.65,0.64,0.57': { name: 'terminal', metallic: 1, roughness: 0.4 },
  '0.78,0.77,0.63': { name: 'ceramic', metallic: 0, roughness: 0.55 },
  '0.01,0.01,0.01': { name: 'resistor', metallic: 0, roughness: 0.4, color: '#1d1d1f' },
  '0.71,0.50,0.21': { name: 'gold', metallic: 1, roughness: 0.35 },
  '0.09,0.42,0.17': { name: 'die', metallic: 0, roughness: 0.5 },
  '0.05,0.05,0.05': { name: 'switch_body', metallic: 0, roughness: 0.5, color: '#2a2c2e' },
  '1.00,1.00,1.00': { name: 'switch_cap', metallic: 0, roughness: 0.45, color: '#f4f2ec' },
  '0.27,0.21,0.21': { name: 'switch_base', metallic: 0, roughness: 0.55 },
  '0.70,0.61,0.00': { name: 'trace', metallic: 0, roughness: 0.5, color: '#e9e6dc' },
  '0.50,0.50,0.50': { name: 'pad', metallic: 1, roughness: 0.3, color: '#d4d6d8' },
  '0.01,0.23,0.64': { name: 'silkscreen', metallic: 0, roughness: 0.7 },
  '0.77,0.77,0.77': { name: 'mask', metallic: 0, roughness: 0.42, color: '#f7f6f1' },
  '0.42,0.45,0.29': { name: 'fr4', metallic: 0, roughness: 0.8 },
};

// Copper sits under the mask in the export. Lifting it a hair shows the traces
// the way they read through a real white mask.
const BOARD_LAYERS = {
  icw_nav_aid_card_copper: 0.025,
  icw_nav_aid_card_pad: 0.05,
  icw_nav_aid_card_silkscreen: 0.03,
};

const COMPONENTS = ['BT1', 'R1', 'R2', 'R3', 'R4', 'D1', 'D2', 'SW1', 'SW2'];

function exportBoard(path) {
  execFileSync(kicadCli, [
    'pcb', 'export', 'glb', '--force', '--subst-models',
    '--include-tracks', '--include-pads', '--include-silkscreen', '--include-soldermask',
    '--output', path, joinPath(project, 'icw_nav_aid_card/icw_nav_aid_card.kicad_pcb'),
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function applyFinish(material) {
  const key = material.getBaseColorFactor().slice(0, 3).map((v) => v.toFixed(2)).join(',');
  const finish = FINISHES[key];
  if (!finish) throw new Error(`No finish for source colour ${key}`);
  material.setName(finish.name).setMetallicFactor(finish.metallic).setRoughnessFactor(finish.roughness);
  material.setAlphaMode('OPAQUE');
  if (finish.color) material.setBaseColorFactor([...new THREE.Color(finish.color).toArray(), 1]);
}

function coverGeometry() {
  const file = readFileSync(joinPath(project, 'icw_nav_aid_card/case/cover.stl'));
  const stl = new STLLoader().parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  const position = stl.getAttribute('position');
  // cover.scad has its origin at the lower left of the card with z up from the PCB top
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    position.setXYZ(i, x - BOARD_SIZE[0] / 2, PCB_THICKNESS + z, BOARD_SIZE[1] / 2 - y);
  }
  stl.deleteAttribute('normal');
  const geometry = toCreasedNormals(stl, THREE.MathUtils.degToRad(28));
  // rounding lets vertices on the same smooth surface weld together
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.array.length; i++) normal.array[i] = Math.round(normal.array[i] * 1e4) / 1e4;
  return geometry;
}

// The logo is only 0.4 mm deep, so white on white it nearly vanishes on screen.
// Darkening the recessed floor stands in for the shading it has in person.
function coverColors(geometry) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const depth = COVER_TOP - position.getY(i);
    const recessed = depth > 0.2 && depth < 0.6;
    colors.set(recessed ? [0.5, 0.46, 0.4] : [1, 1, 1], i * 3);
  }
  return colors;
}

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const workDir = mkdtempSync(joinPath(tmpdir(), 'icw-model-'));
const boardPath = joinPath(workDir, 'board.glb');
exportBoard(boardPath);
const doc = await io.read(boardPath);
rmSync(workDir, { recursive: true, force: true });

const root = doc.getRoot();
const scene = root.listScenes()[0];
const buffer = root.listBuffers()[0];
root.listMaterials().forEach(applyFinish);

// metres to millimetres, once per accessor because meshes are shared between parts
const scaled = new Set();
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    if (scaled.has(position)) continue;
    scaled.add(position);
    const array = position.getArray();
    for (let i = 0; i < array.length; i++) array[i] *= 1000;
  }
}

const allNodes = root.listNodes();
const topLevel = scene.listChildren().flatMap((node) => node.listChildren().length && !node.getName() ? node.listChildren() : [node]);
const byName = (name) => allNodes.find((node) => node.getName() === name);
const card = doc.createNode('card');

for (const ref of COMPONENTS) {
  const node = byName(ref);
  if (!node) throw new Error(`Component ${ref} is missing from the export`);
  const [x, y, z] = node.getTranslation();
  node.setTranslation([x * 1000 - CENTRE[0], y * 1000, z * 1000 - CENTRE[1]]);
  card.addChild(node);
}

// the LEDs get their own lens material so the page can light them
const lens = doc.createMaterial('led_lens')
  .setBaseColorFactor([...new THREE.Color('#f6f1e4').toArray(), 1])
  .setMetallicFactor(0).setRoughnessFactor(0.25);
for (const ref of ['D1', 'D2']) {
  for (const primitive of byName(ref).listChildren()[0].getMesh().listPrimitives()) {
    if (primitive.getMaterial().getName() === 'ceramic') primitive.setMaterial(lens);
  }
}

// each button cap becomes its own node so it can latch in and out
for (const ref of ['SW1', 'SW2']) {
  const body = byName(ref).listChildren()[0].getMesh();
  const cap = doc.createMesh(`${ref}_cap`);
  for (const primitive of [...body.listPrimitives()]) {
    if (primitive.getMaterial().getName() !== 'switch_cap') continue;
    body.removePrimitive(primitive);
    cap.addPrimitive(primitive);
  }
  byName(ref).addChild(doc.createNode(`${ref}_cap`).setMesh(cap));
}

const board = doc.createNode('board').setTranslation([-CENTRE[0], 0, -CENTRE[1]]);
for (const node of topLevel) {
  const mesh = node.getMesh();
  if (!mesh || COMPONENTS.includes(node.getName())) continue;
  node.setTranslation([0, BOARD_LAYERS[mesh.getName()] ?? 0, 0]);
  board.addChild(node);
}
card.addChild(board);

const geometry = coverGeometry();
const coverPrimitive = doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array(geometry.getAttribute('position').array)))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array(geometry.getAttribute('normal').array)))
  .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(coverColors(geometry)))
  .setMaterial(doc.createMaterial('cover')
    .setBaseColorFactor([...new THREE.Color('#fbfaf6').toArray(), 1])
    .setMetallicFactor(0).setRoughnessFactor(0.62));
// the cover group's origin is the centre of its top face, so it can tilt in place
card.addChild(doc.createNode('cover').setTranslation([0, COVER_TOP, 0])
  .addChild(doc.createNode('cover_mesh').setTranslation([0, -COVER_TOP, 0])
    .setMesh(doc.createMesh('cover').addPrimitive(coverPrimitive))));

for (const node of [...scene.listChildren()]) scene.removeChild(node);
scene.addChild(card);

await doc.transform(
  weld(),
  join({ keepMeshes: true, keepNamed: true }),
  dedup(),
  prune({ keepLeaves: false }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

mkdirSync(dirname(output), { recursive: true });
await io.write(output, doc);

const triangles = root.listMeshes().flatMap((mesh) => mesh.listPrimitives())
  .reduce((sum, primitive) => sum + primitive.getIndices().getCount() / 3, 0);
console.log(`${output}\n${(statSync(output).size / 1024).toFixed(0)} KB, ${triangles} triangles, ${root.listNodes().length} nodes`);

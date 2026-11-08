import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const RED = new THREE.Color('#e0241a');
const GREEN = new THREE.Color('#10a855');

// where each LED sits on the card, from the KiCad layout
const LED_X = 28.8;
const LED_Z = -12;
const COIN_POSITION = new THREE.Vector3(0, 3.7, 3.5);
const CAP_TRAVEL = 1;

// one camera position per chapter
const SHOTS = [
  { az: -20, el: 46, dist: 262, y: 2 },
  { az: 16, el: 38, dist: 250, y: 2 },
  { az: 0, el: 66, dist: 245, y: 0 },
  { az: -24, el: 34, dist: 262, y: 34 },
  { az: 20, el: 30, dist: 250, y: 30 },
  { az: -24, el: 18, dist: 300, y: 40 },
  { az: -6, el: 70, dist: 210, y: 92 },
  { az: 10, el: 22, dist: 310, y: 40 },
];

// callout anchors, as a part name and a point in that part's own space
const ANCHORS = {
  cover: ['cover', [43.6, 0, 6]],
  coin: ['coin', [10, 0, 0]],
  holder: ['BT1', [11.4, -2, 7.4]],
  switch: ['SW1', [2.9, 0, 0]],
  led: ['D2', [0, 1, 0]],
  resistor: ['R4', [0.8, 0.4, 0]],
  board: ['board', [185.6, 0.8, 112]],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (x) => x * x * (3 - 2 * x);
const ramp = (t, a, b) => smooth(clamp((t - a) / (b - a), 0, 1));
const lerp = (a, b, x) => a + (b - a) * x;

function glowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.17, 'rgba(255,255,255,0.96)');
  gradient.addColorStop(0.23, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function coinFaceTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d3d6da';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#868c94';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 82px "IBM Plex Mono", monospace';
  ctx.fillText('CR2032', size / 2, size / 2 - 26);
  ctx.font = '500 52px "IBM Plex Mono", monospace';
  ctx.fillText('+  3V', size / 2, size / 2 + 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function buildCoin() {
  const radius = 10;
  const half = 1.6;
  const round = 0.4;
  const profile = [new THREE.Vector2(0.001, -half)];
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    profile.push(new THREE.Vector2(radius - round + Math.sin(a) * round, -half + round - Math.cos(a) * round));
  }
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    profile.push(new THREE.Vector2(radius - round + Math.cos(a) * round, half - round + Math.sin(a) * round));
  }
  profile.push(new THREE.Vector2(0.001, half));

  const coin = new THREE.Group();
  coin.name = 'coin';
  const metal = new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.32 });
  coin.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 96), metal));

  const face = new THREE.Mesh(
    new THREE.CircleGeometry(radius - round - 0.05, 72),
    new THREE.MeshStandardMaterial({ map: coinFaceTexture(), metalness: 0.75, roughness: 0.38 }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = half + 0.01;
  coin.add(face);
  return coin;
}

export async function createViewer(canvas, { onProgress, onFrame, reducedMotion }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.62;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(24, 1, 40, 1200);

  // a low raking sun so the shallow logo in the cover reads on white plastic
  const sun = new THREE.DirectionalLight('#fff3df', 2.1);
  sun.position.set(-150, 190, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 40, far: 620 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.12;
  sun.shadow.radius = 5;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.ShadowMaterial({ color: '#6b4a26', opacity: 0.2 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -10;
  ground.receiveShadow = true;
  scene.add(ground);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/icw-nav-aid.glb`, (event) => {
    if (event.lengthComputable) onProgress?.(event.loaded / event.total);
  });
  const card = gltf.scene;
  scene.add(card);

  const coin = buildCoin();
  coin.position.copy(COIN_POSITION);
  card.add(coin);

  card.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const part = (name) => card.getObjectByName(name);
  const parts = {
    cover: part('cover'), coin, holder: part('BT1'),
    sw1: part('SW1'), sw2: part('SW2'), cap1: part('SW1_cap'), cap2: part('SW2_cap'),
    d1: part('D1'), d2: part('D2'), r1: part('R1'), r2: part('R2'), r3: part('R3'), r4: part('R4'),
  };
  const home = new Map(Object.values(parts).map((object) => [object, object.position.clone()]));
  const lift = (object, height) => {
    object.position.y = home.get(object).y + height;
  };

  // each LED lens gets its own material because the two always show opposite colours
  const lensOf = (group) => {
    let lens;
    group.traverse((object) => {
      if (object.isMesh && object.material.name === 'led_lens') {
        object.material = object.material.clone();
        lens = object.material;
      }
    });
    return lens;
  };
  const lenses = [lensOf(parts.d1), lensOf(parts.d2)];

  const texture = glowTexture();
  const glowMaterial = () => new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const coverGlows = [-LED_X, LED_X].map((x) => {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), glowMaterial());
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, 0.03, LED_Z);
    parts.cover.add(glow);
    return glow;
  });
  // these lie flat on the board, because an upright glow gets cut off by it
  const halos = [parts.d1, parts.d2].map((led) => {
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), glowMaterial());
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.06;
    led.add(halo);
    return halo;
  });

  const anchors = Object.entries(ANCHORS).map(([id, [name, local]]) => ({
    id,
    object: name === 'coin' ? coin : part(name),
    local: new THREE.Vector3(...local),
  }));

  // the card starts with FLIP latched, which puts red on the right
  const state = { target: 0, t: 0, flip: 1, flipTarget: 1, px: 0, py: 0, pxTarget: 0, pyTarget: 0 };
  let dirty = true;
  let width = 1;
  let height = 1;
  let fit = 1;

  function layout() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // the model sits right of the text once the chapters are beside it
    const shift = width >= 1000 ? 0.17 : 0;
    camera.setViewOffset(width, height, -width * shift, 0, width, height);
    fit = clamp(1.3 / ((width / height) * (1 - 2 * shift)), 1.2, 3);
    dirty = true;
  }

  function pose(t, flip) {
    const coverUp = ramp(t, 2.35, 3);
    const coinOut = ramp(t, 3.3, 3.95);
    const spread = (delay) => ramp(t, 4.25 + delay, 5);

    lift(parts.cover, 66 * coverUp + 20 * spread(0));
    parts.cover.rotation.x = 0.2 * coverUp;
    lift(coin, 34 * coinOut + 22 * spread(0.05));
    lift(parts.holder, 30 * spread(0.1));
    lift(parts.sw1, 42 * spread(0.14));
    lift(parts.sw2, 42 * spread(0.14));
    const capsOff = spread(0.2);
    lift(parts.cap1, capsOff * 9 - CAP_TRAVEL * (1 - capsOff));
    lift(parts.cap2, capsOff * 9 - CAP_TRAVEL * flip * (1 - capsOff));
    for (const led of [parts.d1, parts.d2]) lift(led, 16 * spread(0.22));
    for (const r of [parts.r1, parts.r2, parts.r3, parts.r4]) lift(r, 8 * spread(0.26));

    // pulling the coin cell cuts the power, and the colours break before they swap
    const power = 1 - ramp(t, 3.3, 3.62);
    const swap = Math.abs(1 - 2 * flip);
    const onCover = power * swap * (1 - ramp(t, 2.35, 2.62));
    const onLed = power * swap * ramp(t, 2.35, 2.75);
    [flip < 0.5 ? RED : GREEN, flip < 0.5 ? GREEN : RED].forEach((color, i) => {
      coverGlows[i].material.color.copy(color);
      coverGlows[i].material.opacity = onCover;
      coverGlows[i].visible = onCover > 0.002;
      halos[i].material.color.copy(color);
      halos[i].material.opacity = onLed * 0.85;
      halos[i].visible = onLed > 0.002;
      lenses[i].emissive.copy(color);
      lenses[i].emissiveIntensity = power * swap * 2.2;
    });

    // camera holds at each chapter and moves between them
    const i = clamp(Math.floor(t), 0, SHOTS.length - 2);
    const x = smooth(clamp(t - i, 0, 1));
    const from = SHOTS[i];
    const to = SHOTS[i + 1];
    const az = THREE.MathUtils.degToRad(lerp(from.az, to.az, x) + state.px * 2);
    const el = THREE.MathUtils.degToRad(lerp(from.el, to.el, x) + state.py * 1.4);
    const dist = lerp(from.dist, to.dist, x) * fit;
    const y = lerp(from.y, to.y, x);
    camera.position.set(Math.sin(az) * Math.cos(el) * dist, y + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    camera.lookAt(0, y, 0);
    camera.updateMatrixWorld();
  }

  const point = new THREE.Vector3();
  function projectAnchors() {
    return anchors.map(({ id, object, local }) => {
      point.copy(local);
      object.localToWorld(point).project(camera);
      return { id, x: (point.x * 0.5 + 0.5) * width, y: (-point.y * 0.5 + 0.5) * height };
    });
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const moved = [['t', 'target', 8], ['flip', 'flipTarget', 11], ['px', 'pxTarget', 4], ['py', 'pyTarget', 4]]
      .map(([key, goal, rate]) => {
        const before = state[key];
        const k = reducedMotion ? 1 : 1 - Math.exp(-dt * rate);
        state[key] += (state[goal] - state[key]) * k;
        if (Math.abs(state[goal] - state[key]) < 0.0005) state[key] = state[goal];
        return before !== state[key];
      })
      .some(Boolean);
    if (!moved && !dirty) return;
    dirty = false;
    pose(state.t, state.flip);
    card.updateMatrixWorld(true);
    renderer.render(scene, camera);
    onFrame?.({ t: state.t, anchors: projectAnchors() });
  }

  new ResizeObserver(layout).observe(canvas);
  layout();
  requestAnimationFrame(frame);

  return {
    setProgress(t) {
      state.target = t;
    },
    setFlip(flipped) {
      state.flipTarget = flipped ? 1 : 0;
    },
    setPointer(x, y) {
      if (reducedMotion) return;
      state.pxTarget = x;
      state.pyTarget = y;
    },
  };
}

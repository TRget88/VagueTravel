import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { createViewer } from './scene.js';

// Email address (mailto link) or checkout page. The buy button stays hidden while this is empty.
const ORDER_URL = '';

// The anchors are defined in scene.js. reach is the leader length in pixels.
const LABELS = [
  { id: 'cover', name: 'Printed cover', detail: 'White PLA or PETG', reach: 34 },
  { id: 'coin', name: 'Coin cell', detail: 'CR2032', reach: 146 },
  { id: 'holder', name: 'Cell holder', detail: 'BAT-HLD-001', reach: 92 },
  { id: 'switch', name: 'Latching switch × 2', detail: 'BTSA-L-S-8', reach: 34 },
  { id: 'led', name: 'Bicolor LED × 2', detail: 'APHBM2012SURKCGKC', reach: 72 },
  { id: 'resistor', name: 'Resistor × 4', detail: '330 and 100 ohm', reach: 92 },
  { id: 'board', name: 'Circuit board', detail: '85.6 × 54 × 1.6 mm', reach: 34 },
];

const FLIP_TEXT = ['Left red, right green.', 'Left green, right red.'];
const FLIP_AT = 1.9;
const LABELS_FROM = 4.75;
const LABELS_UNTIL = 5.5;
const STACKED_BELOW = 1000;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const chapters = [...document.querySelectorAll('[data-chapter]')];
const stage = document.querySelector('.stage');
const status = document.getElementById('status');
const labelLayer = document.getElementById('labels');
const flipButton = document.getElementById('flip');
const flipStatus = document.getElementById('flip-status');

const order = document.getElementById('order');
if (ORDER_URL) {
  order.href = ORDER_URL;
  order.hidden = false;
}

const labelNodes = new Map(LABELS.map(({ id, name, detail, reach }) => {
  const node = document.createElement('div');
  node.className = 'label';
  node.style.setProperty('--reach', `${reach}px`);
  node.innerHTML = '<span class="label__line"></span><span><strong></strong><small></small></span>';
  node.querySelector('strong').textContent = name;
  node.querySelector('small').textContent = detail;
  labelLayer.append(node);
  return [id, node];
}));

// t runs from 0 to the last chapter index, reaching each whole number
// when that chapter is centred in the part of the screen beside or below the model
let centres = [];
function measure() {
  centres = chapters.map((chapter) => {
    const box = chapter.getBoundingClientRect();
    return box.top + window.scrollY + box.height / 2;
  });
}

function focusLine() {
  const viewport = window.innerHeight;
  if (window.innerWidth >= STACKED_BELOW) return viewport / 2;
  const stageHeight = stage.offsetHeight;
  return stageHeight + (viewport - stageHeight) / 2;
}

function scrollProgress() {
  const focus = window.scrollY + focusLine();
  if (focus <= centres[0]) return 0;
  for (let i = 0; i < centres.length - 1; i++) {
    if (focus < centres[i + 1]) return i + (focus - centres[i]) / (centres[i + 1] - centres[i]);
  }
  return centres.length - 1;
}

let viewer = null;
let scrollFlipped = true;
let userFlipped = false;

function applyFlip() {
  const flipped = scrollFlipped !== userFlipped;
  viewer?.setFlip(flipped);
  flipButton.setAttribute('aria-pressed', String(flipped));
  flipStatus.textContent = FLIP_TEXT[flipped ? 1 : 0];
}

flipButton.addEventListener('click', () => {
  userFlipped = !userFlipped;
  applyFlip();
});

function renderFrame({ t, anchors }) {
  // scrolling into the how it works chapter presses FLIP once for the visitor
  const shouldFlip = t < FLIP_AT;
  if (shouldFlip !== scrollFlipped) {
    scrollFlipped = shouldFlip;
    applyFlip();
  }

  const fadeIn = Math.min(1, Math.max(0, (t - LABELS_FROM) / 0.2));
  const fadeOut = Math.min(1, Math.max(0, (LABELS_UNTIL + 0.3 - t) / 0.3));
  const opacity = Math.min(fadeIn, fadeOut);
  labelLayer.style.opacity = opacity;
  if (opacity > 0) {
    for (const { id, x, y } of anchors) {
      labelNodes.get(id).style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translateY(-50%)`;
    }
  }
}

function onScroll() {
  viewer?.setProgress(scrollProgress());
}

async function start() {
  measure();
  new ResizeObserver(() => {
    measure();
    onScroll();
  }).observe(document.body);
  window.addEventListener('scroll', onScroll, { passive: true });

  try {
    viewer = await createViewer(document.getElementById('scene'), {
      reducedMotion,
      onFrame: renderFrame,
      onProgress(share) {
        status.textContent = `Loading model ${Math.round(share * 100)}%`;
      },
    });
    status.remove();
    onScroll();
    applyFlip();
  } catch (error) {
    console.error('The 3D view could not start', error);
    document.documentElement.classList.add('no-3d');
    return;
  }

  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    window.addEventListener('pointermove', (event) => {
      viewer.setPointer(event.clientX / window.innerWidth * 2 - 1, event.clientY / window.innerHeight * 2 - 1);
    }, { passive: true });
  }
}

start();

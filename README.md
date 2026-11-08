# VagueTravel

Landing page for ICW Nav Aid, a Vague Travel product. A Three.js model of the real card comes apart as you scroll.

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/` that can be hosted from any folder. Pushes to `main` publish it to GitHub Pages through `.github/workflows/deploy.yml`, once the repo's Pages source is set to GitHub Actions.

## Before you launch

Set `ORDER_URL` at the top of `src/main.js` to an email (mailto) or checkout link. The "Ask about buying one" button stays hidden until it is set.

## The 3D model

`public/models/icw-nav-aid.glb` is generated from the KiCad board and the printed cover in the icw-nav-aid project. After changing the design, rebuild it with the command below. It needs KiCad 10, and it looks for the project next to this repo unless you pass a path.

```bash
npm run model
```

The design itself lives at [nurbly.com/adminkirk/icw-nav-aid](https://nurbly.com/adminkirk/icw-nav-aid).

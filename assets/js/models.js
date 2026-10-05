/*
 * models.js — the seven objects that stand beside the text.
 *
 * Everything here is generated from code: there are no meshes to download and
 * no modelling tool in the loop, so each object is a few hundred bytes of
 * description rather than a few hundred kilobytes of geometry.
 *
 *   galaxy     a barred spiral                    — the opening, points at nothing
 *   crystal    an abstract cubic lattice          — kept as the fallback
 *   tower      a Gothic bell tower                — University of Chicago
 *   pagoda     Boya Pagoda, octagonal, flying-eave — Peking University
 *   office     a slab-core curtain-wall tower     — ByteDance
 *   spectrum   gated activation trajectories      — Activation-FFT
 *   orbital    a four-lobed d atomic orbital      — the physics model
 *   wurtzite   a GaN wurtzite cell                — the Hamiltonian work
 *
 * Shared conventions: y is up, the origin is the centre of the object, and
 * everything fits inside a sphere of radius ~1.7 so the camera never has to
 * move between sections.
 *
 * Two kinds of line. Structure — silhouettes, bonds, eaves — is drawn with
 * LineSegments2, which renders each segment as an instanced quad and so can
 * actually be several pixels wide; WebGL ignores `linewidth` on an ordinary
 * line on virtually every platform. Dense fields, like the spectrum mesh, stay
 * on plain one-pixel lines: they are texture rather than silhouette, and a few
 * thousand fat segments would cost far more than they are worth. The spectrum
 * ridgelines are the exception — they are the thing being watched, so they pay
 * for width and are rewritten in place as the terrain moves.
 *
 * Materials are tagged through `userData.role` so the scene can retint every
 * object to the live section accent and cross-fade them without knowing what
 * any particular object is made of.
 */

import * as THREE from '../vendor/three.module.min.js';
import { LineSegmentsGeometry } from '../vendor/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from '../vendor/lines/LineSegments2.js';
import { LineMaterial } from '../vendor/lines/LineMaterial.js';
import { N, HALF, BANDS, forward, inverse, bandGain } from './dft.js';

const BODY = 0x0b0f14;

/* Deterministic noise in [-0.5, 0.5), so every object looks identical on
   every visit. */
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

/* Every fat-line material needs the canvas size to work out pixel widths, so
   they are collected here and updated from one place on resize. */
const lineMaterials = [];

export function setLineResolution(w, h) {
  for (const m of lineMaterials) m.resolution.set(w, h);
}

/* ------------------------------------------------------------- materials */
function bodyMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: BODY,
    roughness: 0.82,
    metalness: 0.08,
    flatShading: true,
    transparent: true,
    opacity: 1,
  });
  m.userData.role = 'body';
  m.userData.baseOpacity = 1;
  return m;
}

function thinMaterial(opacity) {
  const m = new THREE.LineBasicMaterial({ transparent: true, opacity });
  m.userData.role = 'edge';
  m.userData.baseOpacity = opacity;
  return m;
}

function fatMaterial(opacity, width) {
  const m = new LineMaterial({ linewidth: width, transparent: true, opacity });
  m.userData.role = 'edge';
  m.userData.baseOpacity = opacity;
  lineMaterials.push(m);
  return m;
}

function pointMaterial(size, opacity = 1) {
  const m = new THREE.PointsMaterial({ size, sizeAttenuation: true, transparent: true, opacity });
  m.userData.role = 'glow';
  m.userData.baseOpacity = opacity;
  return m;
}

function glowMaterial(opacity = 1) {
  const m = new THREE.MeshBasicMaterial({ transparent: true, opacity });
  m.userData.role = 'glow';
  m.userData.baseOpacity = opacity;
  return m;
}

/* ---------------------------------------------------------------- shapes */
const flatten = points => {
  const a = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    a[i * 3] = p.x;
    a[i * 3 + 1] = p.y;
    a[i * 3 + 2] = p.z;
  });
  return a;
};

/** Structural line work: pairs of points, drawn several pixels wide. */
function edges(points, opacity = 1, width = 2.2) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(flatten(points));
  return new LineSegments2(geo, fatMaterial(opacity, width));
}

/** Dense line work: one pixel, cheap, for fields rather than silhouettes. */
function mesh(points, opacity = 0.42) {
  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), thinMaterial(opacity));
}

/** A solid with its sharp edges drawn over it — the language of these objects. */
function solid(geometry, { threshold = 18, edgeOpacity = 1, width = 2.2 } = {}) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geometry, bodyMaterial()));
  const lg = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geometry, threshold));
  g.add(new LineSegments2(lg, fatMaterial(edgeOpacity, width)));
  return g;
}

/* An octagonal prism — the plan of every Chinese brick pagoda.
   Placement is a parameter rather than something to apply afterwards: the
   group carries a 22.5-degree yaw to put a flat face forward, so translateX
   and translateZ would move it along that rotated frame. */
function oct(radius, height, y = 0, opts, x = 0, z = 0) {
  const g = solid(new THREE.CylinderGeometry(radius, radius, height, 8), opts);
  g.position.set(x, y, z);
  g.rotation.y = Math.PI / 8;
  return g;
}

/* A horizontal ring of n points on a circle, used for eave corners and for
   the bracket ticks under them. */
function ring(radius, y, n = 8, phase = Math.PI / 8) {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
  });
}

function box(w, h, d, x = 0, y = 0, z = 0, opts) {
  const g = solid(new THREE.BoxGeometry(w, h, d), opts);
  g.position.set(x, y, z);
  return g;
}

/* A small faceted gem, instanced — used for every atom and every lit window. */
function atoms(positions, radius, opacity = 1) {
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  const m = new THREE.InstancedMesh(geo, glowMaterial(opacity), positions.length);
  const t = new THREE.Matrix4();
  positions.forEach((p, i) => m.setMatrixAt(i, t.makeTranslation(p.x, p.y, p.z)));
  m.instanceMatrix.needsUpdate = true;
  return m;
}

/* ================================================================ crystal */
/* The opening object. Deliberately the least literal thing on the page: a
   plain cubic lattice, the shape every other object grows out of. */
function buildCrystal() {
  const g = new THREE.Group();
  const N = 4;
  const step = 0.62;
  const half = ((N - 1) * step) / 2;
  const bonds = [];
  const nodes = [];
  const at = (i, j, k) => new THREE.Vector3(i * step - half, j * step - half, k * step - half);

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        nodes.push(at(i, j, k));
        if (i + 1 < N) bonds.push(at(i, j, k), at(i + 1, j, k));
        if (j + 1 < N) bonds.push(at(i, j, k), at(i, j + 1, k));
        if (k + 1 < N) bonds.push(at(i, j, k), at(i, j, k + 1));
      }
    }
  }
  g.add(edges(bonds, 0.85, 2.1));
  g.add(atoms(nodes, 0.055, 1));
  return g;
}

/* ================================================================= galaxy */
/* A barred spiral, seen at an angle. Stars are drawn as points rather than
   geometry — a few thousand of them cost one draw call, and a lattice of
   bonds was never going to say anything about the person. Four populations
   give the thing depth: a dense bulge, a bar through it, two logarithmic arms
   that thin as they wind out, and a sparse halo. */
function buildGalaxy() {
  const rand = noise(0x9a1c1e);
  /* Box-Muller, so the bulge and the arm scatter are actually gaussian and
     not a uniform disc with soft edges. */
  const gauss = () => {
    const u = Math.max(1e-6, rand() + 0.5);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * (rand() + 0.5));
  };

  const RMAX = 1.6;
  const SPIN = 3.5; // radians each arm winds through
  const cloud = (n, fill) => {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) fill(a, i * 3, i);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
    return geo;
  };

  const g = new THREE.Group();

  /* Bulge: a flattened gaussian ball. */
  const bulge = cloud(1100, (a, j) => {
    const r = Math.abs(gauss()) * 0.17;
    const th = rand() * Math.PI * 2 + Math.PI;
    const ph = Math.acos(Math.max(-1, Math.min(1, gauss() * 0.55)));
    a[j] = r * Math.sin(ph) * Math.cos(th);
    a[j + 1] = r * Math.cos(ph) * 0.55;
    a[j + 2] = r * Math.sin(ph) * Math.sin(th);
  });

  /* Bar: the "barred" part, a prolate cloud through the nucleus. */
  const bar = cloud(420, (a, j) => {
    const t = (rand() + 0.5) * 2 - 1;
    a[j] = t * 0.52 + gauss() * 0.035;
    a[j + 1] = gauss() * 0.035;
    a[j + 2] = gauss() * 0.075;
  });

  /* Arms: two logarithmic spirals springing from the ends of the bar. The
     scatter shrinks with radius so the arms sharpen as they wind out, and the
     disc thins at the same time. */
  const arms = cloud(2600, (a, j, i) => {
    const arm = i % 2;
    const t = Math.pow(rand() + 0.5, 0.62);
    const r = 0.34 + t * (RMAX - 0.34);
    const th = arm * Math.PI + 0.35 + t * SPIN + gauss() * (0.3 / (0.55 + t));
    const rr = r + gauss() * 0.055;
    a[j] = rr * Math.cos(th);
    a[j + 1] = gauss() * 0.055 * (1 - t * 0.55);
    a[j + 2] = rr * Math.sin(th);
  });

  /* Halo: thin, spherical, far out — it is what stops the disc looking cut. */
  const halo = cloud(520, (a, j) => {
    const r = 0.45 + Math.pow(rand() + 0.5, 0.5) * 1.05;
    const th = rand() * Math.PI * 2 + Math.PI;
    const ph = Math.acos(Math.max(-1, Math.min(1, (rand() + 0.5) * 2 - 1)));
    a[j] = r * Math.sin(ph) * Math.cos(th);
    a[j + 1] = r * Math.cos(ph);
    a[j + 2] = r * Math.sin(ph) * Math.sin(th);
  });

  /* Star-forming knots strung along the arms, the bright beads that make a
     spiral read as a spiral. */
  const knots = cloud(90, (a, j, i) => {
    const arm = i % 2;
    const t = Math.pow((i / 90 + 0.08) % 1, 0.7);
    const r = 0.45 + t * (RMAX - 0.45);
    const th = arm * Math.PI + 0.35 + t * SPIN + gauss() * 0.06;
    a[j] = r * Math.cos(th);
    a[j + 1] = gauss() * 0.03;
    a[j + 2] = r * Math.sin(th);
  });

  g.add(new THREE.Points(bulge, pointMaterial(0.05, 0.95)));
  g.add(new THREE.Points(bar, pointMaterial(0.042, 0.8)));
  g.add(new THREE.Points(arms, pointMaterial(0.036, 0.85)));
  g.add(new THREE.Points(halo, pointMaterial(0.026, 0.34)));
  g.add(new THREE.Points(knots, pointMaterial(0.085, 1)));
  g.add(atoms([new THREE.Vector3(0, 0, 0)], 0.07, 1));

  /* Seen face-on a spiral is a target; seen edge-on it is a line. Somewhere
     between the two is the only angle that reads as a galaxy. */
  g.rotation.x = 0.4;
  g.rotation.z = -0.08;
  /* The disc is circular about y, so its radius is its radius — the
     generic sweep estimate would push the camera a third too far back. */
  g.userData.fit = 1.62;
  return g;
}

/* ================================================================== tower */
/* The bell tower on the quadrangles, in the Oxford manner its architects were
   copying: slender, three stages divided by string courses, paired belfry
   lancets with a mullion and trefoil heads, a pierced parapet, and octagonal
   corner turrets rather than plain pinnacles — the turrets are what make the
   Magdalen silhouette, so they are modelled rather than implied. */
function buildTower() {
  const g = new THREE.Group();
  const W = 0.6; // slimmer than a square tower wants to be; that is the point

  g.add(box(W * 1.52, 0.12, W * 1.52, 0, -1.72, 0, { width: 2 })); // plinth
  g.add(box(W * 1.3, 0.1, W * 1.3, 0, -1.61, 0, { width: 2 }));
  g.add(box(W * 1.14, 0.08, W * 1.14, 0, -1.52, 0, { width: 2 }));

  /* Shaft, in two stages with a string course between them. */
  g.add(box(W, 1.0, W, 0, -0.98, 0, { width: 2.2 }));
  g.add(box(W * 1.07, 0.05, W * 1.07, 0, -0.455, 0, { width: 2 })); // string course
  g.add(box(W, 0.62, W, 0, -0.12, 0, { width: 2.2 }));
  g.add(box(W * 1.07, 0.05, W * 1.07, 0, 0.215, 0, { width: 2 })); // string course

  /* Corner buttresses, set back twice on the way up. */
  const bw = 0.13;
  const off = W / 2 - bw / 2 + 0.03;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(bw, 1.04, bw, sx * off, -0.98, sz * off, { width: 1.8 }));
      g.add(box(bw * 0.8, 0.6, bw * 0.8, sx * off, -0.13, sz * off, { width: 1.8 }));
    }
  }

  /* Belfry stage. */
  g.add(box(W * 1.04, 0.66, W * 1.04, 0, 0.57, 0, { width: 2.2 }));

  /* Two lancets per face, each with a central mullion and a trefoil head —
     drawn rather than cut, which keeps the solid to a single box. */
  const tracery = [];
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tx = -nz;
    const tz = nx;
    const r = (W * 1.04) / 2 + 0.004;
    const P = (o, y) => new THREE.Vector3(nx * r + tx * o, y, nz * r + tz * o);
    for (const centre of [-0.13, 0.13]) {
      const hw = 0.052;
      const sill = 0.33;
      const spring = 0.68;
      const apex = 0.78;
      tracery.push(P(centre - hw, sill), P(centre - hw, spring));
      tracery.push(P(centre + hw, sill), P(centre + hw, spring));
      tracery.push(P(centre - hw, sill), P(centre + hw, sill));
      tracery.push(P(centre - hw, spring), P(centre, apex));
      tracery.push(P(centre + hw, spring), P(centre, apex));
      tracery.push(P(centre, sill), P(centre, apex - 0.02)); // mullion
      /* Trefoil: two small cusps either side of the mullion head. */
      tracery.push(P(centre - hw * 0.55, spring + 0.02), P(centre, spring + 0.055));
      tracery.push(P(centre + hw * 0.55, spring + 0.02), P(centre, spring + 0.055));
    }
    /* A hood mould over the pair. */
    tracery.push(P(-0.21, 0.84), P(0.21, 0.84));
  }
  g.add(edges(tracery, 1, 2));

  /* Pierced parapet: a band with a row of quatrefoil-ish openings. */
  const pw = W * 1.16;
  g.add(box(pw, 0.06, pw, 0, 0.93, 0, { width: 2 }));
  g.add(box(pw, 0.19, pw, 0, 1.055, 0, { width: 2.2 }));
  const pierce = [];
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tx = -nz;
    const tz = nx;
    const r = pw / 2 + 0.004;
    const P = (o, y) => new THREE.Vector3(nx * r + tx * o, y, nz * r + tz * o);
    for (const c of [-0.16, 0, 0.16]) {
      const h = 0.05;
      pierce.push(P(c - h, 1.055), P(c, 1.055 + h));
      pierce.push(P(c, 1.055 + h), P(c + h, 1.055));
      pierce.push(P(c + h, 1.055), P(c, 1.055 - h));
      pierce.push(P(c, 1.055 - h), P(c - h, 1.055));
    }
  }
  g.add(edges(pierce, 0.9, 1.6));
  g.add(box(pw * 1.04, 0.045, pw * 1.04, 0, 1.17, 0, { width: 2 })); // coping

  /* Octagonal corner turrets with spirelets, rising clear of the parapet. */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (pw / 2 - 0.045);
      const pz = sz * (pw / 2 - 0.045);
      g.add(oct(0.072, 0.34, 1.14, { width: 1.8 }, px, pz));
      const cap = solid(new THREE.ConeGeometry(0.082, 0.2, 8), { threshold: 1, width: 1.8 });
      cap.position.set(px, 1.41, pz);
      cap.rotation.y = Math.PI / 8;
      g.add(cap);
      g.add(atoms([new THREE.Vector3(px, 1.53, pz)], 0.026, 0.9));
    }
  }

  /* The clock, on the stage below the belfry. */
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.15, 28), glowMaterial(0.4));
  dial.position.set(0, -0.12, W / 2 + 0.005);
  g.add(dial);
  const face = [];
  for (let k = 0; k < 28; k++) {
    const a0 = (k / 28) * Math.PI * 2;
    const a1 = ((k + 1) / 28) * Math.PI * 2;
    face.push(
      new THREE.Vector3(Math.cos(a0) * 0.167, -0.12 + Math.sin(a0) * 0.167, W / 2 + 0.007),
      new THREE.Vector3(Math.cos(a1) * 0.167, -0.12 + Math.sin(a1) * 0.167, W / 2 + 0.007)
    );
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    face.push(
      new THREE.Vector3(Math.cos(a) * 0.125, -0.12 + Math.sin(a) * 0.125, W / 2 + 0.008),
      new THREE.Vector3(Math.cos(a) * 0.152, -0.12 + Math.sin(a) * 0.152, W / 2 + 0.008)
    );
  }
  face.push(
    new THREE.Vector3(0, -0.12, W / 2 + 0.009), new THREE.Vector3(0.02, -0.035, W / 2 + 0.009),
    new THREE.Vector3(0, -0.12, W / 2 + 0.009), new THREE.Vector3(0.065, -0.145, W / 2 + 0.009)
  );
  g.add(edges(face, 1, 1.8));
  return g;
}

/* ================================================================= pagoda */
/* Boya Pagoda, on the east bank of Weiming Lake at Peking University: a stone
   base carrying an octagonal shaft, built 1924 to the outline of the Liao
   dense-eave brick pagoda at Tongzhou.
   newsen.pku.edu.cn/news_events/news/campus/8349.html
   fdcb.pku.edu.cn/yyww/wwxx/0322a24e16a748928a26e260ff721b76.htm
 *
 * Two deliberate departures from the survey. The real tower has thirteen
 * tiers; at the size this is drawn, thirteen stack into a comb and the
 * silhouette reads as a stepped cone, so it carries seven. And the crown is a
 * 攒尖顶 — a small eight-sided pavilion roof with its own lifted corners —
 * rather than the stupa-derived drum-and-spire 塔刹, because this is a piece
 * of Chinese architecture and should read as one.
 *
 * What makes it Chinese at all is the lift at every eave corner. A stack of
 * flat octagonal slabs is a stepped cone; eight upturned spars per eave is a
 * pagoda. */
function buildPagoda() {
  const g = new THREE.Group();

  /* A low stone base — kept deliberately shallow so the shaft dominates. */
  g.add(box(1.04, 0.075, 1.04, 0, -1.46, 0, { width: 2 }));
  g.add(oct(0.56, 0.065, -1.39, { width: 2 }));
  g.add(oct(0.5, 0.075, -1.32, { width: 2 }));

  /* An eave: the slab, then a lifting spar at each of its eight corners —
     out, then up, which is what a 翼角 does. */
  const eave = (r, y, thickness, lift) => {
    g.add(oct(r, thickness, y + thickness / 2, { width: 2 }));
    const spars = [];
    for (const c of ring(r, 0)) {
      const u = c.x / r;
      const v = c.z / r;
      const mid = new THREE.Vector3(
        u * (r + lift * 0.6), y + thickness + lift * 0.3, v * (r + lift * 0.6)
      );
      spars.push(
        new THREE.Vector3(c.x, y + thickness * 0.4, c.z), mid,
        mid, new THREE.Vector3(u * (r + lift), y + thickness + lift * 1.1, v * (r + lift))
      );
    }
    g.add(edges(spars, 1, 2.2));
  };

  /* First storey: the tall one, with alternating blind doors and lattice
     windows, and a column at every corner. */
  const R0 = 0.4;
  g.add(oct(R0, 0.5, -1.03, { width: 2.2 }));

  const detail = [];
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    const tx = -nz;
    const tz = nx;
    const r = R0 * 0.925 + 0.004;
    const P = (o, y) => new THREE.Vector3(nx * r + tx * o, y, nz * r + tz * o);
    if (k % 2 === 0) {
      const w = 0.09;
      detail.push(P(-w, -1.25), P(-w, -0.92), P(w, -1.25), P(w, -0.92), P(-w, -1.25), P(w, -1.25));
      detail.push(P(-w, -0.92), P(0, -0.84), P(w, -0.92), P(0, -0.84));
    } else {
      const w = 0.062;
      detail.push(P(-w, -1.17), P(-w, -0.97), P(w, -1.17), P(w, -0.97));
      detail.push(P(-w, -1.17), P(w, -1.17), P(-w, -0.97), P(w, -0.97));
      detail.push(P(0, -1.17), P(0, -0.97), P(-w, -1.07), P(w, -1.07));
    }
  }
  for (const c of ring(R0 * 0.99, 0, 8, 0)) {
    detail.push(new THREE.Vector3(c.x, -1.27, c.z), new THREE.Vector3(c.x, -0.8, c.z));
  }
  g.add(edges(detail, 0.9, 2));

  eave(0.54, -0.78, 0.04, 0.12);

  /* Seven tiers above it. Taller wall bands than a true dense-eave tower
     would have, which is what buys the silhouette at this size. */
  let y = -0.67;
  let crownSeat = 0;
  const TIERS = 7;
  for (let t = 0; t < TIERS; t++) {
    const k = (t + 1) / TIERS;
    const wallR = 0.36 - k * 0.11;
    const eaveR = 0.5 - k * 0.17;
    const wallH = 0.15 - k * 0.04;

    g.add(oct(wallR, wallH, y + wallH / 2, { width: 2 }));

    const win = [];
    for (let q = 0; q < 4; q++) {
      const a = Math.PI / 8 + (q / 4) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const tx = -nz;
      const tz = nx;
      const r = wallR * 0.93 + 0.003;
      const w = 0.038 - k * 0.012;
      const P = (o, h) => new THREE.Vector3(nx * r + tx * o, y + h, nz * r + tz * o);
      win.push(P(-w, wallH * 0.22), P(-w, wallH * 0.8), P(w, wallH * 0.22), P(w, wallH * 0.8));
      win.push(P(-w, wallH * 0.22), P(w, wallH * 0.22), P(-w, wallH * 0.8), P(w, wallH * 0.8));
      win.push(P(0, wallH * 0.22), P(0, wallH * 0.8));
    }
    g.add(edges(win, 0.8, 1.6));

    const th = 0.036 - k * 0.008;
    eave(eaveR, y + wallH, th, 0.11 - k * 0.04);
    /* The cursor advances past the eave slab by part of the corner lift, so
       the slab's own top is remembered here — that is what the crown sits on,
       and seating the crown on the cursor instead would float it. */
    crownSeat = y + wallH + th;
    y += wallH + th + (0.11 - k * 0.04) * 0.45;
  }

  /* ---------------------------------------------------- 八角攒尖顶 -------
     A Chinese flying-eave roof. Four things make one read as Chinese, and a
     polygonal cone has none of them:

       反宇   the profile is concave — four 步架 whose slopes climb 31.8, 38.7,
              45.0 and 51.3 degrees from the eave to the ridge. A ConeGeometry
              is a straight slope and can never be anything else.
       出檐   the eave oversails: it stands clear of the crown wall in plan and
              its fascia hangs below the wall top, so the roof covers the tower
              rather than capping it.
       起翘   every corner lifts up and out — and in the SURFACE, not only in
              the line work. Kicking just the lines would leave the silhouette
              underneath a straight cone, which is a lie told in profile.
       垂脊   eight hips converging on the finial. In the old version these were
              drawn from a ring 0.14 BELOW the cone's own base, so the only
              Chinese element in the whole cap was buried in the brickwork.

     Eight azimuths only, so the shell is genuinely flat-faced like the oct()
     storeys under it. All the line work is drawn by hand rather than left to
     EdgesGeometry: the shallowest hip crease here measures 13 degrees, and
     solid()'s default 18-degree threshold silently drops exactly the eave hips
     that matter most. Drawing them explicitly also sets the hierarchy — hips
     and eave rim heavy, tile courses as texture.

     The roof is about 26px of rise on screen, and the pagoda is height-bound
     in the camera fit (half-height 1.26 against a 1.04 plan sweep), so every
     0.01 of extra height costs 0.4% of the object's apparent size. That is the
     budget everything below is sized against: it tops out at 1.053 against the
     old cone's 1.014, which renders the pagoda 1.5% smaller and is worth it. */
  const CROWN_R = 0.225;
  const DRUM_H = 0.095;
  g.add(oct(CROWN_R, DRUM_H, crownSeat + DRUM_H / 2, { width: 2 }));

  /* 出檐 is bought by shrinking the wall under the roof rather than by flaring
     the roof: at 0.300 the eave, and 0.324 at the kicked corners, both stay
     inside the tier-7 eave's own 0.330. The pagoda's whole silhouette is one
     monotone taper, and a crown wider than the eave below it is a mushroom. */
  const RE = 0.3;
  const RT = 0.03;
  const EAVE_Y = crownSeat + DRUM_H - 0.035; // the eave hangs below the wall top
  /* 举架: equal 步架 runs whose rise ratios climb from 六二举 at the eave to
     十二五举 at the ridge. That monotonic increase IS 反宇 — a straight slope
     cannot be concave, which is the whole reason a cone will not do. */
  const JU = [0.62, 0.8, 1.0, 1.25];
  const CHONG = 0.024; // 起翘, outward
  const QIAO = 0.04; //         and up
  const FASCIA = 0.014; // 连檐 — the band that stops the eave being a cut edge
  /* The lift has to decay slowly enough that the hip keeps rising. Decay it
     too fast and the corner becomes a spike — the tip sits higher than the
     next station inward, so the first 垂脊 segment slopes downward and the
     surface folds. The constraint is QIAO * (WARP[0] - WARP[1]) < the 檐步
     rise, which here is 0.0112 against 0.0419. */
  const WARP = [1, 0.72, 0.4, 0.15, 0];

  const RUN = (RE - RT) / JU.length;
  const PROF = [{ r: RE, y: EAVE_Y }];
  for (const j of JU) {
    const q = PROF[PROF.length - 1];
    PROF.push({ r: q.r - RUN, y: q.y + RUN * j });
  }
  const APEX = PROF[PROF.length - 1].y;

  const T = [0, 0.12, 0.3, 0.5, 0.7, 0.88];
  const LAT = T.length;
  const COLS = 8 * LAT;
  const cornerA = c => Math.PI / 8 + (c / 8) * Math.PI * 2;

  /* A point on the roof. Interpolation runs along the chord between two
     corners, never around a circle — on a circle the shell would quietly
     become a cone again. */
  const roofPt = (col, ring, out = 0, up = 0) => {
    const k = Math.floor(col / LAT);
    const t = T[col % LAT];
    const q = PROF[ring];
    const a0 = cornerA(k);
    const a1 = cornerA(k + 1);
    const v = new THREE.Vector3(Math.cos(a0) * q.r, q.y, Math.sin(a0) * q.r).lerp(
      new THREE.Vector3(Math.cos(a1) * q.r, q.y, Math.sin(a1) * q.r),
      t
    );
    /* 1 at a corner, 0 at mid-face, squared so the lift curves into the
       corner instead of spiking at it — which is what 翼角椽 do. */
    const sp = Math.abs(2 * t - 1);
    const e = Math.max(0, (sp - 0.45) / 0.55);
    const w = WARP[ring] * e * e;
    const h = Math.hypot(v.x, v.z) || 1;
    const d = CHONG * w + out;
    v.x += (v.x / h) * d;
    v.z += (v.z / h) * d;
    v.y += QIAO * w + up;
    return v;
  };

  /* The shell, closed top and bottom so it is a real solid: the camera sits
     below the eave line and an open shell would show its own far interior. */
  const rpos = [];
  const ridx = [];
  const rput = v => {
    rpos.push(v.x, v.y, v.z);
    return rpos.length / 3 - 1;
  };
  const rings = PROF.map((_, r) =>
    Array.from({ length: COLS }, (_, c) => rput(roofPt(c, r)))
  );
  const lip = Array.from({ length: COLS }, (_, c) => rput(roofPt(c, 0, 0, -FASCIA)));
  /* The soffit slopes back at the eave-strip angle and tucks under the crown
     wall, so roof and underside read as one constant-thickness sandwich. */
  const soffitY = EAVE_Y + (RE - CROWN_R) * JU[0] - FASCIA;
  const seat = Array.from({ length: COLS }, (_, c) => {
    const k = Math.floor(c / LAT);
    const t = T[c % LAT];
    const a0 = cornerA(k);
    const a1 = cornerA(k + 1);
    return rput(
      new THREE.Vector3(Math.cos(a0) * CROWN_R, soffitY, Math.sin(a0) * CROWN_R).lerp(
        new THREE.Vector3(Math.cos(a1) * CROWN_R, soffitY, Math.sin(a1) * CROWN_R),
        t
      )
    );
  });
  const apexIdx = rput(new THREE.Vector3(0, APEX + 0.004, 0));
  /* The soffit's inner ring would otherwise be a 48-edge hole. It is buried
     inside the crown wall and never seen, but leaving it open gives those
     vertices one-sided normals and makes the shell non-manifold for no gain. */
  const soffitHub = rput(new THREE.Vector3(0, soffitY, 0));

  /* Winding: (lo, hi, lo+1) then (lo+1, hi, hi+1) faces outward and up.
     Reverse either and bodyMaterial's FrontSide culls the roof away. */
  const strip = (lo, hi) => {
    for (let c = 0; c < COLS; c++) {
      const n = (c + 1) % COLS;
      ridx.push(lo[c], hi[c], lo[n], lo[n], hi[c], hi[n]);
    }
  };
  for (let r = 0; r < PROF.length - 1; r++) strip(rings[r], rings[r + 1]);
  strip(lip, rings[0]); // 连檐, the vertical fascia band
  for (let c = 0; c < COLS; c++) {
    const n = (c + 1) % COLS;
    ridx.push(seat[c], lip[c], lip[n], seat[c], lip[n], seat[n]); // soffit
    ridx.push(soffitHub, seat[n], seat[c]); // soffit closure, inside the wall
    ridx.push(apexIdx, rings[PROF.length - 1][n], rings[PROF.length - 1][c]); // ridge cap
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
  shell.setIndex(ridx);
  shell.computeVertexNormals();
  g.add(new THREE.Mesh(shell, bodyMaterial()));

  /* The eave rim is the single most important line on the object: it is the
     curve that says 飞檐. Then the fascia's lower edge under it, then the
     eight hips, then the tile courses as texture. */
  const rim = [];
  const under = [];
  const courses = [];
  for (let c = 0; c < COLS; c++) {
    const n = (c + 1) % COLS;
    rim.push(roofPt(c, 0, 0.004, 0.003), roofPt(n, 0, 0.004, 0.003));
    under.push(roofPt(c, 0, 0.004, -FASCIA - 0.002), roofPt(n, 0, 0.004, -FASCIA - 0.002));
    for (const r of [1, 2]) courses.push(roofPt(c, r, 0.003, 0.002), roofPt(n, r, 0.003, 0.002));
  }
  g.add(edges(rim, 1, 2.8));
  g.add(edges(under, 0.5, 1.6));
  g.add(mesh(courses, 0.4));

  /* 垂脊 ×8 — no 正脊: a 攒尖顶 has none. They follow the same warped corner
     columns as the surface, lifted just clear of it. */
  const hips = [];
  for (let k = 0; k < 8; k++) {
    const col = k * LAT; // T[0] = 0, so this column is the corner itself
    for (let r = 0; r < PROF.length - 1; r++) {
      hips.push(roofPt(col, r, 0.005, 0.004), roofPt(col, r + 1, 0.005, 0.004));
    }
    hips.push(roofPt(col, PROF.length - 1, 0.005, 0.004), new THREE.Vector3(0, APEX + 0.008, 0));
  }
  g.add(edges(hips, 1, 2.8));

  /* 宝顶: a 露盘 plate over the convergence, then the bead. Small, because at
     this size a drum under it would be two pixels wide and read as nothing.
     The plate is sunk so the apex ring sits strictly inside its solid rather
     than coplanar with its underside. */
  g.add(oct(0.05, 0.01, APEX + 0.002, { width: 1.8 }));
  g.add(atoms([new THREE.Vector3(0, APEX + 0.04, 0)], 0.022, 1));

  /* Lamps behind the first-storey openings. */
  const lamps = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 8 + (k / 4) * Math.PI * 2;
    lamps.push(new THREE.Vector3(Math.cos(a) * R0 * 0.88, -1.08, Math.sin(a) * R0 * 0.88));
  }
  g.add(atoms(lamps, 0.028, 0.85));
  return g;
}

/* ================================================================= office */
/* One upright prism. The taper is gone, which puts the whole burden on four
 * other things:
 *
 *   a weave      seven solid ribs standing proud of the faces, crossed by two
 *                oversailing mechanical bands. The ribs win at every crossing,
 *                so the two systems cross rather than one swallowing the other
 *                — that margin is 0.010, and it is the whole device.
 *   proportion   the bands cut the shaft into glazed segments of 0.68 / 0.645
 *                / 0.625 going up. Diminishing and non-symmetric, so the
 *                tower still gains apparent height and no band bisects it.
 *   a core       an asymmetric service blade on the -x end, deeper than the
 *                shaft and 0.22 short of its top, breaking both the front and
 *                the side silhouette. Nothing crosses it.
 *   a drain      light packed at the base, thinning to a nearly dark top
 *                third, then the lit crown under the oversailing cap.
 *
 * No setback, no chamfer, no mast, no spire. Nothing is drawn on an underside:
 * the camera sits at pitch +0.17 and never sees one. */
function buildOffice() {
  const g = new THREE.Group();

  const W = 0.62;
  const D = 0.48;
  const HW = W / 2;
  const HD = D / 2;
  const Y0 = -1.19; // the shaft springs from the canopy
  const TOP = 0.91;
  const H = TOP - Y0;
  const MID = (Y0 + TOP) / 2;

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const rect = (hw, hd, y, into) => {
    const c = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]];
    for (let k = 0; k < 4; k++) {
      into.push(V(c[k][0], y, c[k][1]), V(c[k + 1][0], y, c[k + 1][1]));
    }
  };

  /* ---- ground. The plaza is what sets the fit radius for the whole object,
     so widening it would shrink the tower against the other six. It stays. */
  g.add(box(1.3, 0.09, 0.9, 0, -1.4, 0, { width: 2 }));
  const kerb = [];
  rect(0.63, 0.43, -1.355, kerb);
  g.add(edges(kerb, 1, 3));
  /* The lobby is narrower than the shaft on every side and the canopy
     oversails both, so the mass stands over a shadow gap instead of on the
     floor — the bottom bookend to the roof cap. */
  g.add(box(0.56, 0.135, 0.42, 0, -1.2875, 0, { threshold: 1, width: 2.2 }));
  g.add(box(0.86, 0.03, 0.64, -0.03, -1.205, 0, { width: 2.6 }));
  const uplight = [];
  rect(0.284, 0.214, -1.345, uplight);
  rect(0.284, 0.214, -1.232, uplight);
  g.add(edges(uplight, 1, 2.6));
  g.add(atoms([V(-0.18, -1.3, 0.2), V(0.1, -1.3, 0.2), V(0.26, -1.3, -0.06)], 0.026, 0.9));

  /* ---- the shaft: one box, dead vertical. */
  g.add(box(W, H, D, 0, MID, 0, { threshold: 1, width: 2.4 }));

  /* ---- the two mechanical bands, the strongest horizontals on the object. */
  const SEG = [
    [Y0, -0.51],
    [-0.435, 0.21],
    [0.285, TOP],
  ];
  const louvres = [];
  const terraces = [];
  for (const by of [-0.4725, 0.2475]) {
    g.add(box(0.684, 0.075, 0.544, 0, by, 0, { threshold: 1, width: 2.6 }));
    for (const o of [-0.022, 0, 0.022]) rect(0.344, 0.274, by + o, louvres);
    /* On the slab's top face, inset inside its own edge: a lit plant deck the
       shaft rises out of. On the underside it would simply never be seen. */
    rect(0.314, 0.244, by + 0.0395, terraces);
  }
  g.add(mesh(louvres, 0.34));
  g.add(edges(terraces, 1, 2.8));

  /* ---- seven ribs, full height. Their outer faces land at 0.282 and 0.352
     against the bands' 0.272 and 0.342. The positions are bay midpoints of
     the glazing grid below, chosen unevenly and differently on the front and
     the back, so no two faces read alike as the object turns. */
  for (const x of [-0.047, 0.141, 0.235]) {
    g.add(box(0.024, H, 0.048, x, MID, 0.258, { threshold: 1, width: 2 }));
  }
  for (const x of [-0.141, 0.047]) {
    g.add(box(0.024, H, 0.048, x, MID, -0.258, { threshold: 1, width: 2 }));
  }
  for (const z of [-0.141, 0.047]) {
    g.add(box(0.048, H, 0.024, 0.328, MID, z, { threshold: 1, width: 2 }));
  }

  /* ---- the service core. Deeper than the bands (0.60 against 0.544) so
     their end faces are buried rather than left hanging in open air, which is
     what a shallower blade would do twice over. It covers the whole -x face,
     so no glazing is drawn there and only the two +x corners get spines. */
  g.add(box(0.24, 1.88, 0.6, -0.31, -0.25, 0, { threshold: 1, width: 2.4 }));
  g.add(edges([V(-0.436, -1.15, 0), V(-0.436, 0.65, 0)], 1, 3.2));
  g.add(atoms([V(-0.37, 0.706, 0.22), V(-0.37, 0.706, -0.22)], 0.016, 1));

  /* ---- crown and cap. Exactly one inset step and then the oversail: a
     second step starts reading as taper again, which is the thing this whole
     rewrite exists to remove. */
  g.add(box(0.558, 0.19, 0.432, 0, 1.005, 0, { threshold: 1, width: 2.2 }));
  const crown = [];
  for (const y of [0.94, 0.978, 1.016, 1.054]) rect(0.283, 0.22, y, crown);
  g.add(edges(crown, 1, 2.8));
  g.add(box(0.73, 0.045, 0.59, 0, 1.1225, 0, { width: 2.6 }));
  g.add(
    atoms(
      [
        V(-0.352, 1.153, -0.282), V(0.352, 1.153, -0.282),
        V(-0.352, 1.153, 0.282), V(0.352, 1.153, 0.282),
      ],
      0.016,
      1
    )
  );

  /* ---- neon rects: the quadratic spacing that compresses toward the plaza,
     written out rather than looped, because three of the eleven had to go —
     one sat 0.018 from its neighbour, one landed inside the lower band, and
     one sat 0.033 above the upper band's edge, where two bright horizontals
     that close together read as a rendering fault. */
  const nb = [];
  for (const y of [-1.14, -1.068, -0.978, -0.852, -0.69, -0.258, 0.012, 0.66]) {
    rect(HW + 0.008, HD + 0.008, y, nb);
  }
  g.add(edges(nb, 0.95, 2.6));

  /* ---- corner spines, straight, broken at the bands, and brighter in the
     top segment: with no taper converging, the brightness step is what lifts
     the eye to the crown. */
  const lower = [];
  const upper = [];
  SEG.forEach(([y0, y1], i) => {
    for (const z of [-0.252, 0.252]) {
      (i === 2 ? upper : lower).push(V(0.322, y0 + 0.01, z), V(0.322, y1 - 0.01, z));
    }
  });
  g.add(edges(lower, 0.7, 2.6));
  g.add(edges(upper, 1, 3.4));

  /* ---- the glazing grain, and the storey heights the window lights use. */
  const MULL = [-0.0939, 0, 0.0939, 0.1879, 0.2818];
  const grid = [];
  const storeys = [];
  for (const [y0, y1] of SEG) {
    for (let y = y0 + 0.055; y < y1 - 0.02; y += 0.07) {
      storeys.push(y);
      grid.push(V(-HW, y, HD + 0.002), V(HW, y, HD + 0.002));
      grid.push(V(-HW, y, -HD - 0.002), V(HW, y, -HD - 0.002));
      grid.push(V(HW + 0.002, y, -HD), V(HW + 0.002, y, HD));
    }
    for (const x of MULL) grid.push(V(x, y0 + 0.02, 0.243), V(x, y1 - 0.02, 0.243));
  }
  g.add(mesh(grid, 0.26));

  /* ---- lit windows, snapped to the mullion columns and to the storey pitch.
     Free-floating lights read as noise against straight mullions, and it is
     the falling occupancy — 0.57 at the base, 0.05 at the crown — that empties
     the upper shaft without leaving a literal void in it. Fixed seed, so the
     building is identical on every visit. */
  const rand = noise(0x0ff1ce);
  const SIDE = [-0.1875, -0.0938, 0, 0.0938, 0.1875];
  const lit = [];
  for (const sy of storeys) {
    const y = sy + 0.035; // between the floor lines rather than on them
    const p = 0.52 * Math.pow(1 - (y - Y0) / H, 2) + 0.05;
    for (const x of MULL) if (rand() + 0.5 < p) lit.push(V(x, y, HD + 0.013));
    for (const z of SIDE) if (rand() + 0.5 < p * 0.6) lit.push(V(HW + 0.013, y, z));
    for (const x of MULL) if (rand() + 0.5 < p * 0.35) lit.push(V(x, y, -HD - 0.013));
  }
  g.add(atoms(lit, 0.019, 0.95));
  return g;
}

/* =============================================================== spectrum */
/* Sixteen activation trajectories along the token axis, and the six band
 * gates that edit them.
 *
 * The terrain is a real inverse DFT. Each row is one synthetic hidden
 * dimension as a signal over 128 token positions; closing a gate zeroes those
 * bins and the surface is rebuilt from the edited spectrum, so killing the low
 * bands flattens the broad swell and leaves the fine chatter behind, and
 * killing the high bands turns the chatter into smooth dunes. The signals are
 * an artistic impression of a hidden state rather than exported measurements —
 * the transform running over them is the real thing.
 *
 * The six pillars in front are the band energies, and they are the control:
 * a closed gate drops its pillar to a stub. Everything the interaction does is
 * geometry, so the section needs no chart and no numbers beside it. */
function buildSpectrum() {
  const COLS = N; // token positions
  const ROWS = 16; // hidden dimensions
  const W = 2.45;
  const D = 2.1;
  const H = 0.3; // the peak height of the terrain with every gate open
  const ACCENT_ROWS = new Set([3, 8, 13]);
  const TOTAL = ROWS * COLS;

  /* ---- the signals, and their spectra, computed once ---- */
  const rand = noise(0x5f3a91);
  const TAU = Math.PI * 2;
  const spectra = [];
  for (let r = 0; r < ROWS; r++) {
    const v = r / (ROWS - 1);
    const sig = new Float32Array(COLS);
    for (let n = 0; n < COLS; n++) {
      const u = n / COLS;
      sig[n] =
        0.2 * (v - 0.5) + // a per-row offset, so the DC gate has something to take
        /* One component per named band, on an exact bin so it belongs to that
           band alone, and declining with frequency so the pillars read as a
           spectrum rather than as a random skyline. */
        0.38 * Math.sin(u * TAU * 2 + v * 2.2) + // Low
        0.28 * Math.sin(u * TAU * 8 + v * 3.1) + // Medium Low
        0.18 * Math.sin(u * TAU * 16 + v * 1.4) + // Medium
        0.11 * Math.sin(u * TAU * 30 + v * 5) + // Medium High
        0.07 * Math.sin(u * TAU * 50 + v * 2.6) + // High
        rand() * 0.08; // broadband, spread across all of them
    }
    const re = new Float32Array(HALF + 1);
    const im = new Float32Array(HALF + 1);
    forward(sig, re, im);
    spectra.push({ re, im });
  }

  /* Band energy, averaged over the rows — the height of each pillar. */
  const energy = BANDS.map(b => {
    let sum = 0;
    for (const { re, im } of spectra) {
      for (let k = b.lo; k <= Math.min(b.hi, HALF); k++) sum += Math.hypot(re[k], im[k]);
    }
    return sum / ROWS;
  });
  const eMax = Math.max(...energy);

  /* ---- reconstruction ---- */
  const gain = new Float32Array(HALF + 1);
  const scratch = new Float32Array(COLS);

  /** One inverse pass per row, unscaled. Returns the rms of the result. */
  function rebuild(open, out) {
    bandGain(open, gain);
    let acc = 0;
    for (let r = 0; r < ROWS; r++) {
      inverse(spectra[r].re, spectra[r].im, gain, scratch);
      for (let n = 0; n < COLS; n++) {
        out[r * COLS + n] = scratch[n];
        acc += scratch[n] * scratch[n];
      }
    }
    return Math.sqrt(acc / TOTAL);
  }

  const open = BANDS.map(() => true);
  const curH = new Float32Array(TOTAL);
  const prevH = new Float32Array(TOTAL);
  const nextH = new Float32Array(TOTAL);

  /* Measure the all-open state first: everything after is scaled against it. */
  const RMS0 = rebuild(open, curH);
  let peak = 0;
  for (let n = 0; n < TOTAL; n++) peak = Math.max(peak, Math.abs(curH[n]));
  const UNIT = H / (peak || 1);

  function reconstruct(next, out) {
    const rms = rebuild(next, out);
    /* Closing the low bands drops the amplitude by a factor of five, which
       would read as "the object broke" rather than "that structure lived in
       those bins". So the terrain is pulled part of the way back: the collapse
       still shows, and whatever survived it stays legible. */
    const k = rms < 1e-6 ? 0 : Math.min(UNIT * Math.pow(RMS0 / rms, 0.55), UNIT * 3.2);
    for (let n = 0; n < TOTAL; n++) out[n] *= k;
  }

  reconstruct(open, curH);
  nextH.set(curH);

  /* ---- geometry ---- */
  const geo = new THREE.PlaneGeometry(W, D, COLS - 1, ROWS - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;

  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, bodyMaterial()));

  /* Ridgelines, split in two so a few rows read in full accent while the rest
     stay texture. One LineSegments2 each, rewritten in place as the terrain
     moves — these are the thing being watched, so they pay for width. */
  const lines = [];
  for (const [accent, opacity, width] of [[false, 0.26, 1.2], [true, 1, 2.8]]) {
    const rows = [...Array(ROWS).keys()].filter(r => ACCENT_ROWS.has(r) === accent);
    const buf = new Float32Array(rows.length * (COLS - 1) * 6);
    const obj = new LineSegments2(new LineSegmentsGeometry(), fatMaterial(opacity, width));
    lines.push({ rows, buf, obj });
    g.add(obj);
  }

  /* The eight gates, standing in front of the terrain. Each pillar's geometry
     is translated so its base sits at y = 0 and scale.y grows upward. */
  const blade = h => {
    const b = new THREE.BoxGeometry(0.065, h, 0.065);
    b.translate(0, h / 2, 0);
    return solid(b, { edgeOpacity: 1, width: 2 });
  };
  const BASE = -H * 0.9;
  const Z = D / 2 + 0.28;
  const SPAN = W * 0.86;
  const slotX = n => (n / (BANDS.length - 1) - 0.5) * SPAN;
  const pillars = BANDS.map((b, n) => {
    const p = blade(0.12 + 0.55 * (energy[n] / eMax));
    p.position.set(slotX(n), BASE, Z);
    g.add(p);
    return p;
  });
  /* One rail under the whole row, with a tick in every slot: a closed gate
     drops to nothing, and the rail is what shows there was something there. */
  const rail = [
    new THREE.Vector3(-SPAN / 2 - 0.1, BASE, Z),
    new THREE.Vector3(SPAN / 2 + 0.1, BASE, Z),
  ];
  for (let n = 0; n < BANDS.length; n++) {
    rail.push(
      new THREE.Vector3(slotX(n), BASE, Z - 0.06),
      new THREE.Vector3(slotX(n), BASE, Z + 0.06)
    );
  }
  g.add(edges(rail, 0.55, 1.8));
  const prevS = pillars.map(() => 1);
  const nextS = pillars.map(() => 1);
  const curS = pillars.map(() => 1);

  /* ---- writing the current state into the buffers ---- */
  function apply() {
    for (let n = 0; n < TOTAL; n++) pos.setY(n, curH[n]);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    for (const { rows, buf, obj } of lines) {
      let o = 0;
      for (const row of rows) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = row * COLS + c;
          buf[o++] = pos.getX(a);
          buf[o++] = curH[a] + 0.006;
          buf[o++] = pos.getZ(a);
          buf[o++] = pos.getX(a + 1);
          buf[o++] = curH[a + 1] + 0.006;
          buf[o++] = pos.getZ(a + 1);
        }
      }
      obj.geometry.setPositions(buf);
    }
    for (let n = 0; n < pillars.length; n++) pillars[n].scale.y = curS[n];
  }
  apply();

  /* ---- the interface the scene drives ---- */
  const MORPH = 620;
  let t = 1;
  g.userData.bands = {
    names: BANDS.map(b => b.name),
    open,
    set(next) {
      for (let n = 0; n < open.length; n++) open[n] = next[n] !== false;
      reconstruct(open, nextH);
      prevH.set(curH);
      for (let n = 0; n < pillars.length; n++) {
        prevS[n] = curS[n];
        nextS[n] = open[n] ? 1 : 0.05;
      }
      t = 0;
    },
    /** Returns true while the terrain is still moving. */
    step(dt) {
      if (t >= 1) return false;
      t = Math.min(1, t + dt / MORPH);
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      for (let n = 0; n < TOTAL; n++) curH[n] = prevH[n] + (nextH[n] - prevH[n]) * e;
      for (let n = 0; n < pillars.length; n++) curS[n] = prevS[n] + (nextS[n] - prevS[n]) * e;
      apply();
      return t < 1;
    },
  };

  g.position.y = -0.04;
  /* The surface lies flat in xz; without its own tilt the shared camera angle
     looks straight along it and a landscape becomes a line. */
  g.rotation.x = 0.5;
  g.userData.fit = 1.78;
  return g;
}

/* ================================================================ orbital */
/* A 3d electron cloud, sampled rather than shelled.
 *
 * The first version of this was a hard isosurface of |sin^2(theta) sin(2phi)|,
 * which is correct and inert: an orbital is not a shell with a skin, it is a
 * probability density, and drawing it as a membrane throws away the only
 * interesting thing about it. So this samples |psi|^2 directly — rejection
 * sampling against the hydrogenic 3d_xy state, radial part r^2 e^(-r/3) and
 * angular part sin^2(theta) sin(2phi) — and draws the accepted points. Dense
 * where the electron is likely, thin where it is not, four lobes and two nodal
 * planes falling out of the maths rather than being modelled.
 *
 * Points are split into three populations by local density so the lobe cores
 * can be drawn brighter and larger than the haze, which is what gives the
 * cloud depth. A faint rib shell is kept underneath at low opacity, purely so
 * the lobes have an edge to read against. */
function buildOrbital() {
  const rand = noise(0x3d0f2b);
  const uni = () => rand() + 0.5; // [0, 1)

  /* Radial: |R_32|^2 r^2 proportional to r^6 e^(-2r/3), peaking at r = 9 a0.
     Sampled by rejection, then the whole cloud is scaled to the frame. */
  const radial = r => Math.pow(r, 6) * Math.exp((-2 * r) / 3);
  const radialPeak = radial(9);
  const sampleR = () => {
    for (let k = 0; k < 200; k++) {
      const r = uni() * 30;
      if (uni() * radialPeak < radial(r)) return r;
    }
    return 9;
  };

  /* Angular: the real 3d_xy form. Its square is the acceptance test, and the
     value is kept so the brighter cells can be drawn brighter. */
  const angular = (theta, phi) => Math.sin(theta) ** 2 * Math.sin(2 * phi);

  const core = [];
  const mid = [];
  const haze = [];
  const TARGET = 5200;
  let guard = 0;
  while (core.length + mid.length + haze.length < TARGET && guard++ < 400000) {
    const theta = Math.acos(1 - 2 * uni());
    const phi = uni() * Math.PI * 2;
    const a = angular(theta, phi);
    const density = a * a;
    if (uni() > density) continue; // reject: the electron is not here
    const r = sampleR();
    const v = new THREE.Vector3(
      r * Math.sin(theta) * Math.cos(phi),
      r * Math.cos(theta),
      r * Math.sin(theta) * Math.sin(phi)
    );
    (density > 0.78 ? core : density > 0.38 ? mid : haze).push(v);
  }

  /* Scale to the frame off the sampled spread rather than a guessed constant:
     the radial tail is long and a fixed divisor either crops or shrinks it. */
  const all = [...core, ...mid, ...haze];
  const radii = all.map(v => v.length()).sort((x, y) => x - y);
  const p98 = radii[Math.floor(radii.length * 0.98)] || 20;
  const k = 1.5 / p98;
  for (const v of all) v.multiplyScalar(k);

  const cloud = pts => {
    const a = new Float32Array(pts.length * 3);
    pts.forEach((v, n) => {
      a[n * 3] = v.x;
      a[n * 3 + 1] = v.y;
      a[n * 3 + 2] = v.z;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
    return geo;
  };

  const g = new THREE.Group();
  g.add(new THREE.Points(cloud(haze), pointMaterial(0.022, 0.3)));
  g.add(new THREE.Points(cloud(mid), pointMaterial(0.03, 0.6)));
  g.add(new THREE.Points(cloud(core), pointMaterial(0.042, 0.95)));

  /* A faint shell at one contour, drawn as rings of latitude only — a full
     wireframe at this density is mush, and the point is just to give the
     lobes an edge. */
  const NU = 64;
  const NV = 34;
  const R = 1.42;
  const P = (u, v) => {
    const theta = (v / NV) * Math.PI;
    const phi = (u / NU) * Math.PI * 2;
    const rr = Math.abs(angular(theta, phi)) * R;
    return new THREE.Vector3(
      rr * Math.sin(theta) * Math.cos(phi),
      rr * Math.cos(theta),
      rr * Math.sin(theta) * Math.sin(phi)
    );
  };
  const ribs = [];
  for (let v = 3; v < NV; v += 5) {
    for (let u = 0; u < NU; u++) ribs.push(P(u, v), P(u + 1, v));
  }
  g.add(edges(ribs, 0.22, 1.4));

  g.add(atoms([new THREE.Vector3(0, 0, 0)], 0.062, 1));
  g.rotation.x = 0.16;
  /* The cloud is wider than it is tall; let it fill the frame on its own
     terms rather than through the generic sweep estimate. */
  g.userData.fit = 1.58;
  return g;
}

/* =============================================================== wurtzite */
/* Gallium nitride in the wurtzite structure: two interpenetrating hexagonal
   sublattices, u = 3/8, c/a = 1.633, every gallium tetrahedrally bonded to
   four nitrogens. The degeneracy demo moves the pair at the front. */
function buildWurtzite() {
  const a = 0.62;
  const c = a * 1.633;
  const u = 0.375;
  const A1 = new THREE.Vector3(a, 0, 0);
  const A2 = new THREE.Vector3(-a / 2, 0, (a * Math.sqrt(3)) / 2);
  const A3 = new THREE.Vector3(0, c, 0);

  const place = (f1, f2, f3) =>
    new THREE.Vector3().addScaledVector(A1, f1).addScaledVector(A2, f2).addScaledVector(A3, f3);

  const basis = [
    { f: [0, 0, 0], el: 'Ga' },
    { f: [1 / 3, 2 / 3, 0.5], el: 'Ga' },
    { f: [0, 0, u], el: 'N' },
    { f: [1 / 3, 2 / 3, 0.5 + u], el: 'N' },
  ];

  const ga = [];
  const n = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (let k = -1; k <= 0; k++) {
        for (const b of basis) {
          const p = place(b.f[0] + i, b.f[1] + j, b.f[2] + k);
          p.y += c * 0.25;
          if (p.length() > 1.7) continue;
          (b.el === 'Ga' ? ga : n).push(p);
        }
      }
    }
  }

  /* Ga–N bonds. Both the axial and the three basal bonds come out at 0.612a
     in ideal wurtzite, so a single cutoff catches all four. */
  const bonds = [];
  const cutoff = 0.68 * a;
  for (const p of ga) for (const q of n) if (p.distanceTo(q) < cutoff) bonds.push(p, q);

  const g = new THREE.Group();
  g.add(edges(bonds, 0.95, 2.7));
  g.add(atoms(ga, 0.072, 1));
  g.add(atoms(n, 0.046, 0.55));

  /* The pair the degeneracy demo collapses, kept as its own meshes so the
     scene can move them without touching the instanced lattice. */
  const pairGeo = new THREE.IcosahedronGeometry(0.1, 0);
  const left = new THREE.Mesh(pairGeo, glowMaterial(1));
  const right = new THREE.Mesh(pairGeo, glowMaterial(1));
  left.name = 'degenerate-a';
  right.name = 'degenerate-b';
  left.position.set(-0.3, 0.12, 0.42);
  right.position.set(0.3, 0.12, 0.42);
  left.userData.home = left.position.clone();
  right.userData.home = right.position.clone();
  g.add(left, right);

  /* The error cross, hidden until the demo runs. */
  const cross = new LineSegments2(
    new LineSegmentsGeometry().setPositions(
      flatten([
        new THREE.Vector3(-0.15, -0.15, 0), new THREE.Vector3(0.15, 0.15, 0),
        new THREE.Vector3(0.15, -0.15, 0), new THREE.Vector3(-0.15, 0.15, 0),
      ])
    ),
    (() => {
      const m = new LineMaterial({ color: 0xff5d5d, linewidth: 3, transparent: true, opacity: 0 });
      m.userData.role = 'error';
      m.userData.baseOpacity = 1;
      lineMaterials.push(m);
      return m;
    })()
  );
  cross.name = 'degenerate-cross';
  cross.position.set(0, 0.12, 0.42);
  g.add(cross);
  g.rotation.x = 0.14;
  return g;
}

/* ------------------------------------------------------------------ index */
const BUILDERS = {
  galaxy: buildGalaxy,
  crystal: buildCrystal,
  tower: buildTower,
  pagoda: buildPagoda,
  office: buildOffice,
  spectrum: buildSpectrum,
  orbital: buildOrbital,
  wurtzite: buildWurtzite,
};

const cache = new Map();

/** Build (once) and return the named object, or the crystal if unknown. */
export function getModel(name) {
  const key = BUILDERS[name] ? name : 'crystal';
  if (!cache.has(key)) {
    const group = BUILDERS[key]();
    group.userData.name = key;
    /* Recentre on the origin. The camera looks at (0,0,0), so an object whose
       mass sits off to one side would be framed off-centre and crop. */
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (!box.isEmpty()) {
      group.position.sub(box.getCenter(new THREE.Vector3()));
    }
    /* Collect every material once so retinting and fading is a flat loop. */
    const mats = [];
    group.traverse(o => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!mats.includes(m)) mats.push(m);
      }
    });
    group.userData.materials = mats;
    cache.set(key, group);
  }
  return cache.get(key);
}

/*
 * scene.js — the WebGL stage the objects stand on.
 *
 * One renderer, one camera, one light rig, and whichever object the section
 * you are reading calls for. Changing section cross-fades the old object out
 * and the new one in rather than morphing between them: these are buildings
 * and molecules, not variations on a theme, and a tween between a bell tower
 * and an orbital is a mess rather than an idea.
 *
 * The whole module degrades to nothing if WebGL is unavailable or the visitor
 * asks for reduced motion — the page never depends on it for meaning.
 */

import * as THREE from '../vendor/three.module.min.js';
import { getModel, setLineResolution } from './models.js';

const FOV = 38;
const FIT_MARGIN = 1.06; // breathing room around the measured bounding sphere
const FADE_MS = 620;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* The resting attitude: a little off-axis so the first frame already reads as
   three-dimensional. */
const HOME = new THREE.Quaternion();
{
  const a = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.42);
  const b = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.17);
  HOME.copy(b).multiply(a);
}

/**
 * @param {HTMLElement} host    element the canvas fills; also the drag target
 * @param {object}      [opts]
 * @param {boolean}     [opts.motion=true] false => one static frame, no loop
 * @param {string}      [opts.initial]     model to start on, so the first
 *        frame is already the right object rather than a default that gets
 *        cross-faded away a moment later
 * @returns {object|null} null when WebGL could not start
 */
export function mountScene(host, opts = {}) {
  const motion = opts.motion !== false;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return null; // no WebGL: the caller drops the pane and reclaims the space
  }
  if (!renderer.getContext()) return null;

  renderer.setClearAlpha(0);
  renderer.domElement.className = 'stage-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  const root = new THREE.Group();
  scene.add(root);

  /* Light rig. Key from the upper left so the faceting reads, a cool fill
     from below to keep the shadow side from going flat black, and a rim light
     that takes the section accent so the silhouette picks it up. */
  const hemi = new THREE.HemisphereLight(0x22303c, 0x05070a, 1.1);
  const key = new THREE.DirectionalLight(0xdfe9f2, 1.5);
  key.position.set(-2.4, 3.2, 2.6);
  const rim = new THREE.DirectionalLight(0x8ee6ff, 1.25);
  rim.position.set(2.8, -0.6, -2.2);
  scene.add(hemi, key, rim);

  const accent = new THREE.Color(0x8ee6ff);

  /* ------------------------------------------------------------- state */
  let W = 1;
  let H = 1;
  let raf = 0;
  let last = 0;
  let paused = false;
  let visible = true;
  let calm = 1;
  let calmTarget = 1;

  let from = null;
  let to = null;
  let fitRadius = 1.7;
  let fitTarget = 1.7;
  let mix = 1; // 0 = fully `from`, 1 = fully `to`
  let fadeStart = 0;

  const q = HOME.clone();
  const spinQ = new THREE.Quaternion();
  const AX_Y = new THREE.Vector3(0, 1, 0);
  const AX_X = new THREE.Vector3(1, 0, 0);
  let spinVel = 0;
  let tiltVel = 0;
  let homing = false;

  let degenOn = 0;
  let degenTarget = 0;
  /* The band gates belong to the page, not to the model: the surface is
     rebuilt from the cache when the section comes back, so the setting has
     to be re-applied to whatever model turns out to own it. */
  let bandState = null;
  let degenFixed = 0;
  let degenFixedTarget = 0;

  function spin(axis, angle) {
    spinQ.setFromAxisAngle(axis, angle);
    q.premultiply(spinQ);
  }

  /* -------------------------------------------------------------- size */
  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    /* Clamped below as well as above: zooming out drops devicePixelRatio
       under 1, and following it would render fewer pixels than the canvas
       occupies. */
    renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, 2));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;

    placeCamera();

    /* CSS pixels, not device pixels. The fat-line shader divides its offset by
       resolution.y, so passing the device size makes every structural line
       `linewidth / devicePixelRatio` CSS pixels wide — on a 150%-scaled or
       retina display that quietly thins the whole object into invisibility. */
    setLineResolution(W, H);
    if (!motion) draw(16.7);
  }

  /* Pull the camera back far enough that the object fits whichever of the two
     dimensions is tighter, so a tall narrow pane never crops it. */
  function placeCamera() {
    const halfV = Math.tan((FOV / 2) * (Math.PI / 180));
    camera.position.set(0, 0, (fitRadius * FIT_MARGIN) / Math.min(halfV, halfV * camera.aspect));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  const _box = new THREE.Box3();
  const _size = new THREE.Vector3();
  /* Not the bounding sphere: for a boxy object its radius is the half-diagonal,
     which is 1.73x the half-side on a cube and would leave the thing floating
     at two-thirds size. The object only ever spins about y with a modest tilt,
     so the radius that matters is the one swept in the xz-plane. */
  function measure(group) {
    const keep = group.scale.x;
    group.scale.setScalar(1);
    group.updateMatrixWorld(true);
    _box.setFromObject(group);
    group.scale.setScalar(keep);
    if (_box.isEmpty()) return 1.7;
    /* A model already symmetric about y — a disc, a shell — can say how wide
       it really is, because the sweep below over-counts it by root two. */
    if (group.userData.fit) return group.userData.fit;
    _box.getSize(_size);
    const hx = _size.x / 2, hy = _size.y / 2, hz = _size.z / 2;
    return Math.max(Math.hypot(hx, hz), hy) * 1.08;
  }

  /* ------------------------------------------------------------- frame */
  function applyOpacity(group, weight) {
    for (const m of group.userData.materials) {
      if (m.userData.role === 'error') continue; // the demo owns this one
      m.opacity = (m.userData.baseOpacity ?? 1) * weight;
      m.visible = m.opacity > 0.004;
    }
  }

  function tintGroup(group) {
    for (const m of group.userData.materials) {
      if (m.userData.role === 'edge' || m.userData.role === 'glow') m.color?.copy(accent);
    }
  }

  function updateDegeneracy(group) {
    if (group.userData.name !== 'wurtzite') return;
    const a = group.getObjectByName('degenerate-a');
    const b = group.getObjectByName('degenerate-b');
    const cross = group.getObjectByName('degenerate-cross');
    if (!a || !b || !cross) return;
    const ha = a.userData.home;
    const hb = b.userData.home;
    /* Collapse the pair onto their midpoint, then push them apart again once
       the second bullet is read — the whole result in one gesture. */
    const mid = (ha.x + hb.x) / 2;
    const split = 0.42 * degenFixed;
    a.position.x = THREE.MathUtils.lerp(ha.x, mid - split, degenOn);
    b.position.x = THREE.MathUtils.lerp(hb.x, mid + split, degenOn);
    a.position.y = ha.y + 0.26 * degenFixed;
    b.position.y = hb.y - 0.26 * degenFixed;
    cross.material.opacity = degenOn * (1 - degenFixed) * 0.95;
    cross.material.visible = cross.material.opacity > 0.01;
  }

  function draw(dt) {
    const k = dt / 16.667;
    calm += (calmTarget - calm) * Math.min(1, 0.08 * k);
    degenOn += (degenTarget - degenOn) * Math.min(1, 0.09 * k);
    degenFixed += (degenFixedTarget - degenFixed) * Math.min(1, 0.09 * k);

    if (mix < 1) mix = motion ? Math.min(1, (performance.now() - fadeStart) / FADE_MS) : 1;

    if (Math.abs(fitTarget - fitRadius) > 0.002) {
      fitRadius += (fitTarget - fitRadius) * Math.min(1, (motion ? 0.09 : 1) * k);
      placeCamera();
    }

    if (homing) {
      q.slerp(HOME, Math.min(1, 0.1 * k));
      if (q.angleTo(HOME) < 0.004) {
        q.copy(HOME);
        homing = false;
      }
      spinVel = tiltVel = 0;
    } else if (!dragging && motion) {
      spin(AX_Y, 0.00005 * dt * calm);
      const decay = Math.pow(0.92, k);
      spinVel *= decay;
      tiltVel *= decay;
      if (Math.abs(spinVel) > 1e-5) spin(AX_Y, spinVel * dt * 0.001);
      if (Math.abs(tiltVel) > 1e-5) spin(AX_X, tiltVel * dt * 0.001);
    }
    root.quaternion.copy(q);

    const m = easeInOut(mix);
    if (from && from !== to) {
      applyOpacity(from, 1 - m);
      from.scale.setScalar(1 - 0.12 * m);
      if (m >= 1) {
        root.remove(from);
        from = null;
      }
    }
    if (to) {
      applyOpacity(to, m);
      to.scale.setScalar(0.88 + 0.12 * m);
      updateDegeneracy(to);
      /* A gate change deforms real geometry over half a second. It is not
         autonomous motion, so the Reading Guard does not damp it. */
      to.userData.bands?.step(dt);
    }

    renderer.render(scene, camera);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(64, now - last) : 16.667;
    last = now;
    if (paused || !visible) return;
    draw(dt);
  }

  /* ----------------------------------------------------------- pointer */
  const ac = new AbortController();
  const on = (el, ev, fn, o) => el.addEventListener(ev, fn, { signal: ac.signal, ...o });

  let dragId = null;
  let dragging = false;
  let pendingTouch = false;
  let fromPt = [0, 0];
  let lastPt = [0, 0];
  let lastT = 0;

  function release() {
    if (dragId !== null) {
      try { host.releasePointerCapture(dragId); } catch { /* already gone */ }
    }
    dragId = null;
    dragging = false;
    pendingTouch = false;
    host.dataset.dragging = 'false';
  }

  on(host, 'pointerdown', e => {
    if (!motion || dragId !== null || e.isPrimary === false) return;
    if (e.pointerType !== 'touch' && e.button !== 0) return;
    dragId = e.pointerId;
    pendingTouch = e.pointerType === 'touch';
    fromPt = lastPt = [e.clientX, e.clientY];
    lastT = e.timeStamp;
    spinVel = tiltVel = 0;
    homing = false;
    if (!pendingTouch) {
      dragging = true;
      host.dataset.dragging = 'true';
      try { host.setPointerCapture(dragId); } catch { /* not capturable */ }
    }
  });

  on(host, 'pointermove', e => {
    if (e.pointerId !== dragId) return;
    /* On touch, only take over once the gesture is clearly horizontal —
       otherwise the page has to keep scrolling. */
    if (pendingTouch) {
      const adx = Math.abs(e.clientX - fromPt[0]);
      const ady = Math.abs(e.clientY - fromPt[1]);
      if (Math.max(adx, ady) < 8) return;
      if (ady >= adx) { release(); return; }
      dragging = true;
      pendingTouch = false;
      host.dataset.dragging = 'true';
      try { host.setPointerCapture(dragId); } catch { /* not capturable */ }
    }
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();

    const unit = Math.PI / Math.max(220, Math.min(W, H));
    const dx = (e.clientX - lastPt[0]) * unit;
    const dy = (e.clientY - lastPt[1]) * unit;
    const span = clamp((e.timeStamp - lastT) / 1000, 0.008, 0.08);
    spinVel = spinVel * 0.25 + clamp(dx / span, -9, 9) * 0.75;
    tiltVel = tiltVel * 0.25 + clamp(dy / span, -9, 9) * 0.75;
    spin(AX_Y, dx);
    spin(AX_X, dy);
    lastPt = [e.clientX, e.clientY];
    lastT = e.timeStamp;
  });

  on(host, 'pointerup', e => {
    if (e.pointerId !== dragId) return;
    if (!dragging || e.timeStamp - lastT > 120) spinVel = tiltVel = 0;
    release();
  });
  on(host, 'pointercancel', e => { if (e.pointerId === dragId) release(); });
  on(host, 'lostpointercapture', e => { if (e.pointerId === dragId) release(); });
  on(host, 'dblclick', () => { homing = true; });

  /* -------------------------------------------------------------- life */
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  on(window, 'resize', resize);
  on(document, 'visibilitychange', () => {
    if (!motion) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && !paused) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  });

  /* Nothing is rendered while the pane is scrolled out of sight. */
  const vis = new IntersectionObserver(
    entries => { visible = entries[0]?.isIntersecting ?? true; },
    { threshold: 0 }
  );
  vis.observe(host);

  resize();
  setModel(opts.initial || 'crystal');
  draw(16.667); // one synchronous frame, so a background tab is not blank
  if (motion) raf = requestAnimationFrame(frame);

  function setModel(name) {
    const next = getModel(name);
    if (next === to) return;
    if (from && from !== to && from.parent) root.remove(from);
    from = to;
    to = next;
    tintGroup(to);
    fitTarget = measure(to);
    if (!from) {
      fitRadius = fitTarget;
      placeCamera();
    }
    to.scale.setScalar(motion ? 0.88 : 1);
    /* Into `root`, not the scene: `root` is what carries the rotation, and
       a model parented to the scene would sit there perfectly still. */
    applyOpacity(to, motion ? 0 : 1);
    if (bandState && to.userData.bands) {
      to.userData.bands.set(bandState);
      while (to.userData.bands.step(1e4));
    }
    root.add(to);
    mix = motion ? 0 : 1;
    fadeStart = performance.now();
    if (!motion) draw(16.667);
  }

  return {
    setModel,
    setAccent(hex) {
      accent.set(hex);
      rim.color.copy(accent).lerp(new THREE.Color(0xffffff), 0.25);
      if (to) tintGroup(to);
      if (from) tintGroup(from);
      if (!motion) draw(16.667);
    },
    /** Reading Guard: 1 = full motion, 0 = everything autonomous stopped. */
    setCalm(v) { calmTarget = clamp(v, 0, 1); },
    /** Eight booleans, one per frequency band. true = the band is open. */
    setBands(open) {
      bandState = open.slice();
      const bands = to?.userData.bands;
      if (!bands) return; // a section without a gated model: kept for later
      bands.set(bandState);
      if (!motion || paused) {
        while (bands.step(1e4));
        draw(16.667);
      }
    },
    setDegeneracy(on, resolved = false) {
      degenTarget = on ? 1 : 0;
      degenFixedTarget = resolved ? 1 : 0;
      if (!motion) {
        /* Easing runs per frame, and a static renderer only ever draws one,
           so it would otherwise show a ninth of the gesture. Snap to the end
           state: what matters is where the two atoms end up, not the travel. */
        degenOn = degenTarget;
        degenFixed = degenFixedTarget;
        draw(16.667);
      }
    },
    toggle(force) {
      paused = force === undefined ? !paused : !!force;
      if (paused) {
        cancelAnimationFrame(raf);
        raf = 0;
        /* Snap any half-finished deformation to its end state: a terrain
           stopped mid-morph reads as broken rather than as halted. */
        if (to?.userData.bands) {
          while (to.userData.bands.step(1e4));
          draw(16.667);
        }
      } else if (!raf && motion && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
      return paused;
    },
    home() { homing = true; },
    isStatic: () => !motion,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      vis.disconnect();
      ac.abort();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

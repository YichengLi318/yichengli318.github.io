/*
 * app.js — wiring. The page works with this file absent: every word is in the
 * HTML, every section is reachable by scrolling. Everything here is addition.
 *
 *   scrollspy      the read section goes live; the rest desaturate to steel
 *   stage          the object beside the text follows what you are reading
 *   rail           ticks at each section's real scroll offset, plus progress
 *   reading guard  600ms of stillness over prose damps the object
 *   count-up       metric strips animate once, with width reserved
 *   degeneracy     the DeepH bullets drive the failure demo in the crystal
 *   palette        Cmd/Ctrl-K, number keys, j/k
 *
 * Layout reads stay out of the scroll path: section geometry is measured in
 * layoutRail and cached, so the scroll handler itself never touches layout.
 */

import { mountScene } from './scene.js';

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover: hover)').matches;

/* A weak machine is exactly where a janky canvas does the most damage, so it
   gets a single static frame rather than a degraded animation. The first
   three signals are Chromium-only, so `(update: slow)` carries the rest. */
const cores = navigator.hardwareConcurrency ?? 8;
const memory = navigator.deviceMemory ?? 8;
const saveData = navigator.connection?.saveData === true;
const slowPaint = matchMedia('(update: slow)').matches;
const weak = cores < 4 || memory < 4 || saveData || slowPaint;
const animate = !reduced && !weak;

const sections = [...document.querySelectorAll('main .deck')];

root.dataset.enhanced = '';
if (!animate) root.dataset.still = '';

/* Focus has to be able to land on a section, or `jump` moves the viewport and
   leaves the keyboard at the top of the document. */
sections.forEach(s => s.setAttribute('tabindex', '-1'));

const ownAccent = el => getComputedStyle(el).getPropertyValue('--own').trim();
const debounce = (fn, ms) => {
  let t = 0;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/* ================================================================ stage */
/* WebGL can fail outright — an old driver, a blocklisted GPU, a context the
   browser refuses to give. When it does, the pane is removed and the reading
   column takes the full width rather than sitting next to a dead rectangle. */
const stageEl = document.getElementById('stage');
/* Start on the object the first section actually asks for, so the opening
   frame is not a default that gets cross-faded away a moment later. */
const firstModel = document.querySelector('main [data-model]')?.dataset.model;
const stage = stageEl ? mountScene(stageEl, { motion: animate, initial: firstModel }) : null;
if (stage) {
  root.dataset.stageReady = '';
} else {
  stageEl?.remove();
  root.dataset.noStage = '';
  console.warn(
    'yichengli318.github.io: WebGL did not start, so the objects beside the ' +
      'text are not shown. The page is complete without them.'
  );
}

/* ============================================================= scrollspy */
let current = null;

function setLive(section) {
  if (!section || section === current) return;
  current?.removeAttribute('data-current');
  section.dataset.current = '';
  current = section;

  const accent = ownAccent(section);
  root.style.setProperty('--accent-live', accent);
  stage?.setAccent(accent);

  for (const item of railItems) {
    if (item.dataset.for === section.id) item.dataset.current = '';
    else item.removeAttribute('data-current');
  }
}

/* -45% top and bottom means the live section is whichever one owns the middle
   of the viewport — no ambiguity, never two at once. */
const spy = new IntersectionObserver(
  entries => {
    for (const e of entries) if (e.isIntersecting) setLive(e.target);
  },
  { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
);
sections.forEach(s => spy.observe(s));

/* The object is chosen by the nearest [data-model], which is usually the
   section but is an individual entry where one section holds two — the
   education page swaps the bell tower for the library as you move down it. */
if (stage) {
  const modelSpy = new IntersectionObserver(
    entries => {
      for (const e of entries) if (e.isIntersecting) stage.setModel(e.target.dataset.model);
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
  );
  document.querySelectorAll('main [data-model]').forEach(el => modelSpy.observe(el));

  /* Hovering an entry brings its object forward without waiting for scroll. */
  if (canHover) {
    for (const el of document.querySelectorAll('.entry[data-model]')) {
      el.addEventListener('pointerenter', () => stage.setModel(el.dataset.model));
    }
  }
}

/* ================================================================== rail */
const railList = document.querySelector('.rail-list');
const railItems = [];

sections.forEach((section, i) => {
  const li = document.createElement('li');
  li.className = 'rail-item';
  li.dataset.for = section.id;
  const a = document.createElement('a');
  a.className = 'rail-link';
  a.href = `#${section.id}`;
  const label = section.dataset.label || section.id;
  /* The visible name is hidden on the mobile dock, so the accessible name
     comes from the attribute rather than from the span. */
  a.setAttribute('aria-label', `${String(i).padStart(2, '0')} ${label}`);
  a.innerHTML =
    `<span class="rail-idx" aria-hidden="true">${String(i).padStart(2, '0')}</span>` +
    '<span class="rail-tick" aria-hidden="true"></span>' +
    `<span class="rail-name" aria-hidden="true">${label}</span>`;
  li.append(a);
  railList.append(li);
  railItems.push(li);
});

/* Geometry cache. Everything the scroll handler needs is measured here, so the
   handler never touches layout. */
let docH = 1;
let viewH = 1;
const geom = sections.map(() => ({ top: 0, height: 1 }));

function layoutRail() {
  docH = root.scrollHeight;
  viewH = innerHeight;
  sections.forEach((section, i) => {
    geom[i].top = section.offsetTop;
    geom[i].height = Math.max(1, section.offsetHeight);
  });
  const wide = innerWidth > 900;
  const tops = geom.map(g => 10 + ((g.top + g.height / 2) / Math.max(1, docH)) * 80);
  railItems.forEach((li, i) => {
    li.style.top = wide ? `${tops[i]}%` : '';
  });
}

/* ====================================================== scroll progress */
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const max = docH - viewH;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    railList?.style.setProperty('--scroll-progress', `${(p * 100).toFixed(2)}%`);
  });
}
addEventListener('scroll', onScroll, { passive: true });

/* ========================================================= reading guard */
/* The object turns while you move and settles the moment you stop on a block
   of prose. Automatic — there is no control for it, and none is needed. */
const PROSE = '.col, .entry, .bullets, .metrics, .work, .awards';
let guardTimer = 0;
let overProse = false;
let halted = false;
let pinnedStill = false;
let calm = 'live';

function setCalm(next) {
  if (calm === next) return;
  calm = next;
  stage?.setCalm(next === 'still' ? 0.12 : 1);
}

function wake() {
  if (halted || pinnedStill || !animate) return;
  setCalm('live');
  clearTimeout(guardTimer);
  if (overProse) guardTimer = setTimeout(() => setCalm('still'), 600);
}

addEventListener(
  'pointermove',
  e => {
    overProse = e.target instanceof Element ? !!e.target.closest(PROSE) : false;
    wake();
  },
  { passive: true }
);
addEventListener('wheel', wake, { passive: true });
addEventListener('scroll', wake, { passive: true });

/* Motion is on by default and has no visible toggle. `H` remains as a quiet
   escape hatch for anyone the movement bothers who has not set the system
   preference — it costs nothing and removing it would leave them stuck. */
function setHalted(next) {
  if (!animate) return;
  halted = next;
  clearTimeout(guardTimer);
  stage?.toggle(halted);
  root.dataset.motion = halted ? 'off' : 'on';
  if (!halted) wake();
}

/* ============================================================== count-up */
/* Numbers animate once, on first reveal, into a width reserved from the final
   string so nothing reflows. Under reduced motion the value is just written. */
const counters = [...document.querySelectorAll('[data-count]')];
for (const el of counters) {
  const final = el.textContent;
  /* min-width is ignored on a non-replaced inline element. */
  el.style.display = 'inline-block';
  el.style.minWidth = `${final.length}ch`;
  el.dataset.final = final;
  if (animate) el.textContent = `${el.dataset.prefix || ''}0${el.dataset.suffix || ''}`;
}

if (animate && counters.length) {
  const countObs = new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        runCount(e.target);
      }
    },
    { threshold: 0.6 }
  );
  counters.forEach(el => countObs.observe(el));
}

function runCount(el) {
  const to = Number(el.dataset.count);
  const dp = Number(el.dataset.decimals || 0);
  const pre = el.dataset.prefix || '';
  const suf = el.dataset.suffix || '';
  const start = performance.now();
  const tick = now => {
    const t = Math.min(1, (now - start) / 650);
    el.textContent = pre + (to * (1 - Math.pow(1 - t, 3))).toFixed(dp) + suf;
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = el.dataset.final;
  };
  requestAnimationFrame(tick);
}

/* ============================================================ band gates */
/* Eight toggles over the Activation-FFT terrain. The page holds the setting
 * and the scene re-applies it to whichever model owns the gates, so a section
 * change — which swaps the model out and later pulls it back from the cache —
 * cannot leave the buttons describing a surface that no longer matches them.
 *
 * Closing a gate costs one inverse transform per row, about half a millisecond
 * for all eighteen, so there is nothing to debounce. */
const gateEls = [...document.querySelectorAll('.gate[data-band]')];
const gatesReset = document.querySelector('[data-gates-reset]');

if (stage && gateEls.length) {
  const bands = gateEls.map(() => true);

  const push = () => {
    gateEls.forEach((el, i) => el.setAttribute('aria-pressed', String(bands[i])));
    /* The reset is also the state cue: its presence means something is shut. */
    gatesReset?.toggleAttribute('hidden', bands.every(Boolean));
    stage.setBands(bands);
  };

  gateEls.forEach((el, i) => {
    el.addEventListener('click', () => {
      bands[i] = !bands[i];
      push();
    });
  });

  gatesReset?.addEventListener('click', () => {
    /* Reset hides itself, which would drop focus to the body. Only chase it
       when the click came from the keyboard and focus was actually there. */
    const held = document.activeElement === gatesReset;
    bands.fill(true);
    push();
    if (held) gateEls[0].focus();
  });
}

/* ============================================================ degeneracy */
/* Two bands coinciding is an abstraction. Two atoms in the gallium nitride
 * cell sliding into each other under a red cross, then splitting apart on the
 * next bullet, is the whole result in one gesture.
 *
 * The trigger is a button rather than a hover target on the bullet, so it is
 * reachable by keyboard and usable on touch. Click pins it; hover and focus
 * preview it without committing, so a mouse user never has to click and a
 * keyboard user never has to guess that something is there. */
const fixed = document.querySelector('[data-degeneracy-fix]');
const findingBtn = document.querySelector('[data-degeneracy-toggle]');
let pinned = false;

if (stage && findingBtn) {
  findingBtn.addEventListener('click', () => {
    pinned = !pinned;
    findingBtn.setAttribute('aria-pressed', String(pinned));
    stage.setDegeneracy(pinned, false);
  });

  const preview = on => {
    if (!pinned) stage.setDegeneracy(on, false);
  };
  findingBtn.addEventListener('pointerenter', () => preview(true));
  findingBtn.addEventListener('pointerleave', () => preview(false));
  findingBtn.addEventListener('focus', () => preview(true));
  findingBtn.addEventListener('blur', () => preview(false));

  /* The second bullet is the fix: reading it splits the atoms apart again,
     and leaving it returns to whatever the button is holding. */
  if (canHover) {
    fixed?.addEventListener('pointerenter', () => stage.setDegeneracy(true, true));
    fixed?.addEventListener('pointerleave', () => stage.setDegeneracy(pinned, false));
  }
}

/* =============================================================== palette */
const palette = document.querySelector('[data-palette]');
const paletteInput = palette?.querySelector('.palette-input');
const paletteList = palette?.querySelector('.palette-list');
const INERT = ['main', '.strip', '.rail', '.site-footer', '.stage'];

const commands = sections.map((s, i) => ({
  id: s.id,
  label: s.dataset.label || s.id,
  index: String(i).padStart(2, '0'),
}));
let shown = commands;
let selected = 0;
let returnFocus = null;

function paintSelection() {
  const rows = paletteList ? [...paletteList.children] : [];
  rows.forEach((li, i) => {
    li.setAttribute('aria-selected', String(i === selected));
    if (i === selected) li.setAttribute('data-sel', '');
    else li.removeAttribute('data-sel');
  });
  paletteInput?.setAttribute('aria-activedescendant', rows[selected]?.id || '');
}

function renderPalette() {
  if (!paletteList) return;
  paletteList.replaceChildren(
    ...shown.map((cmd, i) => {
      const li = document.createElement('li');
      li.id = `palette-opt-${cmd.id}`;
      li.setAttribute('role', 'option');
      li.innerHTML = '<b></b><span></span>';
      li.querySelector('b').textContent = cmd.index;
      li.querySelector('span').textContent = cmd.label;
      /* Moving the highlight must not rebuild the list: a rebuild under the
         pointer replaced the row mid-click and swallowed the click. */
      li.addEventListener('pointerenter', () => {
        if (i === selected) return;
        selected = i;
        paintSelection();
      });
      li.addEventListener('click', () => jump(cmd.id));
      return li;
    })
  );
  paintSelection();
}

function setInert(on) {
  for (const sel of INERT) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
}

function openPalette() {
  if (!palette || !palette.hidden) return;
  returnFocus = document.activeElement;
  palette.hidden = false;
  setInert(true);
  paletteInput.value = '';
  shown = commands;
  selected = 0;
  renderPalette();
  paletteInput.focus();
}

function closePalette(restore = true) {
  if (!palette || palette.hidden) return;
  palette.hidden = true;
  setInert(false);
  /* Hand focus back where it came from, or the next Tab restarts at the top. */
  if (restore && returnFocus instanceof HTMLElement && document.contains(returnFocus)) {
    returnFocus.focus({ preventScroll: true });
  }
  returnFocus = null;
}

function jump(id) {
  closePalette(false);
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  /* Move focus, not just the viewport, so the keyboard carries on from here. */
  target.focus({ preventScroll: true });
}

paletteInput?.addEventListener('input', () => {
  const q = paletteInput.value.trim().toLowerCase();
  shown = q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands;
  selected = 0;
  renderPalette();
});

/* The input is the only focusable node in the dialog, so Tab cycles back to it
   rather than escaping into a page sitting behind an overlay. */
palette?.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    paletteInput?.focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    selected = Math.max(0, Math.min(shown.length - 1, selected + 1));
    paintSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selected = Math.max(0, selected - 1);
    paintSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (shown[selected]) jump(shown[selected].id);
  }
});
palette?.addEventListener('pointerdown', e => {
  if (e.target === palette) closePalette();
});

addEventListener('keydown', e => {
  const typing =
    e.target instanceof Element && e.target.matches('input, textarea, select, [contenteditable]');
  if ((e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === 'Escape') {
    closePalette();
    return;
  }
  wake();
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  /* The number keys match the indices printed on the rail and the headings:
     0 is ident. The upper bound comes from the section list rather than a
     literal, so adding or removing a section cannot desynchronise them. */
  if (e.key >= '0' && e.key <= '9') {
    const target = sections[Number(e.key)];
    if (target) {
      e.preventDefault();
      jump(target.id);
    }
    return;
  }
  const at = sections.indexOf(current ?? sections[0]);
  if (e.key === 'j' && sections[at + 1]) jump(sections[at + 1].id);
  else if (e.key === 'k' && sections[at - 1]) jump(sections[at - 1].id);
  else if (e.key === 'h') setHalted(!halted);
  else if (e.key === 'r' && animate) {
    pinnedStill = !pinnedStill;
    clearTimeout(guardTimer);
    setCalm(pinnedStill ? 'still' : 'live');
  }
});

/* ================================================================== boot */
setLive(sections[0]);
layoutRail();
onScroll();

const relayout = debounce(() => {
  layoutRail();
  onScroll();
}, 150);
addEventListener('resize', relayout);
/* Fonts land after first paint and change the height of every section, so the
   rail's proportional tick placement has to be recomputed once they are in. */
document.fonts?.ready.then(() => {
  layoutRail();
  onScroll();
});

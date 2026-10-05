/*
 * dft.js — the discrete Fourier transform the activation surface runs on.
 *
 * A real transform, computed in the page. The surface beside the
 * Activation-FFT section is twenty synthetic activation trajectories; closing
 * a frequency band zeroes those bins and the terrain you then see is the
 * inverse transform of the edited spectrum. The signal is an artistic
 * impression of a hidden state, but the round trip through it is not faked.
 *
 * 128 samples, O(n^2) against a cached twiddle table: ~8k multiply-adds per
 * row per pass. The forward pass is computed once at build time; closing a
 * gate costs one inverse pass per row, a few milliseconds for all twenty.
 */

export const N = 128;
export const HALF = N / 2;

/* Six bands over the half spectrum, named rather than numbered: a visitor who
   has not thought about bin indices today can still tell which end of the
   spectrum they are turning off. The split is roughly logarithmic — narrow at
   the bottom, because that is where the structure lives, and because an even
   split would put almost everything in the last gate. */
export const BANDS = [
  { name: 'DC', lo: 0, hi: 0 },
  { name: 'Low', lo: 1, hi: 4 },
  { name: 'Medium Low', lo: 5, hi: 11 },
  { name: 'Medium', lo: 12, hi: 22 },
  { name: 'Medium High', lo: 23, hi: 40 },
  { name: 'High', lo: 41, hi: HALF },
];

/* cos/sin of the NEGATIVE angle, indexed by (k*n) mod N. Both transforms read
   this one table, which is why the inverse adds its imaginary term rather than
   subtracting it — see `inverse`. */
const COS = new Float32Array(N);
const SIN = new Float32Array(N);
for (let i = 0; i < N; i++) {
  COS[i] = Math.cos((-2 * Math.PI * i) / N);
  SIN[i] = Math.sin((-2 * Math.PI * i) / N);
}

export function forward(signal, re, im) {
  for (let k = 0; k <= HALF; k++) {
    let sr = 0;
    let si = 0;
    for (let n = 0; n < N; n++) {
      const t = (k * n) % N;
      sr += signal[n] * COS[t];
      si += signal[n] * SIN[t];
    }
    re[k] = sr / N;
    im[k] = si / N;
  }
}

/* Reconstruct from the half spectrum, mirroring the conjugate half.
 *
 * Re(X[k]·e^{+iθ}) = re·cos θ − im·sin θ. The table holds c = cos(−θ) = cos θ
 * and s = sin(−θ) = −sin θ, so in table terms that is re·c + im·s. Subtracting
 * instead yields Re(conj(X[k])·e^{+iθ}), which reconstructs x[(N−n) mod N] —
 * a perfect-looking round trip of the time-reversed signal — which is why
 * the check that matters is the error against the original, not whether the
 * reconstruction looks clean: 3e-8 as written, 0.74 with the term flipped.
 */
export function inverse(re, im, gain, out) {
  for (let n = 0; n < N; n++) {
    let v = re[0] * gain[0];
    for (let k = 1; k <= HALF; k++) {
      const t = (k * n) % N;
      const g = gain[k];
      const term = re[k] * g * COS[t] + im[k] * g * SIN[t];
      /* The Nyquist bin counts once: it has no distinct mirror. */
      v += (k === HALF ? 1 : 2) * term;
    }
    out[n] = v;
  }
}

/** Eight booleans — one per band — expanded to a per-bin gain vector. */
export function bandGain(open, out = new Float32Array(HALF + 1)) {
  for (let b = 0; b < BANDS.length; b++) {
    const g = open[b] === false ? 0 : 1;
    for (let k = BANDS[b].lo; k <= Math.min(BANDS[b].hi, HALF); k++) out[k] = g;
  }
  return out;
}

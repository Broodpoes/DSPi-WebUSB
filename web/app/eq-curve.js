/**
 * EQ Curve Math — biquad magnitude response computation for parametric EQ.
 *
 * Uses the standard RBJ Audio EQ Cookbook transfer function evaluation.
 * Rendering is handled by the React SVG EQGraph component.
 */

const TWO_PI = 2 * Math.PI;

// Filter types (must match firmware)
export const FILTER_FLAT = 0;
const FILTER_PEAKING = 1;
const FILTER_LOW_SHELF = 2;
const FILTER_HIGH_SHELF = 3;
const FILTER_LOW_PASS = 4;
const FILTER_HIGH_PASS = 5;

/**
 * Format a frequency value for axis labels.
 * 1000 → "1k", 2000 → "2k", 100 → "100", 20 → "20", etc.
 */
export function fmtFreq(f) {
    return f >= 1000 ? `${f / 1000}k` : String(f);
}

/**
 * Compute |H(w)| magnitude at a given frequency for one biquad band.
 * Uses the analog transfer function approximation (s-domain → bilinear).
 */
function bandMagnitude(band, freq, sampleRate) {
    if (band.type === FILTER_FLAT) return 1.0;

    const w0 = TWO_PI * band.freq / sampleRate;
    const A = Math.pow(10, band.gain_db / 40);
    const alpha = Math.sin(w0) / (2 * band.Q);

    let b0, b1, b2, a0, a1, a2;

    switch (band.type) {
        case FILTER_PEAKING:
            b0 = 1 + alpha * A;
            b1 = -2 * Math.cos(w0);
            b2 = 1 - alpha * A;
            a0 = 1 + alpha / A;
            a1 = -2 * Math.cos(w0);
            a2 = 1 - alpha / A;
            break;
        case FILTER_LOW_SHELF:
            b0 = A * ((A + 1) - (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha);
            b1 = 2 * A * ((A - 1) - (A + 1) * Math.cos(w0));
            b2 = A * ((A + 1) - (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha);
            a0 = (A + 1) + (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha;
            a1 = -2 * ((A - 1) + (A + 1) * Math.cos(w0));
            a2 = (A + 1) + (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha;
            break;
        case FILTER_HIGH_SHELF:
            b0 = A * ((A + 1) + (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha);
            b1 = -2 * A * ((A - 1) + (A + 1) * Math.cos(w0));
            b2 = A * ((A + 1) + (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha);
            a0 = (A + 1) - (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha;
            a1 = 2 * ((A - 1) - (A + 1) * Math.cos(w0));
            a2 = (A + 1) - (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha;
            break;
        case FILTER_LOW_PASS:
            b0 = (1 - Math.cos(w0)) / 2;
            b1 = 1 - Math.cos(w0);
            b2 = (1 - Math.cos(w0)) / 2;
            a0 = 1 + alpha;
            a1 = -2 * Math.cos(w0);
            a2 = 1 - alpha;
            break;
        case FILTER_HIGH_PASS:
            b0 = (1 + Math.cos(w0)) / 2;
            b1 = -(1 + Math.cos(w0));
            b2 = (1 + Math.cos(w0)) / 2;
            a0 = 1 + alpha;
            a1 = -2 * Math.cos(w0);
            a2 = 1 - alpha;
            break;
        default:
            return 1.0;
    }

    const w = TWO_PI * freq / sampleRate;
    const cos_w = Math.cos(w);
    const cos_2w = Math.cos(2 * w);
    const sin_w = Math.sin(w);
    const sin_2w = Math.sin(2 * w);

    const num_r = b0 + b1 * cos_w + b2 * cos_2w;
    const num_i = b1 * sin_w + b2 * sin_2w;
    const den_r = a0 + a1 * cos_w + a2 * cos_2w;
    const den_i = a1 * sin_w + a2 * sin_2w;

    return Math.sqrt((num_r * num_r + num_i * num_i) / (den_r * den_r + den_i * den_i));
}

/**
 * Compute the combined magnitude response of all bands at a given frequency.
 */
export function combinedMagnitude(bands, freq, sampleRate) {
    let mag = 1.0;
    for (const band of bands) {
        mag *= bandMagnitude(band, freq, sampleRate);
    }
    return mag;
}

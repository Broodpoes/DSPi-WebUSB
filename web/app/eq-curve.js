/**
 * EQ Curve Renderer — draws parametric EQ frequency response curves on a Canvas.
 *
 * Computes the combined magnitude response of up to 10 biquad/SVF filter bands
 * using the standard RBJ Audio EQ Cookbook transfer function evaluation.
 */

const TWO_PI = 2 * Math.PI;

// Filter types (must match firmware)
const FILTER_FLAT = 0;
const FILTER_PEAKING = 1;
const FILTER_LOW_SHELF = 2;
const FILTER_HIGH_SHELF = 3;
const FILTER_LOW_PASS = 4;
const FILTER_HIGH_PASS = 5;

/**
 * Compute H(z) magnitude at a given frequency for one biquad band.
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

    // Evaluate |H(w)| at the test frequency
    const w = TWO_PI * freq / sampleRate;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    // |H(e^jw)|^2 = (b0 + b1*cos(w) + b2*cos(2w))^2 + (b1*sin(w) + b2*sin(2w))^2
    //              / (a0 + a1*cos(w) + a2*cos(2w))^2 + (a1*sin(w) + a2*sin(2w))^2
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
function combinedMagnitude(bands, freq, sampleRate) {
    let mag = 1.0;
    for (const band of bands) {
        mag *= bandMagnitude(band, freq, sampleRate);
    }
    return mag;
}

/**
 * Render EQ curve on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Array} bands - Array of {type, freq, Q, gain_db}
 * @param {object} opts
 */
export function renderEQCurve(canvas, bands, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Handle high-DPI
    if (canvas.getAttribute('data-scaled') !== 'true') {
        canvas.width = canvas.clientWidth * dpr;
        canvas.height = canvas.clientHeight * dpr;
        ctx.scale(dpr, dpr);
        canvas.setAttribute('data-scaled', 'true');
    }
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    const sampleRate = opts.sampleRate || 48000;
    const minFreq = 20;
    const maxFreq = 20000;
    const minDb = opts.minDb || -18;
    const maxDb = opts.maxDb || 18;
    const padding = opts.padding || { top: 10, right: 10, bottom: 20, left: 40 };
    const plotW = cw - padding.left - padding.right;
    const plotH = ch - padding.top - padding.bottom;

    // Frequency -> X (log scale)
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    const freqToX = (f) => padding.left + (Math.log10(f) - logMin) / (logMax - logMin) * plotW;
    // dB -> Y
    const dbToY = (db) => padding.top + (1 - (db - minDb) / (maxDb - minDb)) * plotH;

    // Clear
    ctx.clearRect(0, 0, cw, ch);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, cw, ch);

    // Grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;

    // Frequency grid
    const freqGridLines = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const freqLabels = ['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k'];
    ctx.font = '10px monospace';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';

    for (let i = 0; i < freqGridLines.length; i++) {
        const x = freqToX(freqGridLines[i]);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, ch - padding.bottom);
        ctx.stroke();
        ctx.fillText(freqLabels[i], x, ch - 4);
    }

    // dB grid
    ctx.textAlign = 'right';
    for (let db = minDb; db <= maxDb; db += 6) {
        const y = dbToY(db);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(cw - padding.right, y);
        ctx.stroke();
        ctx.fillText(`${db}`, padding.left - 4, y + 3);
    }

    // 0 dB line
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, dbToY(0));
    ctx.lineTo(cw - padding.right, dbToY(0));
    ctx.stroke();

    // Plot curve
    const numPoints = Math.max(plotW * 2, 256);
    const curvePoints = [];

    for (let i = 0; i < numPoints; i++) {
        const logF = logMin + (logMax - logMin) * i / (numPoints - 1);
        const freq = Math.pow(10, logF);
        const mag = combinedMagnitude(bands, freq, sampleRate);
        const db = 20 * Math.log10(Math.max(mag, 1e-10));
        curvePoints.push({ x: freqToX(freq), y: dbToY(db) });
    }

    // Fill under curve
    ctx.beginPath();
    ctx.moveTo(curvePoints[0].x, dbToY(0));
    for (const p of curvePoints) ctx.lineTo(p.x, p.y);
    ctx.lineTo(curvePoints[curvePoints.length - 1].x, dbToY(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 200, 255, 0.1)';
    ctx.fill();

    // Curve line
    ctx.beginPath();
    ctx.moveTo(curvePoints[0].x, curvePoints[0].y);
    for (let i = 1; i < curvePoints.length; i++) {
        ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
    }
    ctx.strokeStyle = '#00c8ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Band markers
    for (const band of bands) {
        if (band.type === FILTER_FLAT) continue;
        const x = freqToX(band.freq);
        const mag = combinedMagnitude([band], band.freq, sampleRate);
        const db = 20 * Math.log10(Math.max(mag, 1e-10));
        const y = dbToY(db);

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, TWO_PI);
        ctx.fillStyle = band.gain_db >= 0 ? '#00ff88' : '#ff4466';
        ctx.fill();
    }
}

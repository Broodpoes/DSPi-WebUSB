/**
 * Meter Renderer — renders peak/clip meters and CPU load on Canvas.
 *
 * Peak values are uint16 Q15 (0–32767 = 0.0–1.0).
 * Clip flags are sticky bits, cleared by the host.
 * CPU load is uint8 percentage (0–100).
 */

/**
 * Render a single vertical meter bar.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - left edge
 * @param {number} y - top edge
 * @param {number} w - width
 * @param {number} h - height
 * @param {number} peak - peak level 0.0–1.0
 * @param {boolean} clipped - clip indicator
 * @param {string} label - channel label
 */
function renderBar(ctx, x, y, w, h, peak, clipped, label) {
    // Background
    ctx.fillStyle = '#111';
    ctx.fillRect(x, y, w, h);

    // Level bar (green → yellow → red gradient)
    const barH = h * Math.min(peak, 1.0);
    const gradient = ctx.createLinearGradient(x, y + h, x, y);
    gradient.addColorStop(0, '#00cc44');
    gradient.addColorStop(0.7, '#cccc00');
    gradient.addColorStop(0.85, '#ff6600');
    gradient.addColorStop(1, '#ff0000');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y + h - barH, w, barH);

    // Clip indicator
    if (clipped) {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(x, y - 4, w, 3);
    } else {
        ctx.fillStyle = '#333';
        ctx.fillRect(x, y - 4, w, 3);
    }

    // Label
    if (label) {
        ctx.fillStyle = '#888';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + w / 2, y + h + 11);
    }
}

/**
 * Render all meters for a DSPi device.
 * @param {HTMLCanvasElement} canvas
 * @param {object} meterData - {peaks: Float32Array, clips: number, cpu0: number, cpu1: number}
 * @param {number} numChannels - number of channels (7 or 11)
 * @param {string[]} channelNames - labels for each channel
 */
export function renderMeters(canvas, meterData, numChannels, channelNames) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    if (canvas.getAttribute('data-scaled') !== 'true') {
        canvas.width = canvas.clientWidth * dpr;
        canvas.height = canvas.clientHeight * dpr;
        ctx.scale(dpr, dpr);
        canvas.setAttribute('data-scaled', 'true');
    }

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, cw, ch);

    const meterH = ch - 40;
    const barW = Math.max(8, Math.min(24, (cw - 20) / numChannels - 4));
    const totalW = numChannels * (barW + 4) - 4;
    const startX = (cw - totalW) / 2;

    for (let i = 0; i < numChannels; i++) {
        const peak = meterData.peaks ? (meterData.peaks[i] || 0) : 0;
        const clipped = meterData.clips ? ((meterData.clips >> i) & 1) !== 0 : false;
        const label = channelNames ? channelNames[i] : `Ch${i}`;

        renderBar(ctx, startX + i * (barW + 4), 16, barW, meterH, peak, clipped, label);
    }

    // CPU load
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    const cpu0 = meterData.cpu0 != null ? meterData.cpu0 : 0;
    const cpu1 = meterData.cpu1 != null ? meterData.cpu1 : 0;
    ctx.fillText(`CPU0: ${cpu0}%  CPU1: ${cpu1}%`, 4, ch - 2);
}

/**
 * Parse raw meter data from REQ_GET_STATUS wValue=9.
 * Returns {peaks: Float64Array, clips: number, cpu0: number, cpu1: number}
 *
 * Wire format (12 bytes):
 *   uint16 peaks[NUM_CHANNELS] (Q15, 0-32767)
 *   uint8  clip_flags_hi (channels 8-10)
 *   uint8  clip_flags_lo (channels 0-7)
 *   uint8  cpu0_load
 *   uint8  cpu1_load
 */
export function parseMeterData(raw, numChannels) {
    if (!raw || raw.length < 2 * numChannels + 4) {
        return { peaks: new Float64Array(numChannels), clips: 0, cpu0: 0, cpu1: 0 };
    }

    const view = new DataView(raw.buffer, raw.byteOffset);
    const peaks = new Float64Array(numChannels);

    for (let i = 0; i < numChannels; i++) {
        const q15 = view.getUint16(i * 2, true);
        peaks[i] = q15 / 32767;
    }

    const offset = numChannels * 2;
    const clipFlagsHi = raw[offset] || 0;
    const clipFlagsLo = raw[offset + 1] || 0;
    const clips = (clipFlagsHi << 8) | clipFlagsLo;

    return {
        peaks,
        clips,
        cpu0: raw[offset + 2] || 0,
        cpu1: raw[offset + 3] || 0,
    };
}

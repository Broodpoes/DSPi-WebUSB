/**
 * DSPi Client SDK — transport-agnostic protocol implementation.
 *
 * Provides typed methods for every DSPi vendor command. Works with either
 * WebUSBTransport (direct) or WebSocketTransport (bridge).
 */

// ── Vendor Request Codes (must match firmware/DSPi/config.h) ─────────────

const REQ = {
    SET_EQ_PARAM: 0x42, GET_EQ_PARAM: 0x43,
    SET_PREAMP: 0x44, GET_PREAMP: 0x45,
    SET_BYPASS: 0x46, GET_BYPASS: 0x47,
    SET_DELAY: 0x48, GET_DELAY: 0x49,
    GET_STATUS: 0x50, SAVE_PARAMS: 0x51, LOAD_PARAMS: 0x52, FACTORY_RESET: 0x53,
    SET_CHANNEL_GAIN: 0x54, GET_CHANNEL_GAIN: 0x55,
    SET_CHANNEL_MUTE: 0x56, GET_CHANNEL_MUTE: 0x57,
    SET_LOUDNESS: 0x58, GET_LOUDNESS: 0x59,
    SET_LOUDNESS_REF: 0x5A, GET_LOUDNESS_REF: 0x5B,
    SET_LOUDNESS_INTENSITY: 0x5C, GET_LOUDNESS_INTENSITY: 0x5D,
    SET_CROSSFEED: 0x5E, GET_CROSSFEED: 0x5F,
    SET_CROSSFEED_PRESET: 0x60, GET_CROSSFEED_PRESET: 0x61,
    SET_CROSSFEED_FREQ: 0x62, GET_CROSSFEED_FREQ: 0x63,
    SET_CROSSFEED_FEED: 0x64, GET_CROSSFEED_FEED: 0x65,
    SET_CROSSFEED_ITD: 0x66, GET_CROSSFEED_ITD: 0x67,
    SET_MATRIX_ROUTE: 0x70, GET_MATRIX_ROUTE: 0x71,
    SET_OUTPUT_ENABLE: 0x72, GET_OUTPUT_ENABLE: 0x73,
    SET_OUTPUT_GAIN: 0x74, GET_OUTPUT_GAIN: 0x75,
    SET_OUTPUT_MUTE: 0x76, GET_OUTPUT_MUTE: 0x77,
    SET_OUTPUT_DELAY: 0x78, GET_OUTPUT_DELAY: 0x79,
    GET_CORE1_MODE: 0x7A, GET_CORE1_CONFLICT: 0x7B,
    SET_OUTPUT_PIN: 0x7C, GET_OUTPUT_PIN: 0x7D,
    GET_SERIAL: 0x7E, GET_PLATFORM: 0x7F,
    CLEAR_CLIPS: 0x83,
    PRESET_SAVE: 0x90, PRESET_LOAD: 0x91, PRESET_DELETE: 0x92,
    PRESET_GET_NAME: 0x93, PRESET_SET_NAME: 0x94,
    PRESET_GET_DIR: 0x95, PRESET_SET_STARTUP: 0x96, PRESET_GET_STARTUP: 0x97,
    PRESET_SET_INCLUDE_PINS: 0x98, PRESET_GET_INCLUDE_PINS: 0x99,
    PRESET_GET_ACTIVE: 0x9A,
    SET_CHANNEL_NAME: 0x9B, GET_CHANNEL_NAME: 0x9C,
    GET_ALL_PARAMS: 0xA0, SET_ALL_PARAMS: 0xA1,
    GET_BUFFER_STATS: 0xB0, RESET_BUFFER_STATS: 0xB1,
    GET_USB_ERROR_STATS: 0xB2, RESET_USB_ERROR_STATS: 0xB3,
    SET_LEVELLER_ENABLE: 0xB4, GET_LEVELLER_ENABLE: 0xB5,
    SET_LEVELLER_AMOUNT: 0xB6, GET_LEVELLER_AMOUNT: 0xB7,
    SET_LEVELLER_SPEED: 0xB8, GET_LEVELLER_SPEED: 0xB9,
    SET_LEVELLER_MAX_GAIN: 0xBA, GET_LEVELLER_MAX_GAIN: 0xBB,
    SET_LEVELLER_LOOKAHEAD: 0xBC, GET_LEVELLER_LOOKAHEAD: 0xBD,
    SET_LEVELLER_GATE: 0xBE, GET_LEVELLER_GATE: 0xBF,
    SET_OUTPUT_TYPE: 0xC0, GET_OUTPUT_TYPE: 0xC1,
    SET_I2S_BCK_PIN: 0xC2, GET_I2S_BCK_PIN: 0xC3,
    SET_MCK_ENABLE: 0xC4, GET_MCK_ENABLE: 0xC5,
    SET_MCK_PIN: 0xC6, GET_MCK_PIN: 0xC7,
    SET_MCK_MULTIPLIER: 0xC8, GET_MCK_MULTIPLIER: 0xC9,
    SET_PREAMP_CH: 0xD0, GET_PREAMP_CH: 0xD1,
    SET_MASTER_VOLUME: 0xD2, GET_MASTER_VOLUME: 0xD3,
    SET_MASTER_VOLUME_MODE: 0xD4, GET_MASTER_VOLUME_MODE: 0xD5,
    SAVE_MASTER_VOLUME: 0xD6, GET_SAVED_MASTER_VOLUME: 0xD7,
    ENTER_BOOTLOADER: 0xF0,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function packFloat(...values) {
    const buf = new ArrayBuffer(values.length * 4);
    const view = new DataView(buf);
    values.forEach((v, i) => view.setFloat32(i * 4, v, true));
    return new Uint8Array(buf);
}

function unpackFloat(data, offset = 0) {
    return new DataView(data.buffer, data.byteOffset + offset, 4).getFloat32(0, true);
}

function packU8(...values) {
    return new Uint8Array(values);
}

// ── DSPi Client ───────────────────────────────────────────────────────────

export class DSPiClient {
    /**
     * @param {import('./transport.js').DSPiTransport} transport
     */
    constructor(transport) {
        this.transport = transport;
        this._isWebUSB = transport.constructor.name === 'WebUSBTransport';
        this._isWS = transport.constructor.name === 'WebSocketTransport';
    }

    // For WebSocket transport, delegate to RPC
    async _rpc(method, params) {
        if (this._isWS) return this.transport._rpc(method, params);
        throw new Error("Not a WebSocket transport");
    }

    // For WebUSB transport, raw control transfer
    async _ctrlIn(bRequest, wValue = 0, wLength = 64) {
        return this.transport.ctrlTransfer('in', bRequest, wValue, 0, wLength);
    }

    async _ctrlOut(bRequest, wValue = 0, data = new Uint8Array(0)) {
        return this.transport.ctrlTransfer('out', bRequest, wValue, 0, data);
    }

    // ── Device Info ──────────────────────────────────────────

    async getPlatform() {
        if (this._isWS) return (await this._rpc("get_info")).platform;
        const d = await this._ctrlIn(REQ.GET_PLATFORM, 0, 4);
        return d[0];
    }

    async getSerial() {
        if (this._isWS) return (await this._rpc("get_info")).serial;
        const d = await this._ctrlIn(REQ.GET_SERIAL, 0, 16);
        return String.fromCharCode(...d);
    }

    // ── EQ ───────────────────────────────────────────────────

    async getEqParam(channel, band) {
        if (this._isWS) return await this._rpc("get_eq_param", { channel, band });
        // Firmware uses per-param reads: wValue = (channel << 8) | (band << 4) | param_index
        // param 0=type(uint32), 1=freq(float32), 2=Q(float32), 3=gain_db(float32)
        const [typeRaw, freqRaw, qRaw, gainRaw] = await Promise.all([
            this._ctrlIn(REQ.GET_EQ_PARAM, (channel << 8) | (band << 4) | 0, 4),
            this._ctrlIn(REQ.GET_EQ_PARAM, (channel << 8) | (band << 4) | 1, 4),
            this._ctrlIn(REQ.GET_EQ_PARAM, (channel << 8) | (band << 4) | 2, 4),
            this._ctrlIn(REQ.GET_EQ_PARAM, (channel << 8) | (band << 4) | 3, 4),
        ]);
        const dv = (d) => new DataView(d.buffer, d.byteOffset);
        return {
            channel, band,
            type: dv(typeRaw).getUint32(0, true),
            freq: dv(freqRaw).getFloat32(0, true),
            Q: dv(qRaw).getFloat32(0, true),
            gain_db: dv(gainRaw).getFloat32(0, true),
        };
    }

    async setEqParam(channel, band, type, freq, Q, gainDb) {
        if (this._isWS) return await this._rpc("set_eq_param",
            { channel, band, type, freq, Q, gain_db: gainDb });
        const buf = new ArrayBuffer(16);
        const dv = new DataView(buf);
        const u8 = new Uint8Array(buf);
        u8[0] = channel; u8[1] = band; u8[2] = type;
        dv.setFloat32(4, freq, true);
        dv.setFloat32(8, Q, true);
        dv.setFloat32(12, gainDb, true);
        await this._ctrlOut(REQ.SET_EQ_PARAM, 0, u8);
    }

    // ── Bypass ───────────────────────────────────────────────

    async getBypass() {
        if (this._isWS) return await this._rpc("get_bypass");
        return (await this._ctrlIn(REQ.GET_BYPASS, 0, 1))[0] !== 0;
    }

    async setBypass(on) {
        if (this._isWS) return await this._rpc("set_bypass", { on });
        await this._ctrlOut(REQ.SET_BYPASS, 0, packU8(on ? 1 : 0));
    }

    // ── Per-Channel Preamp ───────────────────────────────────

    async getPreampCh(channel) {
        if (this._isWS) return (await this._rpc("get_preamp_ch", { channel })).db;
        return unpackFloat(await this._ctrlIn(REQ.GET_PREAMP_CH, channel, 4));
    }

    async setPreampCh(channel, db) {
        if (this._isWS) return await this._rpc("set_preamp_ch", { channel, db });
        await this._ctrlOut(REQ.SET_PREAMP_CH, channel, packFloat(db));
    }

    // ── Master Volume ────────────────────────────────────────

    async getMasterVolume() {
        if (this._isWS) return (await this._rpc("get_master_volume")).db;
        return unpackFloat(await this._ctrlIn(REQ.GET_MASTER_VOLUME, 0, 4));
    }

    async setMasterVolume(db) {
        if (this._isWS) return await this._rpc("set_master_volume", { db });
        await this._ctrlOut(REQ.SET_MASTER_VOLUME, 0, packFloat(db));
    }

    async getMasterVolumeMode() {
        if (this._isWS) return (await this._rpc("get_master_volume_mode")).mode;
        return (await this._ctrlIn(REQ.GET_MASTER_VOLUME_MODE, 0, 1))[0];
    }

    async setMasterVolumeMode(mode) {
        if (this._isWS) return await this._rpc("set_master_volume_mode", { mode });
        await this._ctrlOut(REQ.SET_MASTER_VOLUME_MODE, 0, packU8(mode));
    }

    // ── Presets ──────────────────────────────────────────────

    async presetSave(slot) {
        if (this._isWS) return await this._rpc("preset_save", { slot });
        await this._ctrlIn(REQ.PRESET_SAVE, slot, 1);
    }

    async presetLoad(slot) {
        if (this._isWS) return await this._rpc("preset_load", { slot });
        await this._ctrlIn(REQ.PRESET_LOAD, slot, 1);
    }

    async presetDelete(slot) {
        if (this._isWS) return await this._rpc("preset_delete", { slot });
        await this._ctrlIn(REQ.PRESET_DELETE, slot, 1);
    }

    async presetGetName(slot) {
        if (this._isWS) return (await this._rpc("preset_get_name", { slot })).name;
        const d = await this._ctrlIn(REQ.PRESET_GET_NAME, slot, 32);
        let s = '';
        for (let i = 0; i < d.length && d[i] !== 0; i++) s += String.fromCharCode(d[i]);
        return s;
    }

    async presetSetName(slot, name) {
        if (this._isWS) return await this._rpc("preset_set_name", { slot, name });
        const buf = new Uint8Array(32);
        for (let i = 0; i < Math.min(name.length, 31); i++) buf[i] = name.charCodeAt(i);
        await this._ctrlOut(REQ.PRESET_SET_NAME, slot, buf);
    }

    async presetGetActive() {
        if (this._isWS) return (await this._rpc("preset_get_active")).slot;
        return (await this._ctrlIn(REQ.PRESET_GET_ACTIVE, 0, 1))[0];
    }

    async presetGetStartup() {
        if (this._isWS) return await this._rpc("preset_get_startup");
        const d = await this._ctrlIn(REQ.PRESET_GET_STARTUP, 0, 3);
        return { mode: d[0], slot: d[1], last_active: d[2] };
    }

    async presetSetStartup(mode, slot) {
        if (this._isWS) return await this._rpc("preset_set_startup", { mode, slot });
        await this._ctrlOut(REQ.PRESET_SET_STARTUP, 0, packU8(mode, slot));
    }

    // ── Channel Names ────────────────────────────────────────

    async getChannelName(channel) {
        if (this._isWS) return (await this._rpc("get_channel_name", { channel })).name;
        const d = await this._ctrlIn(REQ.GET_CHANNEL_NAME, channel, 32);
        let s = '';
        for (let i = 0; i < d.length && d[i] !== 0; i++) s += String.fromCharCode(d[i]);
        return s;
    }

    async setChannelName(channel, name) {
        if (this._isWS) return await this._rpc("set_channel_name", { channel, name });
        const buf = new Uint8Array(32);
        for (let i = 0; i < Math.min(name.length, 31); i++) buf[i] = name.charCodeAt(i);
        await this._ctrlOut(REQ.SET_CHANNEL_NAME, channel, buf);
    }

    // ── Bulk Params ──────────────────────────────────────────

    async getAllParams() {
        if (this._isWS) {
            const r = await this._rpc("get_all_params");
            // Decode base64
            const bin = atob(r.data_b64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            return u8;
        }
        return await this._ctrlIn(REQ.GET_ALL_PARAMS, 0, 2896);
    }

    async setAllParams(data) {
        if (this._isWS) {
            let b64 = '';
            const chunk = 0x8000;
            for (let i = 0; i < data.length; i += chunk) {
                const slice = data.subarray(i, Math.min(i + chunk, data.length));
                b64 += String.fromCharCode(...slice);
            }
            await this._rpc("set_all_params", { data_b64: btoa(b64) });
            return;
        }
        await this._ctrlOut(REQ.SET_ALL_PARAMS, 0, data);
    }

    // ── Status / Metering ────────────────────────────────────

    async getStatus(wValue) {
        const wLength = wValue === 9 ? 26 : 4;
        if (this._isWS) return (await this._rpc("get_status", { wValue })).raw;
        return await this._ctrlIn(REQ.GET_STATUS, wValue, wLength);
    }

    async clearClips() {
        if (this._isWS) return await this._rpc("clear_clips");
        return await this._ctrlIn(REQ.CLEAR_CLIPS, 0, 2);
    }

    // ── Matrix Mixer ─────────────────────────────────────────

    async getMatrixRoute(input, output) {
        if (this._isWS) return await this._rpc("get_matrix_route", { input, output });
        const wValue = (input << 8) | output;
        const d = await this._ctrlIn(REQ.GET_MATRIX_ROUTE, wValue, 8);
        const dv = new DataView(d.buffer, d.byteOffset);
        return {
            input: d[0], output: d[1],
            enabled: d[2] !== 0, phase_invert: d[3] !== 0,
            gain_db: dv.getFloat32(4, true),
        };
    }

    async setMatrixRoute(input, output, enabled, phaseInvert, gainDb) {
        if (this._isWS) return await this._rpc("set_matrix_route",
            { input, output, enabled, phase_invert: phaseInvert, gain_db: gainDb });
        const buf = new ArrayBuffer(8);
        const dv = new DataView(buf);
        const u8 = new Uint8Array(buf);
        u8[0] = input; u8[1] = output;
        u8[2] = enabled ? 1 : 0; u8[3] = phaseInvert ? 1 : 0;
        dv.setFloat32(4, gainDb, true);
        await this._ctrlOut(REQ.SET_MATRIX_ROUTE, 0, u8);
    }

    async getOutputEnable(output) {
        if (this._isWS) return (await this._rpc("get_output_enable", { output })).enabled;
        return (await this._ctrlIn(REQ.GET_OUTPUT_ENABLE, output, 1))[0] !== 0;
    }

    async setOutputEnable(output, on) {
        if (this._isWS) return await this._rpc("set_output_enable", { output, enabled: on });
        await this._ctrlOut(REQ.SET_OUTPUT_ENABLE, output, packU8(on ? 1 : 0));
    }

    async getOutputGain(output) {
        if (this._isWS) return (await this._rpc("get_output_gain", { output })).db;
        return unpackFloat(await this._ctrlIn(REQ.GET_OUTPUT_GAIN, output, 4));
    }

    async setOutputGain(output, db) {
        if (this._isWS) return await this._rpc("set_output_gain", { output, db });
        await this._ctrlOut(REQ.SET_OUTPUT_GAIN, output, packFloat(db));
    }

    async getOutputMute(output) {
        if (this._isWS) return (await this._rpc("get_output_mute", { output })).muted;
        return (await this._ctrlIn(REQ.GET_OUTPUT_MUTE, output, 1))[0] !== 0;
    }

    async setOutputMute(output, muted) {
        if (this._isWS) return await this._rpc("set_output_mute", { output, muted });
        await this._ctrlOut(REQ.SET_OUTPUT_MUTE, output, packU8(muted ? 1 : 0));
    }

    async getOutputDelay(output) {
        if (this._isWS) return (await this._rpc("get_output_delay", { output })).ms;
        return unpackFloat(await this._ctrlIn(REQ.GET_OUTPUT_DELAY, output, 4));
    }

    async setOutputDelay(output, ms) {
        if (this._isWS) return await this._rpc("set_output_delay", { output, ms });
        await this._ctrlOut(REQ.SET_OUTPUT_DELAY, output, packFloat(ms));
    }

    // ── Crossfeed ────────────────────────────────────────────

    async getCrossfeed() {
        if (this._isWS) return await this._rpc("get_crossfeed");
        return {
            enabled: (await this._ctrlIn(REQ.GET_CROSSFEED, 0, 1))[0] !== 0,
            preset: (await this._ctrlIn(REQ.GET_CROSSFEED_PRESET, 0, 1))[0],
            freq: unpackFloat(await this._ctrlIn(REQ.GET_CROSSFEED_FREQ, 0, 4)),
            feed: unpackFloat(await this._ctrlIn(REQ.GET_CROSSFEED_FEED, 0, 4)),
            itd: (await this._ctrlIn(REQ.GET_CROSSFEED_ITD, 0, 1))[0] !== 0,
        };
    }

    async setCrossfeed(on) {
        if (this._isWS) return await this._rpc("set_crossfeed", { enabled: on });
        await this._ctrlOut(REQ.SET_CROSSFEED, 0, packU8(on ? 1 : 0));
    }

    // ── Loudness ─────────────────────────────────────────────

    async getLoudness() {
        if (this._isWS) return await this._rpc("get_loudness");
        return {
            enabled: (await this._ctrlIn(REQ.GET_LOUDNESS, 0, 1))[0] !== 0,
            ref_spl: unpackFloat(await this._ctrlIn(REQ.GET_LOUDNESS_REF, 0, 4)),
            intensity: unpackFloat(await this._ctrlIn(REQ.GET_LOUDNESS_INTENSITY, 0, 4)),
        };
    }

    // ── Volume Leveller ──────────────────────────────────────

    async getLeveller() {
        if (this._isWS) return await this._rpc("get_leveller");
        return {
            enabled: (await this._ctrlIn(REQ.GET_LEVELLER_ENABLE, 0, 1))[0] !== 0,
            amount: unpackFloat(await this._ctrlIn(REQ.GET_LEVELLER_AMOUNT, 0, 4)),
            speed: (await this._ctrlIn(REQ.GET_LEVELLER_SPEED, 0, 1))[0],
            max_gain: unpackFloat(await this._ctrlIn(REQ.GET_LEVELLER_MAX_GAIN, 0, 4)),
            lookahead: (await this._ctrlIn(REQ.GET_LEVELLER_LOOKAHEAD, 0, 1))[0] !== 0,
            gate: unpackFloat(await this._ctrlIn(REQ.GET_LEVELLER_GATE, 0, 4)),
        };
    }

    // ── Save/Load/Reset ──────────────────────────────────────

    async saveParams() {
        if (this._isWS) return await this._rpc("save_params");
        await this._ctrlIn(REQ.SAVE_PARAMS, 0, 1);
    }

    async loadParams() {
        if (this._isWS) return await this._rpc("load_params");
        await this._ctrlIn(REQ.LOAD_PARAMS, 0, 1);
    }

    async factoryReset() {
        if (this._isWS) return await this._rpc("factory_reset");
        await this._ctrlIn(REQ.FACTORY_RESET, 0, 1);
    }
}

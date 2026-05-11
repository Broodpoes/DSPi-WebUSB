/**
 * DSPi Transport — abstracts USB control transfers over WebUSB or WebSocket.
 *
 * Both transports present the same API: ctrlTransfer(dir, bRequest, wValue, wIndex, data|len).
 * The DSPiClient uses whichever transport is active.
 */

// DSPi USB IDs
const DSPI_VID = 0x2E8A;
const DSPI_PID = 0xFEAA;
const VENDOR_INTERFACE = 2;

// ─── Base Transport ──────────────────────────────────────────────────────

export class DSPiTransport {
    constructor() {
        this._onDisconnect = null;
    }

    async connect() { throw new Error("Not implemented"); }
    async disconnect() { throw new Error("Not implemented"); }
    get connected() { return false; }
    get name() { return "none"; }

    /**
     * Send a USB control transfer.
     * @param {'in'|'out'} direction
     * @param {number} bRequest
     * @param {number} wValue
     * @param {Uint8Array|number} dataOrLen - OUT: data bytes; IN: length to read
     * @returns {Promise<Uint8Array>} - response data (empty for OUT)
     */
    async ctrlTransfer(direction, bRequest, wValue, wIndex, dataOrLen) {
        throw new Error("Not implemented");
    }

    onDisconnect(cb) { this._onDisconnect = cb; }
    _fireDisconnect() { if (this._onDisconnect) this._onDisconnect(); }
}

// ─── WebUSB Transport ────────────────────────────────────────────────────

export class WebUSBTransport extends DSPiTransport {
    constructor() {
        super();
        this._device = null;
        this._iface = null;
    }

    get connected() { return this._device != null && this._device.opened; }
    get name() { return "WebUSB"; }

    async connect() {
        if (!navigator.usb) throw new Error("WebUSB not supported in this browser");

        // Request the DSPi device
        this._device = await navigator.usb.requestDevice({
            filters: [{ vendorId: DSPI_VID, productId: DSPI_PID }]
        });

        await this._device.open();
        // Select configuration #1
        await this._device.selectConfiguration(1);
        // Claim the vendor interface (interface 2)
        await this._device.claimInterface(VENDOR_INTERFACE);

        // Listen for disconnect
        navigator.usb.addEventListener("disconnect", (e) => {
            if (e.device === this._device) {
                this._device = null;
                this._fireDisconnect();
            }
        });
    }

    async disconnect() {
        if (this._device) {
            try {
                await this._device.releaseInterface(VENDOR_INTERFACE);
                await this._device.close();
            } catch (e) { /* ignore */ }
            this._device = null;
        }
    }

    async ctrlTransfer(direction, bRequest, wValue, wIndex, dataOrLen) {
        if (!this.connected) throw new Error("Device not connected");

        const isOut = direction === 'out';
        const setup = {
            requestType: 'vendor',
            recipient: 'interface',
            request: bRequest,
            value: wValue,
            index: VENDOR_INTERFACE,
        };

        if (isOut) {
            const data = dataOrLen instanceof Uint8Array ? dataOrLen : new Uint8Array(0);
            setup.dataOut = data;
            const result = await this._device.controlTransferOut(setup, data);
            return new Uint8Array(0);
        } else {
            const len = typeof dataOrLen === 'number' ? dataOrLen : 64;
            const result = await this._device.controlTransferIn(setup, len);
            if (result.status === 'ok' && result.data) {
                return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
            }
            throw new Error(`Control transfer IN failed: ${result.status}`);
        }
    }
}

// ─── WebSocket Transport ─────────────────────────────────────────────────

export class WebSocketTransport extends DSPiTransport {
    /**
     * @param {string} url - WebSocket URL, e.g. "ws://localhost:8765/ws"
     */
    constructor(url = `ws://${location.hostname}:8765/ws`) {
        super();
        this._url = url;
        this._ws = null;
        this._pending = new Map(); // id -> {resolve, reject}
        this._nextId = 1;
        this._meterCallbacks = [];
    }

    get connected() { return this._ws != null && this._ws.readyState === WebSocket.OPEN; }
    get name() { return "Bridge"; }

    async connect() {
        return new Promise((resolve, reject) => {
            this._ws = new WebSocket(this._url);

            this._ws.onopen = () => resolve();
            this._ws.onerror = (e) => reject(new Error("WebSocket connection failed"));
            this._ws.onclose = () => {
                // Reject all pending requests
                for (const [id, { reject }] of this._pending) {
                    reject(new Error("WebSocket closed"));
                }
                this._pending.clear();
                this._ws = null;
                this._fireDisconnect();
            };

            this._ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.type === "meters") {
                    // Server-pushed metering data
                    for (const cb of this._meterCallbacks) cb(msg);
                    return;
                }
                // Response to a command
                if (msg.id != null && this._pending.has(msg.id)) {
                    const { resolve, reject } = this._pending.get(msg.id);
                    this._pending.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message || "Unknown error"));
                    } else {
                        resolve(msg.result);
                    }
                }
            };
        });
    }

    async disconnect() {
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
    }

    /**
     * Send a command via the bridge JSON-RPC protocol.
     * The bridge translates method calls to USB control transfers.
     */
    async ctrlTransfer(direction, bRequest, wValue, wIndex, dataOrLen) {
        if (!this.connected) throw new Error("WebSocket not connected");
        // We use a higher-level RPC instead of raw control transfers
        // This is handled by DSPiClient which calls _rpc() directly
        throw new Error("Use _rpc() for WebSocket transport");
    }

    /**
     * JSON-RPC call to the bridge server.
     */
    async _rpc(method, params = {}) {
        if (!this.connected) throw new Error("WebSocket not connected");

        const id = this._nextId++;
        return new Promise((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            this._ws.send(JSON.stringify({ id, method, params }));

            // Timeout after 5s
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`Timeout: ${method}`));
                }
            }, 5000);
        });
    }

    onMeters(callback) {
        this._meterCallbacks.push(callback);
    }
}

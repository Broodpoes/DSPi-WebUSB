# DSPi Web Interface Plan

## Goal
Build a browser-based control panel for DSPi that works two ways:
1. **WebUSB** — direct browser-to-device (requires firmware changes)
2. **Bridge app** — localhost Python process with WebSocket fallback (works with current firmware)

The frontend is identical regardless of transport.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Browser (Web App)               │
│  ┌───────────────┐  ┌────────────────────┐   │
│  │   WebUSB      │  │  WebSocket client   │   │
│  │   Transport   │  │  Transport           │   │
│  └───────┬───────┘  └─────────┬──────────┘   │
│          │                    │               │
│          │   ┌────────────────┘               │
│          │   │                                │
│  ┌───────▼───▼────────┐                       │
│  │  DSPi Client SDK   │                       │
│  │  (transport-agnostic│                      │
│  │   USB protocol impl)│                      │
│  └────────┬───────────┘                       │
│           │                                   │
│  ┌────────▼───────────┐                       │
│  │     UI Components   │                      │
│  └────────────────────┘                       │
└───────────────────────────────────────────────┘
         │                  │
    WebUSB API         WebSocket
         │                  │
         ▼                  ▼
  ┌─────────────┐   ┌──────────────┐
  │  DSPi       │   │ Bridge App   │
  │  Firmware   │   │ (Python)     │
  │  (WebUSB)   │   │              │
  └─────────────┘   │  pyusb ──────┼──► DSPi Firmware
                    │              │    (existing protocol)
                    └──────────────┘
```

---

## Phase 1: Firmware — WebUSB Support

### 1.1 BOS Descriptor + Device Descriptor Change
**File:** `firmware/DSPi/usb_descriptors.c`

- Change `bcdUSB` from `0x0200` to `0x0210` in `boot_device_descriptor`
- Add a BOS descriptor (`const uint8_t bos_descriptor[]`) containing:
  - BOS header (5 bytes): `bLength=5, bDescriptorType=0x0F, wTotalLength, bNumDeviceCaps=1`
  - WebUSB Platform Capability Descriptor (24 bytes):
    - `bLength=24, bDescriptorType=0x10, bDevCapabilityType=0x05`
    - Platform Capability UUID: `3408b638-09a9-47a0-8bfd-a0768815b665` (WebUSB)
    - `bcdVersion=0x0100`
    - `bDevCapabilityCode=0x02` (URL)
    - `wVendorCode=0x02` (different from MS_VENDOR_CODE=0x01)

### 1.2 USB Stack Patch — BOS Descriptor Handler
**File:** `firmware/pico-extras/src/rp2_common/usb_device/usb_device.c`

Add `case 0x0F:` (USB_DT_BOS) to `_usb_handle_get_descriptor()` (~10 lines):
```c
case 0x0F: { // BOS Descriptor
    extern const uint8_t bos_descriptor[];
    extern const uint16_t bos_descriptor_len;
    len = bos_descriptor_len;
    src = bos_descriptor;
    break;
}
```

### 1.3 Landing Page URL Handler
**File:** `firmware/DSPi/main.c` (vendor request handler)

Handle vendor code `0x02` with `bRequest == 0x02` (GET_URL):
- Return a URL string descriptor pointing to the hosted web app
- URL descriptor format: `[bLength, 0x03, scheme_byte, "url..."]`
- Scheme: `0x01` (HTTP) or `0x03` (HTTPS)

### 1.4 Extern Declarations
**File:** `firmware/DSPi/usb_descriptors.h`

Declare `bos_descriptor` and `bos_descriptor_len` as extern.

### Files to Modify
| File | Change |
|------|--------|
| `firmware/DSPi/usb_descriptors.c` | bcdUSB, add BOS descriptor, URL descriptor |
| `firmware/DSPi/usb_descriptors.h` | extern declarations for BOS |
| `firmware/DSPi/main.c` | WebUSB vendor request handler |
| `firmware/pico-extras/src/rp2_common/usb_device/usb_device.c` | Add BOS case to GET_DESCRIPTOR |

### Risk Mitigation
- Audio streaming is unaffected (only descriptor path changes)
- WCID/WinUSB continues to work (different vendor code)
- Vendor interface claim is independent of audio interfaces
- Test: verify device enumerates correctly on Windows, macOS, Linux after changes

---

## Phase 2: Bridge App (Python)

### 2.1 Technology
- **Python 3.10+**
- **pyusb** — USB control transfers (libusb backend)
- **aiohttp** — HTTP server (serves static web app) + WebSocket
- Single-file bridge script (~500-800 lines)

### 2.2 USB Protocol Implementation
The bridge implements the full DSPi vendor command set:
- Generic `ctrl_transfer(direction, bRequest, wValue, wIndex, data/length)` abstraction
- Typed wrappers for each command group (EQ, mixer, presets, etc.)
- `REQ_GET_ALL_PARAMS` / `REQ_SET_ALL_PARAMS` for bulk state sync

### 2.3 WebSocket API
JSON-based command/response protocol:
```json
// Request
{"id": 1, "method": "get_eq_param", "params": {"channel": 0, "band": 0}}
{"id": 2, "method": "set_eq_param", "params": {"channel": 0, "band": 0, "type": 1, "freq": 1000, "q": 1.0, "gain_db": -3.0}}
{"id": 3, "method": "get_all_params"}

// Response
{"id": 1, "result": {"channel": 0, "band": 0, "type": 1, "freq": 1000, "q": 1.0, "gain_db": -3.0}}
{"id": 2, "result": "ok"}

// Metering (server push, ~10Hz)
{"type": "meters", "peaks": [...], "clips": 0, "cpu0": 12, "cpu1": 8}
```

### 2.4 Auto-device Discovery
- Scan USB bus for VID:PID `0x2E8A:0xFEAA`
- Auto-reconnect on device disconnect/reconnect
- Support device selection when multiple DSPi units are connected

### Files to Create
| File | Purpose |
|------|---------|
| `web/bridge/bridge.py` | Main bridge application |
| `web/bridge/usb_protocol.py` | DSPi USB protocol implementation |
| `web/bridge/requirements.txt` | Python dependencies |

---

## Phase 3: Web App Frontend

### 3.1 Technology
- **Vanilla JS** (no framework) — keeps it simple, fast to load, no build step
- **Web Components** for reusable UI elements
- **Canvas API** for EQ curve visualization and meters
- Single HTML file that works served from bridge or from a remote URL (WebUSB)

### 3.2 Transport Abstraction
```js
// Abstract transport interface
class DSPiTransport {
  async connect() {}
  async disconnect() {}
  async ctrlTransfer(direction, bRequest, wValue, wIndex, dataOrLen) {}
  onDisconnect(callback) {}
}

class WebUSBTransport extends DSPiTransport { /* WebUSB API */ }
class WebSocketTransport extends DSPiTransport { /* ws://localhost */ }
```

The `DSPiClient` class takes a transport and implements all vendor commands — identical protocol logic regardless of transport.

### 3.3 UI Sections

| Section | Features |
|---------|----------|
| **Connection** | Device picker, transport indicator (WebUSB/bridge), firmware version |
| **Master Volume** | Vertical slider, dB readout, mute, persistence mode |
| **Per-Channel Preamp** | L/R gain sliders |
| **Master EQ** | 10-band PEQ per channel (L/R), interactive frequency response curve (Canvas), filter type/freq/Q/gain controls |
| **Matrix Mixer** | 2×N grid (input × output), per-crosspoint enable/gain/phase, per-output enable/gain/mute/delay |
| **Output EQ** | 10-band PEQ per output channel (tabbed), same UI as master EQ |
| **Crossfeed** | Enable, preset selector (Default/Chu Moy/Jan Meier/Custom), freq/feed/ITD controls |
| **Loudness** | Enable, reference SPL, intensity |
| **Volume Leveller** | Enable, amount, speed, max gain, lookahead, gate threshold |
| **Presets** | 10-slot grid, name edit, save/load/delete, startup config, bulk state sync |
| **Diagnostics** | Real-time peak/clip meters, CPU load, buffer stats, USB error counters, starvation counters |
| **Configuration** | Output type (S/PDIF/I2S) per slot, pin assignment, I2S clock config |
| **Firmware Update** | UF2 upload via REQ_ENTER_BOOTLOADER |

### 3.4 Real-time Meters
- Poll `REQ_GET_STATUS` at ~10Hz via the bridge WebSocket or WebUSB
- Canvas-rendered peak bars with decay ballistics (host-side)
- Clip indicators (sticky until cleared)
- CPU load per core

### Files to Create
| File | Purpose |
|------|---------|
| `web/app/index.html` | Main page with all UI sections |
| `web/app/app.js` | Application logic, UI wiring |
| `web/app/transport.js` | WebUSB + WebSocket transport classes |
| `web/app/dspi-client.js` | Protocol implementation (command encoding/decoding) |
| `web/app/eq-curve.js` | Frequency response curve renderer (Canvas) |
| `web/app/meters.js` | Peak/clip meter renderer (Canvas) |
| `web/app/style.css` | Styling |
| `web/app/components/` | Web Components (slider, knob, matrix-grid, etc.) |

---

## Phase 4: Verification

### Firmware Verification
1. Build firmware for both RP2040 and RP2350
2. Verify device enumerates on Windows (WinUSB still works), macOS, Linux
3. Verify Chrome detects WebUSB landing page
4. Verify audio streaming is unaffected
5. Verify existing DSPi Console still works with modified firmware

### Bridge Verification
1. Connect to device via bridge on Linux
2. Exercise all vendor commands
3. Verify bulk parameter transfer (GET/SET ALL_PARAMS)
4. Verify auto-reconnect on device disconnect

### Web App Verification
1. Test with WebUSB transport in Chrome
2. Test with WebSocket transport (bridge) in Chrome/Firefox/Safari
3. Verify all DSP parameters can be read and written
4. Verify real-time metering updates
5. Verify preset save/load round-trip

---

## Implementation Order

1. **Firmware WebUSB changes** (Phase 1)
2. **Bridge app + USB protocol** (Phase 2)
3. **Web app — Core features** (Phase 3a): volume, EQ, presets, metering
4. **Web app — Remaining features** (Phase 3b): matrix mixer, crossfeed, loudness, leveller, config, firmware update
5. **Integration testing** (Phase 4)

### Phase 3a Scope (Core Features — First Iteration)
- Master volume + mute
- Per-channel preamp (L/R)
- Master EQ (10-band PEQ, interactive frequency response curve)
- Output EQ (10-band PEQ per output, tabbed)
- Presets (10-slot grid, save/load/delete, names, startup config)
- Real-time peak/clip/CPU metering
- Transport connection UI (WebUSB or bridge auto-detect)

### Phase 3b Scope (Remaining — Follow-up)
- Matrix mixer (2xN grid with crosspoint controls)
- Crossfeed (preset + custom)
- Loudness compensation
- Volume leveller
- Output configuration (S/PDIF/I2S, pin assignment, I2S clock)
- Firmware update (UF2 via bootloader)

---

## Decisions
- **Scope:** Core features first (Phase 3a), build out incrementally
- **Bridge:** Python (pyusb + aiohttp + websockets)
- **Frontend:** Vanilla JS + Canvas, no build step
- **Web app hosting:** GitHub Pages (for WebUSB landing page)
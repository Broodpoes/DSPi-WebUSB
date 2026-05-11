# Web Interface

The DSPi web interface provides a browser-based control panel for all device parameters — EQ, volume, presets, metering, DSP settings, and more. The same UI can be driven through two transport modes: **WebUSB** (direct browser-to-device) or **Python bridge** (browser-to-bridge-to-device).

## Overview

| | WebUSB | Python Bridge |
|---|---|---|
| Transport | Browser → Device (direct USB) | Browser → WebSocket → Bridge → pyusb → Device |
| Browser | Chrome / Edge only | Any modern browser |
| Metering | Poll-based only | 10 Hz server push |
| Setup | Zero install | Python + udev rule |
| Best for | Quick access, no host software | Full-featured control, metering, remote access |

Both modes use the same JavaScript client (`dspi-client.js`) and expose identical functionality. The bridge adds real-time metering push and works on any OS/browser that can reach the bridge server over HTTP.

## Architecture

```
                          ┌─────────────────────────────────────────────┐
                          │               Browser (UI)                  │
                          │  index.html + transport.js + dspi-client.js│
                          └──────┬────────────────────┬────────────────┘
                                 │                    │
                          WebUSB │                    │ WebSocket (JSON-RPC)
                    (Chrome only,                    │
                     direct USB)                     ▼
                                 │          ┌───────────────────┐
                                 │          │  Python Bridge    │
                                 │          │  (aiohttp + pyusb)│
                                 │          └────────┬──────────┘
                                 │                   │ libusb
                                 │                   ▼
                                 └──────────► DSPi Device
                                              (VID:PID 2E8A:FEAA)
                                              Interface 2 (vendor)
```

- **WebUSB path**: The browser opens the device directly via the WebUSB API, sends USB control transfers on interface 2. No host software required.
- **Bridge path**: The Python bridge holds a persistent `pyusb` connection to the device. The browser communicates with the bridge via WebSocket JSON-RPC. The bridge also pushes metering data at ~10 Hz.

## Python Bridge Setup

### Prerequisites

- Python 3.10+
- A DSPi device connected via USB
- `libusb` installed (bundled with most Linux distributions; on macOS use `brew install libusb`)

### Install Dependencies

```bash
cd web/bridge
pip install -r requirements.txt
```

This installs:

- `pyusb >= 1.2.0` — USB device communication via libusb
- `aiohttp >= 3.9.0` — HTTP/WebSocket server

### USB Permissions (Linux)

By default, USB devices are only accessible to root. Create a udev rule to allow user-space access:

```bash
sudo tee /etc/udev/rules.d/99-dspi.rules << 'EOF'
SUBSYSTEM=="usb", ATTR{idVendor}=="2e8a", ATTR{idProduct}=="feaa", MODE="0666"
EOF
```

Then reload udev rules and trigger:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

**Re-plug the DSPi device** (or power-cycle it) for the new rule to take effect.

> **macOS / Windows**: No udev configuration is needed. libusb can open devices directly. On Windows, you may need to install the WinUSB driver via [Zadig](https://zadig.akeo.ie/).

### Starting the Bridge

```bash
cd web/bridge
python bridge.py [--port PORT] [--static PATH] [--no-auto]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `8765` | HTTP/WebSocket listen port |
| `--static` | `../app` | Path to the web UI static files. When set, the bridge serves the UI at `http://localhost:PORT/` |
| `--no-auto` | off | Disable automatic device connection at startup. Use the `/api/connect` endpoint to connect manually |

### Auto-Connect Behavior

By default, the bridge attempts to connect to a DSPi device on startup. If successful, it logs:

```
Connected to DSPi: platform=RP2040 serial=XXXXXXXX
```

If no device is found, the bridge still starts — you can connect a device later and use the REST endpoint to reconnect (see below).

### Verifying the Connection

Check the bridge status:

```bash
curl http://localhost:8765/api/status
```

**Device connected:**

```json
{"connected": true, "platform": 0, "serial": "XXXXXXXX"}
```

**No device:**

```json
{"connected": false}
```

Additional REST endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Connection status, platform, serial |
| `/api/connect` | POST | Attempt to connect to a device |
| `/api/disconnect` | POST | Disconnect from the current device |

## Web App Usage

### Opening the UI

With the bridge running and serving static files:

```
http://localhost:8765
```

The connection panel appears on load.

### Connection Panel

Two connection options are presented:

1. **Connect via WebUSB** — Available in Chrome/Edge. The browser prompts for device selection, then opens a direct USB session. No bridge required.
2. **Connect via Bridge** — Works in any browser. Requires the bridge to be running. The browser opens a WebSocket to `ws://localhost:8765/ws`.

Once connected, the status indicator turns green and shows the transport type (WebUSB or Bridge).

### Main UI Layout

The interface uses a three-column layout:

#### Left Sidebar

- **Presets** — Grid of 10 preset slots with load/save/delete. Factory reset button. "Save Current" persists the active DSP state to a preset slot.
- **Preamp** — Per-channel (L/R) gain sliders, range −30 to +12 dB in 0.5 dB steps.
- **Master EQ Bypass** — Toggle switch to bypass the entire master EQ.

#### Center Panel

- **Master EQ** — Interactive frequency-response curve rendered on a `<canvas>`. Below the curve, a channel selector (Left / Right tabs) and a 10-band parametric EQ table with columns: band number, filter type (Flat, Peaking, Low Shelf, High Shelf, Low Pass, High Pass), frequency (Hz), Q, and gain (dB). Changes update the curve in real time.
- **Output EQ** — Per-output EQ with its own tab bar for selecting the active output channel, another interactive `<canvas>` curve, and a matching 10-band parametric EQ table.

#### Right Panel

- **Master Volume** — Large dB readout, slider (−127 to 0 dB in 0.5 dB steps), and mute toggle.
- **Meters** — Real-time peak/clip metering rendered on a `<canvas>`. "Clear Clips" button resets clip indicators.
- **Device Info** — Platform (RP2040 or RP2350), serial number, and firmware version.

### Real-Time Metering

When connected via the bridge, the server pushes peak, clip, and CPU metering data to all connected WebSocket clients at ~10 Hz:

```json
{"type": "meters", "raw": "hex-encoded bytes"}
```

The web app parses this data and renders it on the meter canvas. Metering starts automatically when the first WebSocket client connects, and stops when the last client disconnects.

When using WebUSB, there is no server-push mechanism — the UI must poll for metering data.

## WebUSB Direct Access

### Requirements

- **Browser**: Chrome 61+ or Edge 79+ (any Chromium-based browser with WebUSB support). Firefox and Safari do not support WebUSB.
- **Firmware**: The device must advertise `bcdUSB = 0x0210` and include a BOS descriptor with the WebUSB Platform Capability. The DSPi firmware includes these by default — no special build flags are needed.
- **Landing page**: The firmware embeds the URL `weeblabs.github.io/dspi-web` in its WebUSB URL descriptor. When a user activates WebUSB (e.g., via `chrome://usb-devices`), the browser can navigate to this page.

### How It Works

1. The user clicks **Connect via WebUSB** in the UI.
2. `navigator.usb.requestDevice()` opens a browser permission dialog filtered to VID `0x2E8A`, PID `0xFEAA`.
3. After approval, the browser opens the device, selects configuration 1, and claims interface 2 (the vendor interface).
4. All subsequent commands are sent as USB control transfers (`bmRequestType = vendor`, `recipient = interface`, `wIndex = 2`) directly from JavaScript.
5. The browser listens for `disconnect` events and updates the UI if the device is unplugged.

### Limitations

- **Chrome/Edge only** — WebUSB is not available in Firefox, Safari, or mobile browsers.
- **No metering push** — The browser cannot receive asynchronous data from a USB device. Metering must be polled by the client, which is less efficient than the bridge's 10 Hz push.
- **No remote access** — The device must be physically connected to the machine running the browser.
- **Single-session** — Only one application can claim the USB interface at a time. If the bridge is connected, WebUSB will fail (and vice versa).

## Bridge vs WebUSB Comparison

| Feature | Bridge | WebUSB |
|---------|--------|--------|
| Browser support | Any modern browser | Chrome, Edge (Chromium-based) |
| Real-time metering | 10 Hz server push | Client polling only |
| Remote access | Yes (bridge can serve over network) | No (local USB only) |
| Firmware requirement | Standard DSPi firmware | Standard DSPi firmware (bcdUSB 0x0210 + BOS) |
| Host software | Python 3.10+, pyusb, aiohttp | None |
| USB permissions | udev rule (Linux) or WinUSB (Windows) | Browser handles it |
| Setup complexity | Moderate (install deps, udev) | None |
| Concurrency | Multiple browser tabs via WebSocket | Single tab (USB interface claimed) |
| Device latency | Added bridge hop (~1 ms) | Direct (fastest) |

## Next Steps

For protocol-level details — vendor request codes, control transfer formats, parameter encoding, and the full JSON-RPC method reference — see [API Reference](api-reference.md).

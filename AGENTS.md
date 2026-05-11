# Repository Guidelines

## Project Overview

DSPi is a USB audio DSP processor running on RP2040/RP2350 (Raspberry Pi Pico). It appears as a USB Audio Class 1 sound card and applies real-time DSP processing — parametric EQ, active crossovers, loudness compensation, headphone crossfeed, volume levelling, matrix mixing, and time alignment — before outputting over S/PDIF, I2S, or PDM.

Three components: C firmware (dual-core ARM), Python USB-to-WebSocket bridge, and a vanilla JS web frontend.

## Architecture & Data Flow

### Audio Signal Chain (firmware)

```
USB Audio In (UAC1, 16/24-bit PCM, 44.1/48/96 kHz)
  → PASS 1: Per-channel preamp + USB volume
  → PASS 2: Master EQ (10 bands/channel, biquad)
  → PASS 2.5: Volume leveller (RMS upward compressor)
  → PASS 3: Crossfeed (BS2B) + Peak Meter + Loudness (ISO 226:2003)
  → PASS 4: Matrix mixer (2xN crosspoint routing)
  → PASS 5: Per-output EQ → gain/mute → delay → output gain × master volume
  → S/PDIF output(s) / I2S output(s) / PDM subwoofer
```

### Dual-Core Architecture

- **Core 0**: USB stack, audio streaming, DSP pipeline, vendor command handling, flash operations
- **Core 1**: Three selectable modes — PDM subwoofer output, EQ worker (offloaded biquad computation), or idle

### USB Interface Layout

| Interface | Class | Purpose |
|-----------|-------|---------|
| 0 | Audio Control | UAC1 mixer/mute/volume |
| 1 | Audio Streaming | Isochronous audio (alt 0: none, alt 1: 16-bit, alt 2: 24-bit) |
| 2 | Vendor Specific (0xFF) | All DSP control via EP0 control transfers |

**VID:PID**: `0x2E8A:0xFEAA`. Vendor interface = 2. `bcdUSB = 0x0210` (WebUSB capable).

### Web Interface Architecture

```
Browser ←WebUSB or WebSocket→ bridge.py (aiohttp) ←pyusb→ DSPi device
```

- `transport.js`: Abstract transport with `WebUSBTransport` and `WebSocketTransport` implementations
- `dspi-client.js`: Transport-agnostic protocol layer, auto-routes between WebUSB control transfers and WebSocket RPC
- `bridge.py`: aiohttp server with JSON-RPC WebSocket dispatch, 10Hz metering push, static file serving
- `usb_protocol.py`: `DSPiDevice` class wrapping all 80+ vendor commands

## Key Directories

```
firmware/
  DSPi/                  # Core firmware source
    main.c               # Entry point, core0_init(), main loop
    usb_audio.c          # USB audio streaming + vendor command dispatch (~3400 lines)
    dsp_pipeline.c       # DSP chain orchestration (compiled -O3)
    usb_descriptors.c    # USB descriptors (VID/PID, BOS/WebUSB, MS OS, WCID)
    usb_descriptors.h    # Descriptor declarations, vendor code constants
    config.h             # All REQ_* command codes, constants, struct definitions
    bulk_params.h/.c     # Bulk parameter transfer (~2896 bytes)
    leveller.c           # Volume leveller (upward compressor)
    loudness.c           # ISO 226:2003 loudness compensation
    pdm_generator.c      # 2nd-order delta-sigma PDM output
    flash_storage.c      # Preset persistence, flash layout management
    crossfeed.c          # BS2B headphone crossfeed with ITD
    usb_feedback_controller.c  # Async USB feedback endpoint
    lufa/                # LUFA BSD-licensed code (ring buffer, CRC)
    dsp_process_rp2040.S # ARM Thumb assembly biquad (RP2040 only, Q28 fixed-point)
  pico-sdk/              # Git submodule (raspberrypi/pico-sdk)
  pico-extras/           # Modified fork committed in-tree (NOT a submodule)
    src/rp2_common/usb_device/  # Patched USB stack (BOS descriptor support)
    src/rp2_common/pico_audio_spdif_multi/  # Multi-instance S/PDIF
    src/rp2_common/pico_audio_i2s_multi/    # Multi-instance I2S
  CMakeLists.txt         # Top-level CMake (SDK resolution, flash clkdiv, custom audio libs)

web/
  bridge/
    bridge.py            # aiohttp WebSocket bridge server
    usb_protocol.py      # DSPiDevice class (full vendor command protocol)
    requirements.txt     # pyusb>=1.2.0, aiohttp>=3.9.0
  app/
    index.html           # Single-page app (connection, EQ, volume, presets, meters)
    style.css            # Dark theme, 3-column layout
    transport.js         # WebUSB + WebSocket transport classes
    dspi-client.js       # Transport-agnostic protocol client
    eq-curve.js          # Canvas EQ curve (RBJ biquad magnitude response)
    meters.js            # Canvas peak/clip meters (Q15 parsing)

Documentation/
  current_architecture.md  # Authoritative architecture reference (1467 lines)
  web_interface_plan.md    # Web interface implementation plan
  Roadmap.md               # Feature roadmap
  Features/                # 16 feature spec files (protocol, wire formats, edge cases)
```

## Development Commands

### Prerequisites

CMake ≥ 3.12, `arm-none-eabi-gcc`, Python 3, Git. Clone with `--recursive` for pico-sdk submodule.

### Firmware Build

```bash
# RP2040 (Raspberry Pi Pico)
mkdir -p build-rp2040 && cd build-rp2040
cmake -DPICO_BOARD=pico -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
make -j$(nproc)
# Output: build-rp2040/DSPi/DSPi.uf2

# RP2350 (Raspberry Pi Pico 2)
mkdir -p build-rp2350 && cd build-rp2350
cmake -DPICO_BOARD=pico2 -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
make -j$(nproc)
# Output: build-rp2350/DSPi/DSPi.uf2

# Clean rebuild
rm -rf build-rp2040 build-rp2350
```

Flash UF2 via bootloader (hold BOOTSEL on power-up, drag .uf2 file). Or send vendor command `REQ_ENTER_BOOTLOADER (0xF0)` to reboot an already-running device.

### Web Bridge

```bash
cd web/bridge
pip install -r requirements.txt
python bridge.py [--port 8765] [--static ../app] [--no-auto]
```

Requires udev rule for non-root USB access:
```
SUBSYSTEM=="usb", ATTR{idVendor}=="2e8a", ATTR{idProduct}=="feaa", MODE="0666"
```

## Code Conventions & Common Patterns

### Firmware (C)

- **Binary type**: `copy_to_ram` (full image in SRAM, no XIP during audio processing)
- **Compiler flags**: Global `-O2 -fcommon`. Specific files get `-O3`: `dsp_pipeline.c`, `usb_audio.c`, `crossfeed.c`, `loudness.c`, `leveller.c`
- **Flash safety**: `PICO_FLASH_SPI_CLKDIV=6` (307.2 MHz / 6 = 51.2 MHz flash clock, under W25Q080 max)
- **Vendor command dispatch**: Giant `switch` in `usb_audio.c` (~line 2200+). Commands decoded from `setup->bRequest`, params from `setup->wValue`/`setup->wIndex`
- **Response pattern**: `vendor_send_response(buf, len)` writes directly to USB IN buffer. Firmware does NOT clamp responses to `wLength` — host must request ≥ actual response size
- **Interrupt context**: Vendor request handlers run in IRQ context. Flash writes deferred to main loop via `preset_save_pending` flag
- **Data encoding**: Little-endian throughout. Floats via `memcpy` (not unaligned access). EQ params packed as `struct { uint8_t channel, band, type, _pad; float freq, Q, gain_db; }`

### EQ Parameter Wire Format

GET uses per-param requests (4 separate control transfers per band):
```
wValue = (channel << 8) | (band << 4) | param_index
param_index: 0=type (uint32 LE), 1=freq (float32 LE), 2=Q (float32 LE), 3=gain_db (float32 LE)
Response: 4 bytes per request
```

SET uses a single 16-byte payload:
```c
struct.pack('<BBBBffff', channel, band, type, 0, freq, Q, gain_db)
```

### Bridge (Python)

- **Threading model**: Single `ThreadPoolExecutor(max_workers=1)` named `"usb"`. ALL USB calls go through `loop.run_in_executor(_usb_executor, ...)` — libusb is not thread-safe
- **JSON-RPC protocol**: Incoming `{id, method, params}`, response `{id, result}` or `{id, error: {message}}`. Server-pushed meter data: `{type: "meters", raw: "<hex>"}`
- **Composite methods**: `get_loudness`, `get_crossfeed`, `get_leveller`, `get_i2s_config` make multiple USB calls and return merged results
- **No async in USB layer**: `_connect_device()` and `_handle_command()` are plain sync functions — they run inside the executor thread

### Web App (JavaScript)

- **No build step**: Vanilla JS, no bundler/transpiler. ES modules via `<script type="module">`
- **Canvas rendering**: `eq-curve.js` uses RBJ Audio EQ Cookbook biquad magnitude computation. `meters.js` parses Q15 wire format. Both are High-DPI aware
- **Transport abstraction**: `DSPiTransport` base class → `WebUSBTransport` / `WebSocketTransport`. `DSPiClient` auto-detects transport via `constructor.name`

## Important Files

| File | Purpose |
|------|---------|
| `firmware/DSPi/config.h` | All `REQ_*` vendor command codes, platform constants, struct definitions |
| `firmware/DSPi/usb_audio.c` | USB audio streaming + vendor command dispatch (central file, ~3400 lines) |
| `firmware/DSPi/usb_descriptors.c` | USB descriptors, BOS/WebUSB, MS OS descriptors, WCID |
| `firmware/DSPi/main.c` | Entry point, `core0_init()`, main loop |
| `firmware/DSPi/bulk_params.h` | `WireBulkParams` V6 struct (~2896 bytes for full state sync) |
| `web/bridge/usb_protocol.py` | `DSPiDevice` class — complete Python wrapper for all vendor commands |
| `web/bridge/bridge.py` | aiohttp server, WebSocket JSON-RPC, metering push |
| `README.md` | User/developer docs including full USB vendor command reference table |

## Runtime/Tooling Preferences

- **Python**: 3.10+ (type hints use `X \| Y` union syntax)
- **JavaScript**: ES2020+ (modules, optional chaining). No Node.js runtime needed
- **USB backend**: pyusb with libusb1 backend. Device must have udev rule for non-root access
- **Web server**: aiohttp (not Flask/FastAPI — needed for native WebSocket support)
- **No package manager for frontend**: Static files served directly

## Testing & QA

- **Firmware**: No automated test suite. Verify via clean build (`make -j$(nproc)` with zero warnings). Test on hardware with vendor command exercise
- **Bridge**: No test suite. Verify via manual WebSocket RPC test against live device
- **Build verification**: Both RP2040 and RP2350 must build clean from scratch. Binary sizes: ~184KB (RP2040), ~172KB (RP2350) UF2
- **Protocol testing**: Use bridge WebSocket to exercise all vendor commands. Key commands to verify after changes: `get_platform` (4-byte response), `get_eq_param` (4 separate param reads), `get_all_params` (2896-byte bulk transfer)

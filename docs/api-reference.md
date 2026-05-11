# API Reference

## Overview

The DSPi bridge server exposes the device through two interfaces:

- **WebSocket JSON-RPC** — the primary interface for all device control. Every USB vendor request is mapped to a named RPC method.
- **HTTP REST** — lightweight endpoints for connection management and device status.

The bridge is an optional component (`web/bridge/bridge.py`) that runs on a host machine with USB access to the DSPi device, translating between browser/WebSocket clients and the device's USB vendor interface.

## Connection

### WebSocket

```
ws://<host>:<port>/ws
```

Default port: `8765`.

All device commands are sent as JSON-RPC 2.0 requests over this connection. The bridge also pushes metering data asynchronously to every connected WebSocket client (see [Server-Push Messages](#server-push-messages)).

### HTTP REST Endpoints

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| GET | `/api/status` | Check whether a device is currently connected | `{ connected, platform?, serial? }` |
| POST | `/api/connect` | Scan for and connect to the first DSPi device found | `{ connected: true }` or 404 `{ connected: false, error }` |
| POST | `/api/disconnect` | Disconnect from the current device | `{ connected: false }` |

`/api/status` returns `platform` (int: 0=RP2040, 1=RP2350) and `serial` (16-char hex string) when a device is connected.

## WebSocket Protocol

### Request Format

```json
{
  "id": 1,
  "method": "get_eq_param",
  "params": { "channel": 0, "band": 1 }
}
```

- `id` — integer, client-assigned. Used to correlate responses.
- `method` — string, one of the method names listed below.
- `params` — object containing the method's parameters. Omitted or `{}` for parameterless calls.

### Success Response

```json
{
  "id": 1,
  "result": { "channel": 0, "band": 1, "type": 1, "freq": 1000.0, "Q": 0.707, "gain_db": -3.0 }
}
```

### Error Response

```json
{
  "id": 1,
  "error": { "message": "No device connected" }
}
```

Errors always use this shape. Common error messages:

- `"No device connected"` — bridge has no active USB device.
- `"Unknown method: ..."` — the method name is not recognised.
- USB/protocol errors are surfaced as their Python exception message.

### Server-Push Messages

Messages without an `id` field are server-initiated pushes. Clients must check for the `type` field before treating a message as an RPC response.

## Server-Push Messages

### Metering Push

The bridge reads peak/clip/CPU data from the device at ~10 Hz (100 ms interval) and broadcasts it to every connected WebSocket client:

```json
{
  "type": "meters",
  "raw": "0a003e00400000001800"
}
```

The `raw` field is a hex-encoded byte string. When decoded, the binary layout is:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 2 × N bytes | `uint16 peaks[N]` — Q15 peak level per channel (0–32767, divide by 32767 for normalised 0.0–1.0) |
| 2 × N | 1 byte | `clip_flags_hi` — clip bits for channels 8–10 |
| 2 × N + 1 | 1 byte | `clip_flags_lo` — clip bits for channels 0–7 |
| 2 × N + 2 | 1 byte | `cpu0_load` — core 0 CPU utilisation (0–100%) |
| 2 × N + 3 | 1 byte | `cpu1_load` — core 1 CPU utilisation (0–100%) |

N is the number of channels (typically 2). Total payload is `2N + 4` bytes (12 bytes for stereo).

Clip flags form a 16-bit bitmask: `(clip_flags_hi << 8) | clip_flags_lo`. Bit *i* is set if channel *i* has clipped since the last clear.

Metering starts automatically when the first WebSocket client connects and stops when the last one disconnects.

## Complete Method Reference

Methods are grouped by feature area. Unless noted, all methods return `"ok"` on success (for setters) or a structured result object (for getters).

### Device Info

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_info` | — | `{ platform: int, serial: string }` | Composite — reads platform ID and serial in one call. Platform: 0 = RP2040, 1 = RP2350. Serial is a 16-char hex string. |

### Master Volume

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_master_volume` | — | `{ db: float }` | Current master volume in dB. −128.0 is the mute sentinel. Range −127..0 dB attenuation. |
| `set_master_volume` | `{ db: float }` | `"ok"` | Set master volume. Use −128.0 to mute. |
| `get_master_volume_mode` | — | `{ mode: int }` | 0 = volatile, 1 = persistent (restored on boot). |
| `set_master_volume_mode` | `{ mode: int }` | `"ok"` | Change persistence mode. |
| `save_master_volume` | — | `"ok"` | Persist current volume to flash. |
| `get_saved_master_volume` | — | `{ db: float }` | Read the volume stored in flash. |

### Per-Channel Preamp

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_preamp_ch` | `{ channel: int }` | `{ channel: int, db: float }` | Preamp gain for the given channel. |
| `set_preamp_ch` | `{ channel: int, db: float }` | `"ok"` | Set preamp gain for the given channel. |

### EQ

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_eq_param` | `{ channel: int, band: int }` | `{ channel: int, band: int, type: int, freq: float, Q: float, gain_db: float }` | Reads one EQ band. Internally performs 4 USB reads (one per parameter). Filter types: 0=FLAT, 1=PEAKING, 2=LOW_SHELF, 3=HIGH_SHELF, 4=LOW_PASS, 5=HIGH_PASS. |
| `set_eq_param` | `{ channel: int, band: int, type: int, freq: float, Q: float, gain_db: float }` | `"ok"` | Write one EQ band (single 16-byte USB transfer). |
| `get_bypass` | — | `bool` | `true` if DSP bypass is active (audio passes through unprocessed). |
| `set_bypass` | `{ on: bool }` | `"ok"` | Enable or disable DSP bypass. |

### Channel Controls

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_channel_gain` | `{ channel: int }` | `{ channel: int, db: float }` | Per-channel gain in dB. |
| `set_channel_gain` | `{ channel: int, db: float }` | `"ok"` | — |
| `get_channel_mute` | `{ channel: int }` | `{ channel: int, muted: bool }` | — |
| `set_channel_mute` | `{ channel: int, muted: bool }` | `"ok"` | — |
| `get_delay` | `{ channel: int }` | `{ channel: int, ms: float }` | Channel delay in milliseconds. |
| `set_delay` | `{ channel: int, ms: float }` | `"ok"` | — |
| `get_channel_name` | `{ channel: int }` | `{ channel: int, name: string }` | 32-byte null-padded ASCII name. |
| `set_channel_name` | `{ channel: int, name: string }` | `"ok"` | Name truncated to 31 chars, null-padded to 32. ASCII only. |

### Presets

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `preset_save` | `{ slot: int }` | `"ok"` | Save current state to preset slot (0–9). |
| `preset_load` | `{ slot: int }` | `"ok"` | Load preset slot into active state. |
| `preset_delete` | `{ slot: int }` | `"ok"` | Delete the preset in the given slot. |
| `preset_get_name` | `{ slot: int }` | `{ slot: int, name: string }` | Preset name (up to 31 chars ASCII). |
| `preset_set_name` | `{ slot: int, name: string }` | `"ok"` | Set preset name. Truncated to 31 chars, null-padded to 32. |
| `preset_get_dir` | — | `{ raw: string }` | 64-byte directory hex string. 10 × 6 bytes: 1 byte valid flag + 1 byte index + 32 bytes name (packed). |
| `preset_get_startup` | — | `{ mode: int, slot: int }` | Startup mode (0=last state, 1=specific preset) and slot. |
| `preset_set_startup` | `{ mode: int, slot: int }` | `"ok"` | Configure which preset loads at boot. |
| `preset_get_include_pins` | — | `{ include_pins: bool }` | Whether pin configuration is saved with presets. |
| `preset_set_include_pins` | `{ include: bool }` | `"ok"` | Toggle pin config inclusion in presets. |
| `preset_get_active` | — | `{ slot: int }` | Currently active preset slot (0xFF if none). |

### Loudness

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_loudness` | — | `{ enabled: bool, ref_spl: float, intensity: float }` | **Composite method** — reads enabled state, reference SPL, and intensity in one RPC call (3 USB transfers internally). ISO 226:2003 equal-loudness compensation. |
| `set_loudness` | `{ enabled: bool }` | `"ok"` | Enable/disable loudness compensation. |
| `set_loudness_ref` | `{ spl: float }` | `"ok"` | Reference SPL in dB. |
| `set_loudness_intensity` | `{ pct: float }` | `"ok"` | Intensity (0.0–1.0). |

### Crossfeed

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_crossfeed` | — | `{ enabled: bool, preset: int, freq: float, feed: float, itd: bool }` | **Composite method** — reads all crossfeed parameters in one RPC call (5 USB transfers internally). BS2B-based crossfeed with ITD via allpass. |
| `set_crossfeed` | `{ enabled: bool }` | `"ok"` | Enable/disable crossfeed. |
| `set_crossfeed_preset` | `{ preset: int }` | `"ok"` | Select a crossfeed preset (0–3). |
| `set_crossfeed_freq` | `{ hz: float }` | `"ok"` | Crossfeed cutoff frequency in Hz. |
| `set_crossfeed_feed` | `{ db: float }` | `"ok"` | Crossfeed feed level in dB. |
| `set_crossfeed_itd` | `{ on: bool }` | `"ok"` | Enable/disable interaural time difference simulation. |

### Volume Leveller

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_leveller` | — | `{ enabled: bool, amount: float, speed: int, max_gain: float, lookahead: bool, gate: float }` | **Composite method** — reads all leveller parameters (6 USB transfers internally). RMS upward compressor. |
| `set_leveller_enable` | `{ on: bool }` | `"ok"` | Enable/disable the leveller. |
| `set_leveller_amount` | `{ val: float }` | `"ok"` | Compression amount. |
| `set_leveller_speed` | `{ speed: int }` | `"ok"` | Response speed. |
| `set_leveller_max_gain` | `{ db: float }` | `"ok"` | Maximum gain in dB. |
| `set_leveller_lookahead` | `{ on: bool }` | `"ok"` | Enable/disable lookahead buffer. |
| `set_leveller_gate` | `{ db: float }` | `"ok"` | Noise gate threshold in dB. |

### Matrix Mixer

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_matrix_route` | `{ input: int, output: int }` | `{ input: int, output: int, enabled: bool, phase_invert: bool, gain_db: float }` | Read one routing point. 8-byte USB transfer. |
| `set_matrix_route` | `{ input: int, output: int, enabled: bool, phase_invert: bool, gain_db: float }` | `"ok"` | Set a routing point. |
| `get_output_enable` | `{ output: int }` | `{ output: int, enabled: bool }` | — |
| `set_output_enable` | `{ output: int, enabled: bool }` | `"ok"` | — |
| `get_output_gain` | `{ output: int }` | `{ output: int, db: float }` | Per-output gain in dB. |
| `set_output_gain` | `{ output: int, db: float }` | `"ok"` | — |
| `get_output_mute` | `{ output: int }` | `{ output: int, muted: bool }` | — |
| `set_output_mute` | `{ output: int, muted: bool }` | `"ok"` | — |
| `get_output_delay` | `{ output: int }` | `{ output: int, ms: float }` | Per-output delay in milliseconds. |
| `set_output_delay` | `{ output: int, ms: float }` | `"ok"` | — |

### Output Configuration

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_output_type` | `{ slot: int }` | `{ slot: int, type: int }` | 0 = S/PDIF, 1 = I²S. |
| `set_output_type` | `{ slot: int, type: int }` | `"ok"` | — |
| `get_output_pin` | `{ output: int }` | `{ output: int, pin: int }` | Current GPIO pin assignment for the output. |
| `set_output_pin` | `{ output: int, pin: int }` | `{ status: int }` | Set GPIO pin. Status: 0=SUCCESS, 1=INVALID_PIN, 2=CONFLICT. |

### I2S Configuration

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_i2s_config` | — | `{ bck_pin: int, mck_enabled: bool, mck_pin: int, mck_multiplier: int }` | **Composite method** — reads all I²S config (4 USB transfers internally). |
| `set_i2s_bck_pin` | `{ pin: int }` | `"ok"` | Set BCK GPIO pin. |
| `set_mck_enable` | `{ on: bool }` | `"ok"` | Enable/disable master clock output. |
| `set_mck_pin` | `{ pin: int }` | `"ok"` | Set MCK GPIO pin. |
| `set_mck_multiplier` | `{ mult: int }` | `"ok"` | Set MCK multiplier. |

### Bulk Transfer

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_all_params` | — | `{ data_b64: string }` | Complete DSP parameter snapshot, 2896 bytes, base64-encoded. |
| `set_all_params` | `{ data_b64: string }` | `"ok"` | Restore a full parameter snapshot (base64-encoded 2896-byte blob). |

### Diagnostics

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `get_peaks` | — | `{ raw: string }` | Shortcut for `get_status` with `wValue=9`. Returns 12-byte hex-encoded meter data (see [Server-Push Messages](#server-push-messages) for layout). |
| `get_status` | `{ wValue: int }` | `{ raw: string }` | Read a telemetry field. `wValue` selects the field (0–21). `wValue=9` returns 12 bytes (metering); others return 4 bytes. |
| `clear_clips` | — | `"ok"` | Clear all clip-detection flags. |
| `get_core1_mode` | — | `{ mode: int }` | Core 1 operating mode: 0=PDM, 1=EQ Worker, 2=Idle. |
| `get_core1_conflict` | — | *(not exposed as RPC method)* | Available at the USB level but not exposed through the bridge. |
| `get_buffer_stats` | — | `{ raw: string }` | 44-byte `BufferStatsPacket` hex string. Per-output buffer fill levels and statistics. |
| `reset_buffer_stats` | — | `"ok"` | Reset buffer statistics counters. |
| `get_usb_error_stats` | — | `{ raw: string }` | 24-byte `UsbErrorStatsPacket` hex string. 5 types of USB errors tracked. |
| `reset_usb_error_stats` | — | `"ok"` | Reset USB error counters. |

### System

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `save_params` | — | `"ok"` | Persist all current parameters to flash. |
| `load_params` | — | `"ok"` | Reload parameters from flash (discards unsaved changes). |
| `factory_reset` | — | `"ok"` | Reset all parameters and presets to factory defaults. |
| `enter_bootloader` | — | `"ok"` | Reboot the device into UF2 bootloader mode. The device disconnects immediately; the bridge also disconnects. |

## Composite Methods

Several getter methods aggregate multiple USB control transfers into a single RPC call for convenience:

| Method | Internal USB Calls | Fields Aggregated |
|--------|--------------------|-------------------|
| `get_info` | 2 | platform, serial |
| `get_loudness` | 3 | enabled, ref_spl, intensity |
| `get_crossfeed` | 5 | enabled, preset, freq, feed, itd |
| `get_leveller` | 6 | enabled, amount, speed, max_gain, lookahead, gate |
| `get_i2s_config` | 4 | bck_pin, mck_enabled, mck_pin, mck_multiplier |
| `get_eq_param` | 4 | type, freq, Q, gain (one per parameter sub-index) |

These are atomic at the RPC level but not at the USB level — the individual reads happen sequentially in the bridge's USB thread.

## Error Handling

All errors are returned in the standard JSON-RPC error format:

```json
{
  "id": 42,
  "error": { "message": "description of what went wrong" }
}
```

The bridge does not use numeric error codes — `error.message` is always a human-readable string.

Common error scenarios:

| Condition | Message |
|-----------|---------|
| No USB device connected | `"No device connected"` |
| Unknown method name | `"Unknown method: <method>"` |
| Missing or invalid params | Python exception message from the underlying call |
| USB transfer failure | `usb.core.USBError` message |
| Bridge internal error | The exception's `str()` representation |

The client-side SDK (`web/app/transport.js`) has a 5-second timeout per RPC call. If the bridge does not respond within that window, the pending promise is rejected with `"Timeout: <method>"`.

## Data Format Notes

- **Floats** are IEEE 754 single-precision, little-endian on the USB wire. The bridge converts to/from JSON numbers automatically.
- **dB values** are expressed as attenuation (0 = unity, negative = quieter). Master volume uses −128.0 dB as a mute sentinel; the usable range is −127..0 dB.
- **Booleans** are JSON `true`/`false` in RPC parameters and responses. On the USB wire they are single bytes (`0x00` / `0x01`).
- **Strings** (channel names, preset names) are ASCII, null-padded to 32 bytes on the device. Truncated to 31 characters maximum.
- **Raw binary fields** (metering, buffer stats, USB error stats, preset directory) are returned as lowercase hex-encoded strings in the `raw` response field.
- **Bulk data** (`get_all_params` / `set_all_params`) is base64-encoded in the `data_b64` field. The underlying blob is 2896 bytes.
- **Preset slots** are numbered 0–9 (10 slots total).
- **Filter types**: FLAT=0, PEAKING=1, LOW_SHELF=2, HIGH_SHELF=3, LOW_PASS=4, HIGH_PASS=5.
- **Output types**: S/PDIF=0, I²S=1.
- **Core 1 modes**: PDM=0, EQ Worker=1, Idle=2.
- **Volume modes**: volatile=0, persistent=1.
- **Pin config status**: SUCCESS=0, INVALID_PIN=1, CONFLICT=2.

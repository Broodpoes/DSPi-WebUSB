# Configuration Guide

## Overview

DSPi is configured entirely through USB vendor control commands sent to interface 2 (VID `0x2E8A`, PID `0xFEAA`). There are no config files, no serial consoles, and no on-device UI. Every parameter — EQ, routing, presets, pins — is set and queried over USB, either through individual vendor requests or through a single bulk transfer that captures the full device state.

Changes take effect immediately on the live DSP pipeline. To persist settings across power cycles, save them to a preset slot in flash.

For exact request codes, payload layouts, and response formats, see [api-reference.md](api-reference.md).

---

## Presets

DSPi stores up to **10 preset slots** (indices 0–9) in dedicated flash sectors. Each slot captures the complete DSP state: EQ bands, preamp, delays, loudness, crossfeed, matrix mixer routing, channel gains/mutes, output types, and optionally pin assignments.

### Slot Operations

| Operation | Request | Description |
|-----------|---------|-------------|
| Save | `REQ_PRESET_SAVE` (`0x90`) | Writes current live state to the given slot. Overwrites any previous contents. |
| Load | `REQ_PRESET_LOAD` (`0x91`) | Recalls a slot from flash into the live DSP state. Recalculates all filter coefficients, updates delay lines, and transitions output hardware if types changed. If the slot is empty, factory defaults are applied. |
| Delete | `REQ_PRESET_DELETE` (`0x92`) | Erases the slot's flash sector and clears its occupied bit. The active slot selection is unchanged — loading a deleted slot yields factory defaults. |
| Get active | `REQ_PRESET_GET_ACTIVE` (`0x9A`) | Returns the index of the currently active slot (0–9). |

Save, load, and delete are deferred to the main loop — they are acknowledged immediately but complete asynchronously. The host can poll `REQ_PRESET_GET_ACTIVE` to confirm that a load has finished.

### Naming

Each slot has a **32-byte ASCII name** (31 usable characters + NUL terminator).

- **Get name**: `REQ_PRESET_GET_NAME` (`0x93`) — returns 32 bytes.
- **Set name**: `REQ_PRESET_SET_NAME` (`0x94`) — accepts up to 31 bytes in the payload, NUL-padded to 32.

Names can be set before the slot is occupied (before first save).

### Startup Behavior

The device loads a preset automatically at boot. Two modes control which one:

| Mode | Constant | Behavior |
|------|----------|----------|
| 0 | `PRESET_STARTUP_SPECIFIED` | Always load the configured default slot. |
| 1 | `PRESET_STARTUP_LAST_ACTIVE` | Load whichever slot was last saved or loaded. |

- **Set startup**: `REQ_PRESET_SET_STARTUP` (`0x96`) — payload: `[mode, slot]`.
- **Get startup**: `REQ_PRESET_GET_STARTUP` (`0x97`) — returns 3 bytes: `[startup_mode, default_slot, last_active]`.

### Directory

`REQ_PRESET_GET_DIR` (`0x95`) returns a 7-byte directory summary:

| Byte | Field | Description |
|------|-------|-------------|
| 0–1 | `slot_occupied` | 16-bit little-endian bitmask. Bit N set = slot N has valid data. |
| 2 | `startup_mode` | 0 = specific slot, 1 = last active. |
| 3 | `default_slot` | Slot used in mode 0 (0–9). |
| 4 | `last_active` | Last slot that was loaded or saved (0–9). |
| 5 | `include_pins` | Whether preset load restores pin config (0 or 1). |
| 6 | `master_volume_mode` | Volume persistence mode (see [Master Volume](#master-volume)). |

### Pin Inclusion

By default, pin assignments are saved and restored with presets. This can be toggled:

- **Set**: `REQ_PRESET_SET_INCLUDE_PINS` (`0x98`) — payload: `1` to include pins, `0` to exclude.
- **Get**: `REQ_PRESET_GET_INCLUDE_PINS` (`0x99`) — returns current setting (0 or 1).

When disabled, preset load skips pin configuration, leaving the current GPIO assignments untouched. This is useful when different physical setups share the same DSP profile but use different GPIO routing.

---

## Audio Output Configuration

### Output Types

Each output slot can operate as either **S/PDIF** (`0`) or **I2S** (`1`). The number of available slots depends on the platform:

| Platform | Output Slots | Channel Count |
|----------|-------------|---------------|
| RP2040 | 2 | 7 (2 master + 4 S/PDIF + 1 PDM) |
| RP2350 | 4 | 11 (2 master + 8 S/PDIF + 1 PDM) |

- **Set type**: `REQ_SET_OUTPUT_TYPE` (`0xC0`) — `wValue = (type << 8) | slot_index`. Type switching is deferred to the main loop; the hardware is torn down and reconfigured safely.
- **Get type**: `REQ_GET_OUTPUT_TYPE` (`0xC1`) — `wValue = slot_index`, returns 1 byte (`0` or `1`).

All I2S slots share a single BCK/LRCLK pair. The first I2S slot in index order becomes the I2S clock master.

### Matrix Mixer Routing

The matrix mixer routes **2 input channels** (USB L/R) to **N output channels** (up to 9 on RP2350). Each crosspoint has:

- **Enable** — on/off for the routing path.
- **Gain** — float32 dB, applied to the crosspoint.
- **Phase invert** — flips polarity on the routing path.

Per-output channel controls:

| Control | Set Request | Get Request |
|---------|------------|-------------|
| Crosspoint route | `REQ_SET_MATRIX_ROUTE` (`0x70`) | `REQ_GET_MATRIX_ROUTE` (`0x71`) |
| Output enable | `REQ_SET_OUTPUT_ENABLE` (`0x72`) | `REQ_GET_OUTPUT_ENABLE` (`0x73`) |
| Output gain | `REQ_SET_OUTPUT_GAIN` (`0x74`) | `REQ_GET_OUTPUT_GAIN` (`0x75`) |
| Output mute | `REQ_SET_OUTPUT_MUTE` (`0x76`) | `REQ_GET_OUTPUT_MUTE` (`0x77`) |
| Output delay | `REQ_SET_OUTPUT_DELAY` (`0x78`) | `REQ_GET_OUTPUT_DELAY` (`0x79`) |

The maximum delay per channel is 4096 samples (≈85 ms at 48 kHz) on RP2350, or 2048 samples (≈42 ms) on RP2040.

### I2S Configuration

When any output slot is set to I2S mode, the shared I2S bus is configured as follows:

| Parameter | Default | Description |
|-----------|---------|-------------|
| BCK pin | GPIO 14 | Bit clock. LRCLK is always `BCK + 1` (GPIO 15 by default). |
| MCK pin | GPIO 13 | Master clock output (optional). |
| MCK enable | Off | Master clock generation on/off. |
| MCK multiplier | 128× | `128` or `256`. 256× is not supported at sample rates ≥ 96 kHz — the device automatically downgrades to 128×. |

Pin and MCK controls:

| Control | Set Request | Get Request |
|---------|------------|-------------|
| BCK pin | `REQ_SET_I2S_BCK_PIN` (`0xC2`) | `REQ_GET_I2S_BCK_PIN` (`0xC3`) |
| MCK enable | `REQ_SET_MCK_ENABLE` (`0xC4`) | `REQ_GET_MCK_ENABLE` (`0xC5`) |
| MCK pin | `REQ_SET_MCK_PIN` (`0xC6`) | `REQ_GET_MCK_PIN` (`0xC7`) |
| MCK multiplier | `REQ_SET_MCK_MULTIPLIER` (`0xC8`) | `REQ_GET_MCK_MULTIPLIER` (`0xC9`) |

MCK multiplier wire encoding: `0` = 128×, `1` = 256×.

---

## DSP Configuration

### Parametric EQ

Each input channel has up to **10 configurable bands** (the hardware supports up to 12 per channel). Each band has four parameters:

| Parameter | Index | Type | Description |
|-----------|-------|------|-------------|
| Type | 0 | uint32 | Filter type (see below) |
| Frequency | 1 | float32 | Center/cutoff frequency in Hz |
| Q | 2 | float32 | Quality factor |
| Gain | 3 | float32 | Gain in dB (not applicable to all types) |

**Filter types:**

| Value | Name | Description |
|-------|------|-------------|
| 0 | `FLAT` | Bypass — band has no effect |
| 1 | `PEAKING` | Peaking EQ |
| 2 | `LOW_SHELF` | Low shelf |
| 3 | `HIGH_SHELF` | High shelf |
| 4 | `LOW_PASS` | Low pass |
| 5 | `HIGH_PASS` | High pass |

- **Set band**: `REQ_SET_EQ_PARAM` (`0x42`) — 16-byte payload: `struct.pack('<BBBBffff', channel, band, type, 0, freq, Q, gain)`.
- **Get band**: `REQ_GET_EQ_PARAM` (`0x43`) — `wValue = (channel << 8) | (band << 4) | param_index`. Returns 4 bytes per parameter (0=type uint32, 1=freq float, 2=Q float, 3=gain float).

### Per-Channel Preamp

Independent gain control for left and right input channels, applied before the EQ stage.

- **Set**: `REQ_SET_PREAMP_CH` (`0xD0`) — `wValue = channel_index` (0=L, 1=R), payload = float32 dB.
- **Get**: `REQ_GET_PREAMP_CH` (`0xD1`) — `wValue = channel_index`, returns float32 dB.

### Bypass

The master EQ can be bypassed entirely:

- **Set**: `REQ_SET_BYPASS` (`0x46`) — payload: `1` to bypass, `0` to engage.
- **Get**: `REQ_GET_BYPASS` (`0x47`) — returns current bypass state.

### Crossfeed

Crossfeed simulates speaker listening by bleeding a filtered copy of each channel into the other. The implementation uses the BS2B (Bauer stereophonic-to-binaural) algorithm with optional interaural time delay (ITD).

**Presets:**

| Index | Name | Cutoff | Feed |
|-------|------|--------|------|
| 0 | Default | 700 Hz | 4.5 dB |
| 1 | Chu Moy | 700 Hz | 6.0 dB |
| 2 | Jan Meier | 650 Hz | 9.5 dB |
| 3 | Custom | User-defined | User-defined |

When preset is 3 (Custom), the `custom_fc` and `custom_feed_db` fields are used instead. Custom crossover range: 500–2000 Hz. Custom feed range: 0–15 dB.

| Control | Set Request | Get Request |
|---------|------------|-------------|
| Enable | `REQ_SET_CROSSFEED` (`0x5E`) | `REQ_GET_CROSSFEED` (`0x5F`) |
| Preset | `REQ_SET_CROSSFEED_PRESET` (`0x60`) | `REQ_GET_CROSSFEED_PRESET` (`0x61`) |
| Custom freq | `REQ_SET_CROSSFEED_FREQ` (`0x62`) | `REQ_GET_CROSSFEED_FREQ` (`0x63`) |
| Custom feed | `REQ_SET_CROSSFEED_FEED` (`0x64`) | `REQ_GET_CROSSFEED_FEED` (`0x65`) |
| ITD toggle | `REQ_SET_CROSSFEED_ITD` (`0x66`) | `REQ_GET_CROSSFEED_ITD` (`0x67`) |

### Loudness

Loudness compensation based on **ISO 226:2003** equal-loudness contours. Applies frequency-dependent gain to compensate for reduced perceived bass and treble at lower listening levels.

Parameters:
- **Enable** — on/off.
- **Reference SPL** — the calibrated SPL at which the audio was mastered (typically 85–105 dB). Lower current volume relative to this reference increases compensation.
- **Intensity** — scales the amount of compensation applied.

| Control | Set Request | Get Request |
|---------|------------|-------------|
| Enable | `REQ_SET_LOUDNESS` (`0x58`) | `REQ_GET_LOUDNESS` (`0x59`) |
| Reference SPL | `REQ_SET_LOUDNESS_REF` (`0x5A`) | `REQ_GET_LOUDNESS_REF` (`0x5B`) |
| Intensity | `REQ_SET_LOUDNESS_INTENSITY` (`0x5C`) | `REQ_GET_LOUDNESS_INTENSITY` (`0x5D`) |

### Volume Leveller

An RMS-based upward compressor that reduces dynamic range for consistent perceived loudness. Useful for late-night listening or noisy environments.

Parameters:

| Parameter | Description |
|-----------|-------------|
| Enable | On/off toggle |
| Amount | Compression intensity (0.0–1.0) |
| Speed | Preset: 0=Slow (music), 1=Medium (general), 2=Fast (speech) |
| Max gain | Maximum makeup gain in dB (safety limiter at 0 dBFS) |
| Lookahead | Predictive transient handling (on/off, ~10 ms) |
| Gate threshold | Silence gate to prevent noise-floor pumping (dB) |

| Control | Set Request | Get Request |
|---------|------------|-------------|
| Enable | `REQ_SET_LEVELLER_ENABLE` (`0xB4`) | `REQ_GET_LEVELLER_ENABLE` (`0xB5`) |
| Amount | `REQ_SET_LEVELLER_AMOUNT` (`0xB6`) | `REQ_GET_LEVELLER_AMOUNT` (`0xB7`) |
| Speed | `REQ_SET_LEVELLER_SPEED` (`0xB8`) | `REQ_GET_LEVELLER_SPEED` (`0xB9`) |
| Max gain | `REQ_SET_LEVELLER_MAX_GAIN` (`0xBA`) | `REQ_GET_LEVELLER_MAX_GAIN` (`0xBB`) |
| Lookahead | `REQ_SET_LEVELLER_LOOKAHEAD` (`0xBC`) | `REQ_GET_LEVELLER_LOOKAHEAD` (`0xBD`) |
| Gate | `REQ_SET_LEVELLER_GATE` (`0xBE`) | `REQ_GET_LEVELLER_GATE` (`0xBF`) |

---

## Master Volume

Master volume controls the overall output level as a single dB attenuation value applied to all channels.

**Range:**

| Value | Meaning |
|-------|---------|
| −128.0 | Mute sentinel (true mute, not just −128 dB) |
| −127.0 … 0.0 | Attenuation in dB. 0 = unity gain (full volume). |

The power-on default is **−20 dB**.

- **Set**: `REQ_SET_MASTER_VOLUME` (`0xD2`) — payload = float32 dB.
- **Get**: `REQ_GET_MASTER_VOLUME` (`0xD3`) — returns float32 dB.

### Persistence Modes

Two modes control how master volume interacts with presets:

| Mode | Constant | Behavior |
|------|----------|----------|
| 0 | `MASTER_VOLUME_MODE_INDEPENDENT` | Volume is independent of presets. Saved to the directory sector via `REQ_SAVE_MASTER_VOLUME` (`0xD6`). Applied at boot and on factory reset. Preset save/load does not touch it. |
| 1 | `MASTER_VOLUME_MODE_WITH_PRESET` | Volume is part of the preset. Saved/restored with each preset slot. |

- **Set mode**: `REQ_SET_MASTER_VOLUME_MODE` (`0xD4`) — payload = uint8 mode (0 or 1).
- **Get mode**: `REQ_GET_MASTER_VOLUME_MODE` (`0xD5`) — returns uint8 mode.
- **Save to directory**: `REQ_SAVE_MASTER_VOLUME` (`0xD6`) — stores current live volume to the directory sector (mode 0 only).
- **Get saved volume**: `REQ_GET_SAVED_MASTER_VOLUME` (`0xD7`) — returns the volume stored in the directory sector.

---

## Pin Configuration

### Default GPIO Assignments

| Function | RP2040 | RP2350 |
|----------|--------|--------|
| S/PDIF 1 | GPIO 6 | GPIO 6 |
| S/PDIF 2 | GPIO 7 | GPIO 7 |
| S/PDIF 3 | — | GPIO 8 |
| S/PDIF 4 | — | GPIO 9 |
| PDM Sub | GPIO 10 | GPIO 10 |
| I2S BCK | GPIO 14 | GPIO 14 |
| I2S LRCLK | GPIO 15 | GPIO 15 |
| I2S MCK | GPIO 13 | GPIO 13 |

### Runtime Reconfiguration

S/PDIF and PDM output pins can be reassigned at runtime:

- **Set pin**: `REQ_SET_OUTPUT_PIN` (`0x7C`) — `wValue = (new_pin << 8) | output_index`.
- **Get pin**: `REQ_GET_OUTPUT_PIN` (`0x7D`) — `wValue = output_index`, returns GPIO number.

Before changing a pin, the output is temporarily disabled, the GPIO is reassigned, and then the output is re-enabled. Pin changes are not permitted while an output is actively streaming.

### Pin Conflict Detection

The device validates pin assignments before applying them. Possible status codes:

| Code | Constant | Meaning |
|------|----------|---------|
| 0x00 | `PIN_CONFIG_SUCCESS` | Pin accepted. |
| 0x01 | `PIN_CONFIG_INVALID_PIN` | GPIO number out of range or otherwise unusable. |
| 0x02 | `PIN_CONFIG_PIN_IN_USE` | GPIO already assigned to another function (I2S BCK, LRCLK, MCK, or another output). |
| 0x03 | `PIN_CONFIG_INVALID_OUTPUT` | Output index out of range. |
| 0x04 | `PIN_CONFIG_OUTPUT_ACTIVE` | Cannot reconfigure pin while the output is running. |

---

## Bulk State Transfer

For host-side backup/restore, profile switching, or initial UI sync, the entire device state can be transferred in a single operation.

### Get All Parameters

`REQ_GET_ALL_PARAMS` (`0xA0`) returns a **2896-byte** (`WireBulkParams`) structure containing:

| Section | Size | Contents |
|---------|------|----------|
| Header | 16 B | Version, platform, channel/band counts |
| Global params | 16 B | Bypass, core1 mode, output counts |
| Crossfeed | 16 B | Enable, preset, ITD, custom freq/feed |
| Legacy channel gain/mute | 16 B | Per-channel gain and mute |
| Per-channel delays | 44 B | Delay in ms per output channel (up to 11) |
| Matrix crosspoints | Variable | 8 bytes each: input→output routing with gain and phase |
| Output channels | Variable | 12 bytes each: enable, gain, mute, delay |
| Pin config | 8 B | GPIO assignments per output |
| EQ bands | Variable | 16 bytes each: type, freq, Q, gain per band per channel |
| Channel names | 352 B | 32-byte names × 11 channels |
| I2S config | 16 B | Output types, BCK/MCK pins, MCK enable, multiplier |
| Leveller config | 16 B | Enable, amount, speed, max gain, lookahead, gate |
| Per-channel preamp | 16 B | Independent L/R gain |
| Master volume | 16 B | Volume dB, mode |

### Set All Parameters

`REQ_SET_ALL_PARAMS` (`0xA1`) accepts the same 2896-byte structure and applies it atomically. The device:

1. Parses and validates the payload.
2. Applies all parameters to the live DSP state.
3. Recalculates filter coefficients and delay lines.

After calling `set_all_params`, the host should trigger a filter recalculation (typically by re-sending the relevant EQ parameters, or by loading a preset).

### Use Cases

- **Backup/restore**: Read with `get_all_params`, store on host, restore later with `set_all_params`.
- **Profile switching**: Maintain multiple profiles on the host and swap between them without consuming preset slots.
- **UI initialization**: On connect, read full state once instead of issuing dozens of individual queries.
- **Factory reset + apply**: Reset the device, then push a known-good state.

---

For exact method signatures, request/response byte layouts, and code examples, see [api-reference.md](api-reference.md).

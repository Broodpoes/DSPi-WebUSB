# USB Protocol Reference

## Overview

DSPi exposes a vendor interface on USB interface 2 for out-of-band control of the DSP pipeline. All vendor commands use EP0 control transfers with the device's VID:PID `0x2E8A:0xFEAA`.

The vendor interface is independent of the UAC1 audio streaming path. Host software sends control transfers to configure EQ, matrix routing, presets, volume, I/O pin assignments, and query telemetry.

## Control Transfer Format

### IN (Device → Host)

| Field          | Value              |
|----------------|--------------------|
| bmRequestType  | `0xC1`             |
| bRequest       | Request code       |
| wValue         | Per-command param  |
| wIndex         | Interface 2        |
| wLength        | Response size      |

### OUT (Host → Device)

| Field          | Value              |
|----------------|--------------------|
| bmRequestType  | `0x41`             |
| bRequest       | Request code       |
| wValue         | Per-command param  |
| wIndex         | Interface 2        |
| wLength        | Payload size       |

`bmRequestType` breakdown:

- `0xC1` = `110 00001` — vendor type, interface recipient, device-to-host
- `0x41` = `010 00001` — vendor type, interface recipient, host-to-device

## Data Encoding

All multi-byte values are **little-endian** (native ARM).

| Type          | Size  | Notes                                              |
|---------------|-------|----------------------------------------------------|
| `uint8_t`     | 1 B   | Booleans encoded as 0/1                            |
| `uint16_t`    | 2 B   | Q15 peak metering, clip flags                      |
| `uint32_t`    | 4 B   | EQ type, telemetry counters                        |
| `float32`     | 4 B   | IEEE 754, gains/frequencies/Q values               |
| Name string   | 32 B  | NUL-padded ASCII, no more than 31 meaningful chars  |

## Complete Command Table

### EQ & Filters (0x42–0x49)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_EQ_PARAM          | `0x42` | OUT  | — (see packet)                     | 16 B | Set one EQ band parameter                    |
| REQ_GET_EQ_PARAM          | `0x43` | IN   | `(ch<<8)\|(band<<4)\|param`        | 4 B  | Get one EQ parameter                         |
| REQ_SET_PREAMP            | `0x44` | OUT  | —                                  | 4 B  | Legacy: set preamp all channels (float dB)   |
| REQ_GET_PREAMP            | `0x45` | IN   | —                                  | 4 B  | Legacy: get channel 0 preamp (float dB)      |
| REQ_SET_BYPASS            | `0x46` | OUT  | —                                  | 1 B  | Set EQ bypass (uint8: 0=off, 1=on)           |
| REQ_GET_BYPASS            | `0x47` | IN   | —                                  | 1 B  | Get EQ bypass state                          |
| REQ_SET_DELAY             | `0x48` | OUT  | channel index in low byte          | 4 B  | Set per-channel delay (float ms)             |
| REQ_GET_DELAY             | `0x49` | IN   | channel index in low byte          | 4 B  | Get per-channel delay (float ms)             |

### Status & Persistence (0x50–0x53)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_GET_STATUS            | `0x50` | IN   | telemetry index (0–22, 9=special)  | 4 B  | Get telemetry value (see status table)       |
| REQ_SAVE_PARAMS           | `0x51` | IN   | —                                  | 1 B  | Legacy: save all params to flash             |
| REQ_LOAD_PARAMS           | `0x52` | IN   | —                                  | 1 B  | Legacy: load params from flash               |
| REQ_FACTORY_RESET         | `0x53` | IN   | —                                  | 1 B  | Reset to factory defaults                    |

### Channel Control (0x54–0x57)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_CHANNEL_GAIN      | `0x54` | OUT  | channel index in low byte (0–2)    | 4 B  | Set channel gain (float dB)                  |
| REQ_GET_CHANNEL_GAIN      | `0x55` | IN   | channel index in low byte (0–2)    | 4 B  | Get channel gain (float dB)                  |
| REQ_SET_CHANNEL_MUTE      | `0x56` | OUT  | channel index in low byte (0–2)    | 1 B  | Set channel mute (uint8: 0/1)                |
| REQ_GET_CHANNEL_MUTE      | `0x57` | IN   | channel index in low byte (0–2)    | 1 B  | Get channel mute state                       |

### Loudness (0x58–0x5D)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_LOUDNESS          | `0x58` | OUT  | —                                  | 1 B  | Enable/disable loudness (uint8: 0/1)         |
| REQ_GET_LOUDNESS          | `0x59` | IN   | —                                  | 1 B  | Get loudness enabled state                   |
| REQ_SET_LOUDNESS_REF      | `0x5A` | OUT  | —                                  | 4 B  | Set reference SPL (float dB)                 |
| REQ_GET_LOUDNESS_REF      | `0x5B` | IN   | —                                  | 4 B  | Get reference SPL                            |
| REQ_SET_LOUDNESS_INTENSITY| `0x5C` | OUT  | —                                  | 4 B  | Set intensity percentage (float 0–100)       |
| REQ_GET_LOUDNESS_INTENSITY| `0x5D` | IN   | —                                  | 4 B  | Get intensity percentage                     |

### Crossfeed (0x5E–0x67)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_CROSSFEED         | `0x5E` | OUT  | —                                  | 1 B  | Enable/disable crossfeed (uint8: 0/1)        |
| REQ_GET_CROSSFEED         | `0x5F` | IN   | —                                  | 1 B  | Get crossfeed enabled state                  |
| REQ_SET_CROSSFEED_PRESET  | `0x60` | OUT  | —                                  | 1 B  | Set preset (uint8: 0–4, 4=custom)            |
| REQ_GET_CROSSFEED_PRESET  | `0x61` | IN   | —                                  | 1 B  | Get current preset                           |
| REQ_SET_CROSSFEED_FREQ    | `0x62` | OUT  | —                                  | 4 B  | Set custom crossover freq (float Hz, 500–2000)|
| REQ_GET_CROSSFEED_FREQ    | `0x63` | IN   | —                                  | 4 B  | Get custom crossover frequency               |
| REQ_SET_CROSSFEED_FEED    | `0x64` | OUT  | —                                  | 4 B  | Set custom feed level (float dB, 0–15)       |
| REQ_GET_CROSSFEED_FEED    | `0x65` | IN   | —                                  | 4 B  | Get custom feed level                        |
| REQ_SET_CROSSFEED_ITD     | `0x66` | OUT  | —                                  | 1 B  | Enable/disable ITD (uint8: 0/1)              |
| REQ_GET_CROSSFEED_ITD     | `0x67` | IN   | —                                  | 1 B  | Get ITD enabled state                        |

### Matrix Mixer (0x70–0x79)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_MATRIX_ROUTE      | `0x70` | OUT  | — (see packet)                     | 8 B  | Set matrix crosspoint route                  |
| REQ_GET_MATRIX_ROUTE      | `0x71` | IN   | `(output<<8)\|input`               | 8 B  | Get matrix crosspoint route                  |
| REQ_SET_OUTPUT_ENABLE     | `0x72` | OUT  | output index in low byte           | 1 B  | Enable/disable output (uint8: 0/1)           |
| REQ_GET_OUTPUT_ENABLE     | `0x73` | IN   | output index in low byte           | 1 B  | Get output enabled state                     |
| REQ_SET_OUTPUT_GAIN       | `0x74` | OUT  | output index in low byte           | 4 B  | Set output gain (float dB)                   |
| REQ_GET_OUTPUT_GAIN       | `0x75` | IN   | output index in low byte           | 4 B  | Get output gain                              |
| REQ_SET_OUTPUT_MUTE       | `0x76` | OUT  | output index in low byte           | 1 B  | Set output mute (uint8: 0/1)                 |
| REQ_GET_OUTPUT_MUTE       | `0x77` | IN   | output index in low byte           | 1 B  | Get output mute state                        |
| REQ_SET_OUTPUT_DELAY      | `0x78` | OUT  | output index in low byte           | 4 B  | Set output delay (float ms)                  |
| REQ_GET_OUTPUT_DELAY      | `0x79` | IN   | output index in low byte           | 4 B  | Get output delay                             |

### Core 1 (0x7A–0x7B)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_GET_CORE1_MODE        | `0x7A` | IN   | —                                  | 1 B  | Get Core 1 operating mode (0=PDM, 1=EQ, 2=Idle)|
| REQ_GET_CORE1_CONFLICT    | `0x7B` | IN   | proposed output index in low byte  | 1 B  | Check if enabling output conflicts with Core 1|

### Pin Config (0x7C–0x7D)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_OUTPUT_PIN        | `0x7C` | IN†  | `(new_pin<<8)\|output_index`       | 1 B  | Change output pin; returns status byte       |
| REQ_GET_OUTPUT_PIN        | `0x7D` | IN   | output index in low byte           | 1 B  | Get current output pin number                |

† `REQ_SET_OUTPUT_PIN` uses `bmRequestType` IN (`0xC1`) despite being a "set" operation — it validates and applies the change, then returns a status byte.

Pin config status codes:

| Code | Constant                  | Meaning                                |
|------|---------------------------|----------------------------------------|
| 0x00 | `PIN_CONFIG_SUCCESS`      | Pin changed successfully               |
| 0x01 | `PIN_CONFIG_INVALID_PIN`  | GPIO number out of valid range         |
| 0x02 | `PIN_CONFIG_PIN_IN_USE`   | Pin already used by another output     |
| 0x03 | `PIN_CONFIG_INVALID_OUTPUT`| Output index out of range             |
| 0x04 | `PIN_CONFIG_OUTPUT_ACTIVE`| Cannot change pin while output active  |

### Device ID (0x7E–0x7F)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_GET_SERIAL            | `0x7E` | IN   | —                                  | 16 B | Get device serial number (raw bytes)         |
| REQ_GET_PLATFORM          | `0x7F` | IN   | —                                  | 4 B  | Get platform info (see below)                |

`REQ_GET_PLATFORM` returns 4 bytes:

| Offset | Type     | Field           | Values                             |
|--------|----------|-----------------|------------------------------------|
| 0      | uint8    | platform        | 0=RP2040, 1=RP2350                 |
| 1      | uint8    | fw_major        | Major version                      |
| 2      | uint8    | fw_minor_patch  | BCD: high nibble=minor, low=patch  |
| 3      | uint8    | num_outputs     | Number of output channels          |

### Clip Detection (0x83)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_CLEAR_CLIPS           | `0x83` | IN   | —                                  | 2 B  | Read-then-clear clip flags; returns uint16    |

### Presets (0x90–0x9C)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_PRESET_SAVE           | `0x90` | IN   | slot (0–9)                         | 1 B  | Save current state to preset slot             |
| REQ_PRESET_LOAD           | `0x91` | IN   | slot (0–9)                         | 1 B  | Load preset from slot                         |
| REQ_PRESET_DELETE         | `0x92` | IN   | slot (0–9)                         | 1 B  | Delete preset slot                            |
| REQ_PRESET_GET_NAME       | `0x93` | IN   | slot (0–9)                         | 32 B | Get preset name (NUL-padded ASCII)            |
| REQ_PRESET_SET_NAME       | `0x94` | OUT  | slot in low byte                   | 32 B | Set preset name                               |
| REQ_PRESET_GET_DIR        | `0x95` | IN   | —                                  | 7 B  | Get preset directory summary                  |
| REQ_PRESET_SET_STARTUP    | `0x96` | OUT  | —                                  | 2 B  | Set startup mode+slot                         |
| REQ_PRESET_GET_STARTUP    | `0x97` | IN   | —                                  | 3 B  | Get startup config (mode, default, last)      |
| REQ_PRESET_SET_INCLUDE_PINS| `0x98`| OUT  | —                                  | 1 B  | Set include-pins flag for preset saves        |
| REQ_PRESET_GET_INCLUDE_PINS| `0x99`| IN   | —                                  | 1 B  | Get include-pins flag                         |
| REQ_PRESET_GET_ACTIVE     | `0x9A` | IN   | —                                  | 1 B  | Get currently active preset slot              |
| REQ_SET_CHANNEL_NAME      | `0x9B` | OUT  | channel index in low byte          | 32 B | Set channel display name                      |
| REQ_GET_CHANNEL_NAME      | `0x9C` | IN   | channel index in low byte          | 32 B | Get channel display name                      |

Preset operation responses return a status byte:

| Code | Constant                  | Meaning                                |
|------|---------------------------|----------------------------------------|
| 0x00 | `PRESET_OK`               | Accepted / completed                   |
| 0x01 | `PRESET_ERR_INVALID_SLOT` | Slot out of range (valid: 0–9)         |
| 0x02 | `PRESET_ERR_SLOT_EMPTY`   | Slot has no saved data                 |
| 0x03 | `PRESET_ERR_CRC`          | Flash data CRC mismatch               |
| 0x04 | `PRESET_ERR_FLASH_WRITE`  | Flash write failed                     |

**Preset directory** (`REQ_PRESET_GET_DIR`, 7 bytes):

| Offset | Type     | Field             | Description                          |
|--------|----------|-------------------|--------------------------------------|
| 0–1    | uint16 LE| slot_occupied     | Bitmask, bit N = slot N has data     |
| 2      | uint8    | startup_mode      | 0=specified slot, 1=last active      |
| 3      | uint8    | default_slot      | Configured default slot              |
| 4      | uint8    | last_active_slot  | Slot that was last loaded            |
| 5      | uint8    | include_pins      | Whether pin config is saved in presets|
| 6      | uint8    | master_volume_mode| 0=independent, 1=per-preset         |

### Bulk Transfer (0xA0–0xA1)

| Request                   | Code   | Dir  | wValue Encoding                    | Size     | Description                              |
|---------------------------|--------|------|------------------------------------|----------|------------------------------------------|
| REQ_GET_ALL_PARAMS        | `0xA0` | IN   | —                                  | 2896 B   | Get all parameters as WireBulkParams     |
| REQ_SET_ALL_PARAMS        | `0xA1` | OUT  | —                                  | 2896 B   | Set all parameters from WireBulkParams   |

### Buffer Stats (0xB0–0xB3)

| Request                   | Code   | Dir  | wValue Encoding                    | Size     | Description                              |
|---------------------------|--------|------|------------------------------------|----------|------------------------------------------|
| REQ_GET_BUFFER_STATS      | `0xB0` | IN   | —                                  | 44 B     | Get buffer fill statistics               |
| REQ_RESET_BUFFER_STATS    | `0xB1` | IN   | flags (bit 0 = reset watermarks)   | 1 B      | Reset buffer statistics watermarks       |
| REQ_GET_USB_ERROR_STATS   | `0xB2` | IN   | —                                  | 24 B     | Get USB error counters                   |
| REQ_RESET_USB_ERROR_STATS | `0xB3` | IN   | —                                  | 1 B      | Reset USB error counters                 |

**BufferStatsPacket** (44 bytes):

| Offset | Size | Field            | Description                                   |
|--------|------|------------------|-----------------------------------------------|
| 0      | 1    | num_spdif        | Number of S/PDIF instances (2 or 4)           |
| 1      | 1    | flags            | Bit 0: PDM active, Bit 1: audio streaming     |
| 2–3    | 2    | sequence         | Monotonic counter (wraps at 65535)            |
| 4–35   | 32   | spdif[4]         | 4 × SpdifBufferStats (8 B each, unused zeroed)|
| 36–43  | 8    | pdm              | PdmBufferStats                                |

SpdifBufferStats (8 bytes): `consumer_free`, `consumer_prepared`, `consumer_playing`, `consumer_fill_pct`, `consumer_min_fill_pct`, `consumer_max_fill_pct`, 2 bytes padding.

PdmBufferStats (8 bytes): `dma_fill_pct`, `dma_min_fill_pct`, `dma_max_fill_pct`, `ring_fill_pct`, `ring_min_fill_pct`, `ring_max_fill_pct`, 2 bytes padding.

**UsbErrorStatsPacket** (24 bytes):

| Offset | Size | Field         | Description                          |
|--------|------|---------------|--------------------------------------|
| 0–3    | 4    | total         | Total USB errors                     |
| 4–7    | 4    | crc           | CRC errors                           |
| 8–11   | 4    | bitstuff      | Bit-stuffing errors                  |
| 12–15  | 4    | rx_overflow   | Receive overflows                    |
| 16–19  | 4    | rx_timeout    | Receive timeouts                     |
| 20–23  | 4    | data_seq      | Data sequence errors                 |

### Volume Leveller (0xB4–0xBF)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_LEVELLER_ENABLE   | `0xB4` | OUT  | —                                  | 1 B  | Enable/disable leveller (uint8: 0/1)         |
| REQ_GET_LEVELLER_ENABLE   | `0xB5` | IN   | —                                  | 1 B  | Get leveller enabled state                   |
| REQ_SET_LEVELLER_AMOUNT   | `0xB6` | OUT  | —                                  | 4 B  | Set leveller amount (float)                  |
| REQ_GET_LEVELLER_AMOUNT   | `0xB7` | IN   | —                                  | 4 B  | Get leveller amount                          |
| REQ_SET_LEVELLER_SPEED    | `0xB8` | OUT  | —                                  | 1 B  | Set leveller speed (uint8)                   |
| REQ_GET_LEVELLER_SPEED    | `0xB9` | IN   | —                                  | 1 B  | Get leveller speed                           |
| REQ_SET_LEVELLER_MAX_GAIN | `0xBA` | OUT  | —                                  | 4 B  | Set max gain (float dB)                      |
| REQ_GET_LEVELLER_MAX_GAIN | `0xBB` | IN   | —                                  | 4 B  | Get max gain                                 |
| REQ_SET_LEVELLER_LOOKAHEAD| `0xBC` | OUT  | —                                  | 1 B  | Enable/disable lookahead (uint8: 0/1)        |
| REQ_GET_LEVELLER_LOOKAHEAD| `0xBD` | IN   | —                                  | 1 B  | Get lookahead enabled state                  |
| REQ_SET_LEVELLER_GATE     | `0xBE` | OUT  | —                                  | 4 B  | Set gate threshold (float dB)                |
| REQ_GET_LEVELLER_GATE     | `0xBF` | IN   | —                                  | 4 B  | Get gate threshold                           |

### I2S Config (0xC0–0xC9)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_OUTPUT_TYPE       | `0xC0` | IN†  | `(new_type<<8)\|slot_index`        | 1 B  | Set output type per slot (0=S/PDIF, 1=I2S)   |
| REQ_GET_OUTPUT_TYPE       | `0xC1` | IN   | slot index in low byte             | 1 B  | Get output type                              |
| REQ_SET_I2S_BCK_PIN       | `0xC2` | IN†  | new BCK pin in wValue              | 1 B  | Set I2S BCK pin (LRCLK = BCK+1)              |
| REQ_GET_I2S_BCK_PIN       | `0xC3` | IN   | —                                  | 1 B  | Get I2S BCK pin                              |
| REQ_SET_MCK_ENABLE        | `0xC4` | IN†  | 0=disable, nonzero=enable          | 1 B  | Enable/disable master clock output            |
| REQ_GET_MCK_ENABLE        | `0xC5` | IN   | —                                  | 1 B  | Get MCK enabled state                        |
| REQ_SET_MCK_PIN           | `0xC6` | IN†  | new MCK pin in wValue              | 1 B  | Set MCK output pin                           |
| REQ_GET_MCK_PIN           | `0xC7` | IN   | —                                  | 1 B  | Get MCK pin                                  |
| REQ_SET_MCK_MULTIPLIER    | `0xC8` | IN†  | 0=128×, 1=256×                     | 1 B  | Set MCK frequency multiplier                 |
| REQ_GET_MCK_MULTIPLIER    | `0xC9` | IN   | —                                  | 1 B  | Get MCK multiplier (encoded: 0 or 1)         |

† These "set" commands use `bmRequestType` IN (`0xC1`) — they apply the change and return a pin config status byte.

Output type identifiers: `0` = S/PDIF, `1` = I2S.

### Per-Channel Preamp (0xD0–0xD1)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_PREAMP_CH         | `0xD0` | OUT  | channel index in low byte          | 4 B  | Set per-channel preamp (float dB)            |
| REQ_GET_PREAMP_CH         | `0xD1` | IN   | channel index in low byte          | 4 B  | Get per-channel preamp (float dB)            |

### Master Volume (0xD2–0xD7)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_SET_MASTER_VOLUME     | `0xD2` | OUT  | —                                  | 4 B  | Set master volume (float dB)                 |
| REQ_GET_MASTER_VOLUME     | `0xD3` | IN   | —                                  | 4 B  | Get live master volume (float dB)            |
| REQ_SET_MASTER_VOLUME_MODE| `0xD4` | OUT  | —                                  | 1 B  | Set persistence mode (0=independent, 1=per-preset)|
| REQ_GET_MASTER_VOLUME_MODE| `0xD5` | IN   | —                                  | 1 B  | Get persistence mode                         |
| REQ_SAVE_MASTER_VOLUME    | `0xD6` | IN   | —                                  | 1 B  | Persist live volume to directory sector       |
| REQ_GET_SAVED_MASTER_VOLUME| `0xD7`| IN   | —                                  | 4 B  | Get directory's independent saved volume     |

Master volume range:

| Value (float dB) | Meaning                          |
|-------------------|----------------------------------|
| -128.0            | Mute sentinel (true silence)     |
| -127.0 .. 0.0     | Attenuation range (0 = unity)    |

Persistence modes:

| Mode | Constant                      | Behavior                                      |
|------|-------------------------------|------------------------------------------------|
| 0    | `MASTER_VOLUME_MODE_INDEPENDENT` | Volume independent of presets; stored in directory |
| 1    | `MASTER_VOLUME_MODE_WITH_PRESET` | Volume saved/restored with each preset          |

### System (0xF0)

| Request                   | Code   | Dir  | wValue Encoding                    | Size | Description                                  |
|---------------------------|--------|------|------------------------------------|------|----------------------------------------------|
| REQ_ENTER_BOOTLOADER      | `0xF0` | IN   | —                                  | 1 B  | Enter USB bootloader (device reboots)        |

## Special Encodings

### EQ Parameter Access

**GET** (`REQ_GET_EQ_PARAM`, `0x43`):

```
wValue = (channel << 8) | (band << 4) | param
```

- `channel`: 0–6 (RP2040) or 0–10 (RP2350)
- `band`: 0–11 (up to MAX_BANDS=12 per channel)
- `param`:

| Param | Type     | Response                         |
|-------|----------|----------------------------------|
| 0     | uint32   | Filter type (see filter types)   |
| 1     | float32  | Center frequency (Hz)            |
| 2     | float32  | Q factor                         |
| 3     | float32  | Gain (dB)                        |

**SET** (`REQ_SET_EQ_PARAM`, `0x42`):

16-byte packed payload:

```
struct EqParamPacket {     // 16 bytes, packed
    uint8_t channel;       // Channel index
    uint8_t band;          // Band index
    uint8_t type;          // Filter type
    uint8_t reserved;      // Must be 0
    float    freq;         // Center frequency (Hz)
    float    Q;            // Q factor
    float    gain_db;      // Gain (dB)
};
```

Python encoding: `struct.pack('<BBBBffff', ch, band, type, 0, freq, Q, gain)`

Filter types:

| Value | Constant           | Description          |
|-------|--------------------|----------------------|
| 0     | `FILTER_FLAT`      | Bypass (flat)        |
| 1     | `FILTER_PEAKING`   | Peaking EQ           |
| 2     | `FILTER_LOWSHELF`  | Low shelf            |
| 3     | `FILTER_HIGHSHELF` | High shelf           |
| 4     | `FILTER_LOWPASS`   | Low pass             |
| 5     | `FILTER_HIGHPASS`  | High pass            |

### Matrix Mixer Route

**GET** (`REQ_GET_MATRIX_ROUTE`, `0x71`):

```
wValue = (output << 8) | input
```

Returns 8-byte `MatrixRoutePacket`:

```
struct MatrixRoutePacket {    // 8 bytes, packed
    uint8_t input;            // 0–1 (USB L/R)
    uint8_t output;           // 0–8 (output channel)
    uint8_t enabled;          // 0 or 1
    uint8_t phase_invert;     // 0 or 1
    float    gain_db;         // Gain in dB
};
```

**SET** (`REQ_SET_MATRIX_ROUTE`, `0x70`):

Same 8-byte `MatrixRoutePacket` sent as payload.

Python encoding: `struct.pack('<BBBBf', in_ch, out_ch, enabled, phase, gain)`

### Preset Names

Preset and channel names are 32-byte buffers. The string is NUL-terminated ASCII, padded with NUL bytes to 32 bytes total. The maximum meaningful string length is 31 characters.

### Status Telemetry

`REQ_GET_STATUS` (`0x50`) with `wValue` selecting the telemetry index:

**Special: `wValue` = 9** — Combined metering packet:

Returns `(NUM_CHANNELS × 2) + 4` bytes:
- `NUM_CHANNELS × 2` bytes: Q15 peak levels per channel (little-endian uint16 each)
- 1 byte: CPU0 load (0–255, mapped to 0–100%)
- 1 byte: CPU1 load (0–255, mapped to 0–100%)
- 2 bytes: Clip flags (uint16 bitmask, one bit per channel)

Size is platform-dependent: 18 bytes on RP2040 (7 channels), 26 bytes on RP2350 (11 channels).

**`wValue` 0–22** — Individual telemetry (each returns 4 bytes, uint32):

| wValue | Content                                  |
|--------|------------------------------------------|
| 0      | Peaks[0]\|Peaks[1] packed in uint32       |
| 1      | Peaks[2]\|Peaks[3] packed in uint32       |
| 2      | Peaks[4]\|CPU0_load\|CPU1_load packed     |
| 3      | PDM ring overrun count                   |
| 4      | PDM ring underrun count                  |
| 5      | PDM DMA overrun count                    |
| 6      | PDM DMA underrun count                   |
| 7      | S/PDIF overrun count                     |
| 8      | S/PDIF underrun count                    |
| 9      | (Special — see combined metering above)  |
| 10     | USB audio packet count                   |
| 11     | USB audio alt-setting                    |
| 12     | USB audio mounted state                  |
| 13     | System clock frequency (Hz)              |
| 14     | Core voltage (mV)                        |
| 15     | Current sample rate (Hz)                 |
| 16     | Die temperature (centi-degrees C)        |
| 17     | Total S/PDIF DMA starvation count        |
| 18     | S/PDIF instance 0 DMA starvations        |
| 19     | S/PDIF instance 1 DMA starvations        |
| 20     | S/PDIF instance 2 DMA starvations        |
| 21     | S/PDIF instance 3 DMA starvations        |
| 22     | USB audio ring overrun count             |

## Bulk Parameter Transfer

### Wire Format (V6, 2896 bytes)

The bulk transfer provides a snapshot of all DSP parameters in a single operation. This is used for state sync, backup/restore, and firmware-agnostic configuration.

```
WireBulkParams layout (2896 bytes):
  Offset   Size    Section
  ───────  ──────  ─────────────────────────
  0        16      Header (version, platform, channel counts)
  16       16      Global params (bypass, loudness, crossfeed enable)
  32       16      Crossfeed params
  48       16      Legacy channel gain/mute
  64       44      Per-channel delays (11 × float)
  108      144     Matrix crosspoints (18 × 8 bytes)
  252      108     Matrix output channels (9 × 12 bytes)
  360      8       Pin configuration
  368      2112    EQ band parameters (132 × 16 bytes = 11ch × 12bands)
  2480     352     Channel names (11 × 32 bytes)
  2832     16      I2S configuration
  2848     16      Volume leveller configuration
  2864     16      Per-channel preamp (11 × float, but 16 bytes)
  2880     16      Master volume
```

Wire header (16 bytes):

| Offset | Type     | Field           |
|--------|----------|-----------------|
| 0      | uint32   | magic (`0x44535069`) |
| 4      | uint32   | format_version (6)  |
| 8      | uint8    | platform (0/1)      |
| 9      | uint8    | num_channels        |
| 10     | uint8    | num_output_channels |
| 11     | uint8    | num_input_channels  |
| 12     | uint16   | max_bands           |
| 14     | uint16   | reserved            |

### Multi-Packet Transport

Bulk transfers exceed the standard 64-byte control transfer limit. They use a multi-packet stream transfer:

**GET** (`REQ_GET_ALL_PARAMS`):
1. Host sends control IN with `wLength >= 2896`
2. Device responds with 2896 bytes across multiple 64-byte IN packets
3. If the total length is a multiple of 64, a zero-length packet (ZLP) terminates the transfer
4. Host sends status-stage OUT ZLP

**SET** (`REQ_SET_ALL_PARAMS`):
1. Host sends control OUT with `wLength = 2896` and the payload
2. Device receives across multiple 64-byte OUT packets
3. Device sends status-stage IN ZLP
4. Parameters are applied in the main loop after the transfer completes

The internal buffer is 4096 bytes (`WIRE_BULK_BUF_SIZE`), aligned to 4 bytes. The host must send exactly `sizeof(WireBulkParams)` = 2896 bytes — the firmware rejects SET transfers with mismatched `wLength`.

## Important Notes

### Response Size and wLength

The firmware does **not** clamp responses to the host's `wLength`. For small responses (≤64 bytes), the full response is sent regardless of `wLength`. The host must request at least the actual response size to avoid truncation. For the bulk GET, the firmware does truncate to `min(wLength, sizeof(WireBulkParams))`.

### Platform Returns 4 Bytes

`REQ_GET_PLATFORM` (`0x7F`) returns **4 bytes**, not 1. A host requesting only 1 byte will get an incomplete response. Always request `wLength >= 4`.

### Deferred Operations

Several commands are deferred from the USB ISR to the main loop to avoid blocking interrupts for extended periods (~45ms flash writes). These include:

- `REQ_SAVE_PARAMS` — legacy flash save
- `REQ_FACTORY_RESET` — full reset and flash erase
- `REQ_PRESET_SAVE` / `REQ_PRESET_LOAD` / `REQ_PRESET_DELETE`
- `REQ_SAVE_MASTER_VOLUME`
- `REQ_SET_OUTPUT_TYPE` — requires heap allocation

Deferred commands return a status byte immediately (usually `PRESET_OK`), but the actual operation completes asynchronously. The host can poll `REQ_PRESET_GET_ACTIVE` to confirm preset load completion.

### "SET via IN" Pattern

Several configuration commands use `bmRequestType` IN (`0xC1`) despite modifying state:

- `REQ_SET_OUTPUT_PIN` (`0x7C`)
- `REQ_SET_OUTPUT_TYPE` (`0xC0`)
- `REQ_SET_I2S_BCK_PIN` (`0xC2`)
- `REQ_SET_MCK_ENABLE` (`0xC4`)
- `REQ_SET_MCK_PIN` (`0xC6`)
- `REQ_SET_MCK_MULTIPLIER` (`0xC8`)
- `REQ_SAVE_PARAMS` (`0x51`)
- `REQ_LOAD_PARAMS` (`0x52`)
- `REQ_FACTORY_RESET` (`0x53`)
- `REQ_SAVE_MASTER_VOLUME` (`0xD6`)
- `REQ_PRESET_SAVE` / `LOAD` / `DELETE` (`0x90`–`0x92`)
- `REQ_ENTER_BOOTLOADER` (`0xF0`)

These encode the "parameter" in `wValue` and return a status byte as the response payload. The host sends an IN transfer; the firmware applies the change and returns the result.

### Channel Indexing

| Index | RP2040        | RP2350         |
|-------|---------------|----------------|
| 0     | USB L (master) | USB L (master) |
| 1     | USB R (master) | USB R (master) |
| 2     | S/PDIF 1 L    | S/PDIF 1 L     |
| 3     | S/PDIF 1 R    | S/PDIF 1 R     |
| 4     | S/PDIF 2 L    | S/PDIF 2 L     |
| 5     | S/PDIF 2 R    | S/PDIF 2 R     |
| 6     | PDM sub       | S/PDIF 3 L     |
| 7     | —             | S/PDIF 3 R     |
| 8     | —             | S/PDIF 4 L     |
| 9     | —             | S/PDIF 4 R     |
| 10    | —             | PDM sub         |

RP2040: 7 channels (NUM_CHANNELS=7), 5 output channels.
RP2350: 11 channels (NUM_CHANNELS=11), 9 output channels.

### Core 1 Modes

| Value | Constant             | Description                       |
|-------|----------------------|-----------------------------------|
| 0     | `CORE1_MODE_PDM`     | PDM subwoofer output generation   |
| 1     | `CORE1_MODE_EQ`      | EQ worker for S/PDIF pairs 2–4    |
| 2     | `CORE1_MODE_IDLE`    | Core 1 idle                       |

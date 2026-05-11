# Troubleshooting

This guide covers common issues building, flashing, connecting to, and operating the DSPi firmware and host software.

---

## Firmware Build Issues

### Missing pico-sdk or pico-extras

**Symptom:** CMake fails with `Could not find PICO_SDK_PATH` or missing headers.

**Fix:** The SDK and extras are git submodules. Initialize them from the repository root:

```bash
cd firmware
git submodule update --init --recursive
```

If you prefer to use a system-installed SDK, set the environment variable:

```bash
export PICO_SDK_PATH=/path/to/pico-sdk
```

The `pico-extras` path is hardcoded to the local submodule in `firmware/CMakeLists.txt` and does not need manual configuration.

### arm-none-eabi-gcc not found

**Symptom:** `The C compiler identification is unknown` or `arm-none-eabi-gcc: command not found`.

**Fix:** Install the ARM bare-metal toolchain:

| OS | Command |
|----|---------|
| Arch Linux | `pacman -S arm-none-eabi-gcc` |
| Ubuntu/Debian | `sudo apt install gcc-arm-none-eabi` |
| macOS (Homebrew) | `brew install --cask gcc-arm-embedded` |
| Fedora | `sudo dnf install arm-none-eabi-gcc-cs` |

Verify with `arm-none-eabi-gcc --version`.

### CMake version too old

**Symptom:** CMake error at `cmake_minimum_required`.

**Fix:** DSPi requires **CMake ≥ 3.12** (set in `firmware/CMakeLists.txt`). Check your version:

```bash
cmake --version
```

Upgrade via your package manager or [download CMake](https://cmake.org/download/) directly.

### PICO_FLASH_SPI_CLKDIV warnings

**Symptom:** You see `PICO_FLASH_SPI_CLKDIV` mentioned in the build output or are concerned about flash clock divider warnings.

**Explanation:** This is intentional. The top-level `firmware/CMakeLists.txt` sets `PICO_FLASH_SPI_CLKDIV=6` before `pico_sdk_init()`. This is required because DSPi runs the system clock at 307.2 MHz — the default divider of 2 would produce a 153.6 MHz flash clock, exceeding the W25Q080 flash chip's 104–133 MHz rating. Divider 6 yields 51.2 MHz, safely within spec. This setting propagates to the boot2 build and must be set before SDK initialization.

> **Note:** On RP2350, the boot ROM's XIP setup uses its own divider. The firmware overrides this at runtime via QMI registers in `flash_clkdiv.c`.

---

## Flashing Issues

### Entering BOOTSEL mode

Hold the **BOOTSEL** button on the Pico board while plugging it into USB. Release the button after the `RPI-RP2` mass-storage drive appears on your computer.

Alternatively, if the firmware is already running and the USB connection is active, you can use the vendor command to reboot into the bootloader:

```python
# Via Python (usb_protocol.py)
from usb_protocol import DSPiDevice
dev = DSPiDevice.open_first()
dev.enter_bootloader()
```

This sends `REQ_ENTER_BOOTLOADER` (0xF0), the device acknowledges, then reboots into BOOTSEL mode after a 100 ms delay.

### UF2 file not copying to the drive

- **Check the drive has enough space.** The virtual FAT16 volume is large enough, but very old OS versions or unusual filesystem drivers may interfere.
- **Try a different USB cable.** Some charge-only cables do not pass data. Use a known-good data cable.
- **Try a different USB port.** USB 3.0 ports are preferred; some USB hubs have compatibility issues with the RP2040 BOOTSEL mass-storage mode.

### Device not enumerating after flash

After copying the `.uf2` file, the Pico should automatically reboot and enumerate as a USB audio device ("Weeb Labs DSPi"). If it does not:

- **Check the UF2 file size.** A valid DSPi firmware image is typically **170–185 KB**. A much smaller file may indicate a failed build or a corrupted download.
- **Verify the build target.** Ensure you built for the correct board: `pico` for RP2040 or `pico2` for RP2350.
- **Re-enter BOOTSEL** and reflash. The BOOTSEL bootloader is in masked ROM and is never overwritten.

---

## USB Connection Issues

### Device not visible to lsusb

```bash
lsusb | grep -i "2e8a\|feaa"
```

Expected output:
```
Bus XXX Device XXX: ID 2e8a:feaa Raspberry Pi DSPi
```

If nothing appears:

- Try a different USB cable and port.
- Check `dmesg` for USB errors:
  ```bash
  dmesg | tail -30
  ```
  Look for messages like `device not accepting address`, `unable to enumerate`, or `reset high-speed USB device`.

### Bridge cannot claim interface (Permission denied)

The DSPi vendor interface (interface 2) requires write access to the USB device. By default, only root can send control transfers to arbitrary USB devices.

**Recommended fix — udev rule:**

Create `/etc/udev/rules.d/99-dspi.rules`:

```
# DSPi USB Audio Processor
SUBSYSTEM=="usb", ATTR{idVendor}=="2e8a", ATTR{idProduct}=="feaa", MODE="0666"
```

Then reload udev and trigger:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Unplug and replug the device (or run `sudo udevadm trigger` with it connected). You should now be able to run the bridge without root.

**Quick test without udev:** Run the bridge as root (`sudo python bridge.py`). This works but is not recommended for regular use.

### Bridge connects then immediately disconnects

This typically means:

1. **Another process has the device open.** Only one application can claim the vendor interface at a time. Close any other DSPi control software, `picotool`, or `usb.core.find()` scripts.

2. **A kernel driver auto-bound the interface.** The bridge attempts `detach_kernel_driver()` automatically, but if the kernel audio driver holds the audio interface (not the vendor interface), this is normal and not the problem. Check `lsusb -v -d 2e8a:feaa` to see which interfaces have kernel drivers attached.

3. **USB permissions changed mid-session.** If you installed or modified a udev rule while the bridge was running, restart the bridge.

### "No device found" error

The bridge scans for USB devices with VID `0x2E8A` and PID `0xFEAA`. If you get "No device found":

- Confirm the device is plugged in and `lsusb` shows it.
- Check that no other application (another bridge instance, a Python REPL, `picotool info`) has the device claimed.
- On Linux, verify the udev rule is active and you have permissions: `ls -la /dev/bus/usb/<bus>/<dev>`.
- If the device just flashed, wait a few seconds for USB enumeration.

---

## Bridge Issues

### 403 Forbidden on root URL

Early bridge versions did not serve static files at the root path. Current versions serve the web app at `/` (index.html) and static assets under `/s/`. If you see a 403, update to the latest bridge code.

### WebSocket connection refused

- Ensure the bridge is running: `python bridge.py`. By default it listens on port **8765**.
- Check the WebSocket URL: `ws://localhost:8765/ws`.
- If the bridge is on a remote machine, ensure the port is open in the firewall and use the machine's IP instead of `localhost`.

### Commands return errors mid-session

If a command returns an error like `"No device connected"` or a USB error:

- The device may have been unplugged or rebooted.
- Call `POST /api/connect` to re-establish the connection. If the device is physically present, the bridge will find and claim it again.
- If the device was put into BOOTSEL mode via `enter_bootloader`, it needs to be reflashed before the bridge can reconnect.

### Metering not updating

Metering data (peaks, clip flags, CPU load) is pushed to WebSocket clients at approximately 10 Hz. If meters are not updating:

- **A WebSocket client must be connected.** The `_meter_loop` only runs when at least one WebSocket client is in `_ws_clients`. The loop starts when the first client connects and stops when the last one disconnects.
- Check the browser's developer console for WebSocket errors.
- Verify the bridge logs show `"WebSocket client connected"`.
- The bridge must have an active device connection (`POST /api/connect` returned `{"connected": true}`).

---

## Web App Issues

### WebUSB button greyed out

WebUSB is only available in **Chromium-based browsers** (Chrome, Edge). It requires:

- **HTTPS or localhost.** WebUSB does not work on `http://` with a non-local hostname. Use `http://localhost:8765` or serve over HTTPS.
- **Firmware with WebUSB descriptors.** The DSPi firmware includes WebUSB/WCID descriptors in its USB configuration, enabling the browser to discover and connect to the vendor interface directly.

If the button is still greyed out on Chrome over localhost, check:

1. Open `chrome://usb-internals/` and verify the device appears.
2. Check the browser console for WebUSB permission errors.
3. On Linux, the same udev rule from [USB Connection Issues](#usb-connection-issues) applies — the browser needs permission to access the device.

### EQ curve not showing

The EQ display uses an HTML Canvas element. If the curve is blank:

- Open the browser developer console (F12) for JavaScript errors.
- Ensure the browser supports `<canvas>` (all modern browsers do).
- Verify that EQ parameters are being returned correctly. Use the browser's Network tab to inspect WebSocket responses for `get_eq_param` calls.

### Meters stuck at zero

Peak meters show the maximum sample amplitude per channel. They read zero when:

- **No audio is playing.** Play audio through the DSPi (select it as the output device in your OS).
- **The input is silent.** The peaks reflect what the DSP is receiving from USB — if the source is muted or paused, peaks will be zero.
- **Metering polling is not running.** See [Metering not updating](#metering-not-updating).

---

## Audio Issues

### No audio output

Check these in order:

1. **Output enabled.** Each output channel has an enable flag. Verify the target output is enabled (`REQ_GET_OUTPUT_ENABLE`, or via the web app).
2. **Output type matches wiring.** S/PDIF outputs (type 0) and I2S outputs (type 1) have different pin and hardware requirements. Verify the output type matches your physical connection.
3. **Master volume is not muted.** Master volume of **−128 dB** is the mute sentinel. Set it to 0 dB for full volume.
4. **Output gain is not at −inf.** Check per-output gain in the matrix mixer.
5. **Matrix mixer routing.** At least one crosspoint must be enabled from an input (USB L or R) to the target output, with gain > 0 dB.
6. **Channel not muted.** Both per-channel mute and output mute must be off.
7. **OS audio routing.** Confirm your OS is sending audio to the DSPi device (check sound settings).

### Distorted audio

- **Preamp levels too high.** Per-channel input preamp adds gain before the EQ stage. If the preamp is set high and EQ bands add further boost, the signal can clip. Reduce preamp or EQ gains.
- **EQ gains.** Individual EQ band gains range from −inf to +12 dB. Multiple boosted bands accumulate.
- **Leveller settings.** The volume leveller is an RMS upward compressor. If `max_gain` is set very high and `amount` is aggressive, it can push quiet content to extreme levels. Check leveller enable and parameters.
- **Master volume at extreme attenuation.** If the leveller is compensating for very low master volume, the result may sound unnatural rather than truly distorted — set master volume to 0 dB and adjust from there.

### Wrong sample rate

The DSPi is a USB Audio Class 1 (UAC1) device supporting **44.1 kHz, 48 kHz, and 96 kHz**. The sample rate is set by the host OS:

- **Linux (PipeWire/PulseAudio):** Use `pavucontrol` or `wpctl` to set the DSPi's sample rate.
- **macOS:** Audio MIDI Setup → select DSPi → configure sample rate.
- **Windows:** Sound settings → Properties → Advanced → select sample rate.

The firmware adapts its internal clock dividers to the host-selected rate automatically.

---

## Diagnostic Commands

These vendor commands are useful for diagnosing issues. All use `bmRequestType = 0xC1` (device-to-host), `bRequest` as shown, `wIndex = 2` (vendor interface).

### get_status — General Telemetry

**Request:** `REQ_GET_STATUS` (0x50)

The `wValue` field selects the telemetry type:

| wValue | Data | Size | Description |
|--------|------|------|-------------|
| 0 | Peaks 0–1 | 4 B | Two Q15 peak values (channels 0 & 1) |
| 1 | Peaks 2–3 | 4 B | Two Q15 peak values (channels 2 & 3) |
| 2 | Peak 4 + CPU loads | 4 B | Peak 4 (Q15), CPU0 load (byte 2), CPU1 load (byte 3) |
| 3 | PDM ring overruns | 4 B | uint32 count |
| 4 | PDM ring underruns | 4 B | uint32 count |
| 5 | PDM DMA overruns | 4 B | uint32 count |
| 6 | PDM DMA underruns | 4 B | uint32 count |
| 7 | S/PDIF overruns | 4 B | uint32 count |
| 8 | S/PDIF underruns | 4 B | uint32 count |
| **9** | **Combined metering** | 12–26 B | All peaks (Q15) + CPU0 load + CPU1 load + clip flags |
| 10 | USB audio packets | 4 B | uint32 total received |
| 11 | USB alt setting | 4 B | Current USB audio alt setting |
| 12 | USB mounted flag | 4 B | USB configuration mounted state |
| 13 | System clock | 4 B | Hz (uint32), e.g. 307200000 |
| 14 | Core voltage | 4 B | mV (uint32), e.g. 1150 |
| 15 | Sample rate | 4 B | Hz (uint32), e.g. 48000 |
| 16 | Temperature | 4 B | Centi-degrees C (uint32) |
| 17 | S/PDIF DMA starvations (total) | 4 B | uint32 |
| 18–21 | S/PDIF DMA starvations (instance 0–3) | 4 B | uint32 per instance |
| 22 | USB audio ring overruns | 4 B | uint32 |

**wValue = 9** is the primary metering endpoint used by the bridge. Response format:
- RP2350: 26 bytes — 11 peaks × 2 bytes + 2 bytes CPU load + 2 bytes clip flags
- RP2040: 18 bytes — 7 peaks × 2 bytes + 2 bytes CPU load + 2 bytes clip flags

Peak values are Q15 fixed-point (0x0000 = −∞ dB, 0x7FFF = 0 dBFS).

### get_buffer_stats — DMA Fill Levels

**Request:** `REQ_GET_BUFFER_STATS` (0xB0), returns a 44-byte `BufferStatsPacket`.

```c
typedef struct __attribute__((packed)) {
    uint8_t  num_spdif;        // Number of S/PDIF instances (2 or 4)
    uint8_t  flags;            // Bit 0: PDM active, Bit 1: audio streaming
    uint16_t sequence;         // Monotonic counter
    struct {
        uint8_t consumer_free;       // Buffers available for DMA
        uint8_t consumer_prepared;   // Buffers queued for DMA
        uint8_t consumer_playing;    // DMA in-flight
        uint8_t consumer_fill_pct;   // Fill percentage
        uint8_t consumer_min_fill_pct;
        uint8_t consumer_max_fill_pct;
        uint8_t pad[2];
    } spdif[4];                // Per S/PDIF instance
    struct {
        uint8_t dma_fill_pct;
        uint8_t dma_min_fill_pct;
        uint8_t dma_max_fill_pct;
        uint8_t ring_fill_pct;
        uint8_t ring_min_fill_pct;
        uint8_t ring_max_fill_pct;
        uint8_t pad[2];
    } pdm;
} BufferStatsPacket;
```

**Interpretation:** If `consumer_min_fill_pct` regularly hits 0, the DSP pipeline cannot keep up with the output rate — check CPU load. If `consumer_max_fill_pct` hits 100, the output is consuming faster than USB is providing — normal during brief periods, sustained means a USB bandwidth problem.

**Reset:** `REQ_RESET_BUFFER_STATS` (0xB1) clears min/max counters.

### get_usb_error_stats — USB PHY Errors

**Request:** `REQ_GET_USB_ERROR_STATS` (0xB2), returns a 24-byte `UsbErrorStatsPacket`:

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 B | total | Total USB error count |
| 4 | 4 B | crc | CRC errors |
| 8 | 4 B | bitstuff | Bit-stuffing errors |
| 12 | 4 B | rx_overflow | Receive overflow errors |
| 16 | 4 B | rx_timeout | Receive timeout errors |
| 20 | 4 B | data_seq | Data sequence errors |

All fields are `uint32_t` little-endian. Non-zero values indicate signal integrity issues — try a shorter or higher-quality USB cable, or a different port.

**Reset:** `REQ_RESET_USB_ERROR_STATS` (0xB3) zeroes all counters.

### get_core1_mode / get_core1_conflict — Core 1 State

**get_core1_mode:** `REQ_GET_CORE1_MODE` (0x7A), returns 1 byte:

| Value | Mode |
|-------|------|
| 0 | PDM output (sigma-delta modulator on Core 1) |
| 1 | EQ Worker (DSP filter calculations offloaded to Core 1) |
| 2 | Idle |

**get_core1_conflict:** `REQ_GET_CORE1_CONFLICT` (0x7B), `wValue` = output index, returns 1 byte (0 = no conflict, 1 = conflict). Checks whether enabling a given output would conflict with the current Core 1 mode.

### get_peaks — Current Peak Levels

Use `REQ_GET_STATUS` with `wValue = 9` (combined metering) to read all peak levels in one transfer. Individual peak pairs are available at `wValue` 0, 1, 2.

Peak values are Q15 fixed-point. To convert to dBFS:

```python
import math
dbfs = 20 * math.log10(peak_q15 / 32768.0) if peak_q15 > 0 else float('-inf')
```

### clear_clips — Reset Clip Indicators

**Request:** `REQ_CLEAR_CLIPS` (0x83)

Returns the current `clip_flags` value (2 bytes: previous state before clearing), then resets the flags to zero. Clip flags are per-channel sticky latches — they remain set until explicitly cleared.

Use this after investigating which channels clipped to start fresh monitoring.

---

## Recovery

### Factory Reset

The `factory_reset` command (`REQ_FACTORY_RESET`, 0x53) restores all parameters to compiled-in defaults:

- All EQ bands → FLAT
- All preamps → 0 dB
- All matrix crosspoints → default routing
- All output gains → 0 dB, unmuted, enabled
- Loudness off, crossfeed off, leveller off
- Master volume → 0 dB
- Pin configuration → board defaults

The active preset slot is unchanged (still selected, now running defaults). Flash is rewritten.

Via the bridge:
```json
{"id": 1, "method": "factory_reset"}
```

Via Python:
```python
from usb_protocol import DSPiDevice
dev = DSPiDevice.open_first()
dev.factory_reset()
```

### Bootloader Entry

Three ways to enter the UF2 bootloader:

1. **Physical BOOTSEL button:** Hold BOOTSEL while plugging in USB.
2. **Vendor command:** Send `REQ_ENTER_BOOTLOADER` (0xF0). The device acknowledges, waits 100 ms, then calls `reset_usb_boot(0, 0)`.
3. **Double-reset:** If `pico_bootsel_via_double_reset` is linked, rapidly pressing reset twice within 200 ms enters BOOTSEL mode (depends on board hardware).

### Flash Corruption

If the firmware is corrupted and the device does not enumerate:

1. Hold **BOOTSEL** while plugging in USB. The bootloader is in masked ROM and always works.
2. The `RPI-RP2` drive appears.
3. Copy a known-good `.uf2` file to the drive.
4. The device reboots into the fresh firmware.

This recovery method always works because the BOOTSEL bootloader cannot be overwritten — it resides in read-only ROM. Flash corruption only affects the application firmware, never the bootloader itself.

If preset data is corrupted (device boots but behaves oddly), use `factory_reset` to restore defaults, then reconfigure.

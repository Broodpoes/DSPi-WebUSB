# Firmware Guide

## Overview

DSPi firmware runs on the Raspberry Pi Pico (RP2040) and Pico 2 (RP2350), turning either board into a USB audio DSP processor. The binary is built as `copy_to_ram` — the entire firmware executes from SRAM for deterministic latency, bypassing flash XIP stalls entirely. Both platforms run at a fixed 307.2 MHz system clock (VCO 1536 MHz / 5 / 1) at 1.15 V.

Audio arrives over USB as 16- or 24-bit stereo PCM (44.1/48/96 kHz) and flows through a linear DSP pipeline:

```
USB Input → Preamp → Master EQ → Volume Leveller → Crossfeed + Loudness + Metering
         → Matrix Mixer → Per-Output EQ → Gain/Mute → Delay → S/PDIF | I2S | PDM
```

Processing is split across both cores. Core 0 handles the main pipeline, USB, and the first S/PDIF pair. Core 1 either runs the PDM delta-sigma modulator or acts as an EQ worker for additional S/PDIF outputs — these two modes are mutually exclusive.

---

## Prerequisites

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| **CMake** | 3.12 | `cmake --version` |
| **Arm GNU Toolchain** | Any recent | `arm-none-eabi-gcc` must be on `PATH` |
| **Python 3** | 3.x | Required by Pico SDK build scripts |
| **Git** | Any | For cloning with submodules |

On Debian/Ubuntu:

```bash
sudo apt install cmake gcc-arm-none-eabi python3 git
```

On macOS (Homebrew):

```bash
brew install cmake arm-none-eabi-gcc python3 git
```

---

## Clone and Init

Clone with submodules — the Pico SDK and the modified pico-extras are included in-tree:

```bash
git clone --recursive https://github.com/WeebLabs/DSPi.git
cd DSPi
```

If you cloned without `--recursive`, initialize submodules after the fact:

```bash
git submodule update --init --recursive
```

The repository layout relevant to firmware builds:

```
firmware/
├── CMakeLists.txt              # Top-level CMake (sets up SDK/extras)
├── pico-sdk/                   # Pico SDK submodule
├── pico-extras/                # Modified pico-extras (in-tree, not upstream)
│   └── src/rp2_common/
│       ├── pico_audio_spdif_multi/   # Multi-instance S/PDIF library
│       └── pico_audio_i2s_multi/     # Multi-instance I2S library
└── DSPi/
    ├── CMakeLists.txt          # Firmware build definition
    ├── main.c                  # Entry point, init, main loop
    ├── usb_audio.c             # USB audio + DSP pipeline
    ├── dsp_pipeline.c          # Filter coefficient computation
    ├── dsp_process_rp2040.S    # RP2040 ARM assembly biquad
    └── ...                     # Other DSP and USB source files
```

---

## Building for RP2040

Target: Raspberry Pi Pico (standard).

```bash
cd DSPi   # repository root
mkdir build-rp2040
cd build-rp2040
cmake -DPICO_BOARD=pico -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
make
```

**Output:** `build-rp2040/DSPi/DSPi.uf2`

The RP2040 build includes `dsp_process_rp2040.S` — hand-optimized ARM assembly for the Q28 fixed-point biquad inner loop. All DSP math is 32-bit fixed-point (Q28 format, 28 fractional bits).

---

## Building for RP2350

Target: Raspberry Pi Pico 2.

```bash
cd DSPi   # repository root
mkdir build-rp2350
cd build-rp2350
cmake -DPICO_BOARD=pico2 -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
make
```

**Output:** `build-rp2350/DSPi/DSPi.uf2`

The RP2350 build uses the hardware FPU for single-precision float throughout the entire DSP pipeline. The assembly source is excluded — all DSP code is pure C with DCP inline helpers.

Both builds can coexist. The build directories are separate to avoid conflicts.

---

## Clean Rebuild

Remove the build directory and reconfigure from scratch:

```bash
# Clean RP2040 build
rm -rf build-rp2040
mkdir build-rp2040 && cd build-rp2040
cmake -DPICO_BOARD=pico -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
make

# Clean RP2350 build
rm -rf build-rp2350
mkdir build-rp2350 && cd build-rp2350
cmake -DPICO_BOARD=pico2 -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
make
```

Alternatively, use CMake's built-in clean:

```bash
cmake --build build-rp2040 --clean-first
cmake --build build-rp2350 --clean-first
```

---

## Flashing

### UF2 Bootloader (BOOTSEL)

This is the standard method, same as any RP2040/RP2350 project:

1. Hold the **BOOTSEL** button on the board while plugging it into USB.
2. A mass-storage drive appears — `RPI-RP2` on RP2040, `RPI-RP2` on RP2350.
3. Copy the `.uf2` file to the drive:
   ```bash
   cp build-rp2040/DSPi/DSPi.uf2 /path/to/RPI-RP2/
   ```
4. The board reboots automatically and enumerates as "Weeb Labs DSPi".

### In-Field Update (Vendor Command 0xF0)

A running DSPi can enter bootloader mode without physical access:

- **Request:** `REQ_ENTER_BOOTLOADER` (`0xF0`)
- **Interface:** Vendor interface (2)
- **Direction:** Device-to-host (`bmRequestType = 0xC1`)
- **Response:** 1 byte (`0x01` = success), then the device disconnects and reboots into the ROM bootloader.

After the device reboots, it appears as a USB drive. Copy the new `.uf2` file to it. The ROM bootloader is in permanent ROM and cannot be overwritten — this command cannot brick the device.

See [Firmware Update](../Documentation/Features/firmware_update.md) for the full protocol details and code examples in Python, Swift, Node.js, and C.

---

## Platform Differences

| | **RP2040 (Pico)** | **RP2350 (Pico 2)** |
|---|---|---|
| **Math** | Q28 fixed-point | Single-precision float (hardware FPU) |
| **EQ Engine** | Hand-optimized ARM assembly biquad (`dsp_process_rp2040.S`) | Hybrid SVF/biquad — Cytomic SVF below Fs/7.5, TDF2 biquad above |
| **S/PDIF Slots** | 2 stereo pairs (4 channels) | 4 stereo pairs (8 channels) |
| **I2S Slots** | 2 (shared with S/PDIF) | 4 (shared with S/PDIF) |
| **PDM Output** | 1 subwoofer | 1 subwoofer |
| **Total Outputs** | 5 | 9 |
| **Matrix Mixer** | 2×5 | 2×9 |
| **Total EQ Bands** | 70 (7 channels × 10 bands) | 110 (11 channels × 10 bands) |
| **Max Delay** | 50 ms (4096 samples) | 170 ms (8192 samples) |
| **Core 1 EQ Worker** | Outputs 3–4 | Outputs 3–8 |

The RP2350's hardware FPU eliminates the need for hand-tuned assembly and enables the hybrid SVF/biquad architecture. SVF (State Variable Filter) provides superior numerical accuracy for low-frequency filters where single-precision biquad coefficient quantization becomes problematic. The crossover between SVF and biquad is at Fs/7.5 (~6.4 kHz at 48 kHz).

Core 1 modes are the same on both platforms: **PDM mode** (delta-sigma modulator), **EQ worker mode** (parallel output processing), or **idle**. PDM and EQ worker are mutually exclusive.

---

## WebUSB Support

The firmware includes a WebUSB implementation that allows browsers to connect directly to the device without a native driver or bridge application.

**What was added:**

- `bcdUSB = 0x0210` (USB 2.0.1) in the device descriptor — required for BOS descriptor support.
- A **BOS descriptor** (Binary Device Object Store) containing a WebUSB Platform Capability descriptor with the standard UUID (`3408b638-09a9-47a0-8bfd-a0768815b665`), version 1.0.
- A **vendor code handler** (`WEBUSB_VENDOR_CODE = 0x02`) in the USB control request dispatcher that responds to `GET_URL` requests (wIndex=0x0002) by returning the landing page URL descriptor.
- A **URL descriptor** pointing to `weeblabs.github.io/dspi-web` — the browser navigates here when the user clicks "Connect" in the WebUSB permission prompt.

**What it enables:**

When a user plugs the DSPi into a machine and opens the landing page in a Chromium-based browser, the page can request WebUSB access and communicate with the device directly via control transfers. This provides an alternative to the Python bridge + desktop app workflow — the DSPi can be controlled entirely from a browser tab.

**Compatibility:**

The WebUSB additions are purely additive. They do not affect the existing USB Audio Class interface, the WinUSB/WCID descriptors for Windows driverless operation, or the vendor control protocol used by desktop applications. All existing host software continues to work unchanged.

---

## Build Configuration

### Flash Clock Divider

`PICO_FLASH_SPI_CLKDIV=6` is set globally before `pico_sdk_init()` in `firmware/CMakeLists.txt`. At 307.2 MHz, the default divider of 2 would yield a 153.6 MHz flash clock — above the W25Q080's 104–133 MHz rated maximum. Reads survive (single-shot at boot), but erase/program operations fail silently, causing preset saves to fail verification. Divider 6 yields 51.2 MHz, safely within spec.

On RP2040, this propagates to the boot2 SSI setup. On RP2350, boot2 isn't executed by default, so the firmware applies the divider at runtime by writing QMI registers directly (`firmware/DSPi/flash_clkdiv.c`).

### Optimization

```cmake
# General code
add_compile_options(-O2)

# DSP-critical hot paths
set_source_files_properties(
    dsp_pipeline.c usb_audio.c crossfeed.c loudness.c leveller.c
    PROPERTIES COMPILE_FLAGS "-O3"
)
```

### Compile Definitions

Key definitions from `firmware/DSPi/CMakeLists.txt`:

| Definition | Value | Purpose |
|-----------|-------|---------|
| `AUDIO_FREQ_MAX` | `48000` | Maximum audio sample rate |
| `PICO_AUDIO_SPDIF_PIO` | `0` | S/PDIF uses PIO0 |
| `PICO_AUDIO_SPDIF_DMA_IRQ` | `1` | S/PDIF DMA interrupt line |
| `PICO_AUDIO_I2S_DMA_IRQ` | `0` | I2S uses separate DMA IRQ |
| `PICO_USBDEV_USE_ZERO_BASED_INTERFACES` | `1` | Zero-based interface numbering |
| `PICO_USBDEV_MAX_DESCRIPTOR_SIZE` | `256` | USB descriptor buffer size |
| `PICO_DEFAULT_UART_TX_PIN` | `12` | Debug UART on GPIO 12 |

### Binary Type

```cmake
pico_set_binary_type(DSPi copy_to_ram)
```

The entire firmware image is copied to SRAM at boot and executes from RAM. This eliminates flash XIP latency jitter from the DSP pipeline but means the binary must fit within available SRAM.

### Linked Libraries

```
pico_stdlib          pico_multicore       pico_unique_id
hardware_pwm         hardware_flash       hardware_adc
pico_audio_spdif_multi  pico_audio_i2s_multi  usb_device
```

---

## Troubleshooting

### `arm-none-eabi-gcc: command not found`

The ARM toolchain is not on your PATH. Install it and verify:

```bash
arm-none-eabi-gcc --version
```

On some systems the package installs as `arm-none-eabi-gcc` under `/usr/bin`; on others you may need to add the toolchain's `bin/` directory to your PATH manually.

### CMake cannot find Pico SDK

The SDK is included as a git submodule at `firmware/pico-sdk`. If you cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

You should not need to set `PICO_SDK_PATH` — the top-level `CMakeLists.txt` defaults to the submodule location.

### Build fails with undefined references to pico-extras symbols

The `pico-extras` path must be passed explicitly:

```bash
cmake -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
```

The top-level `CMakeLists.txt` forces `PICO_EXTRAS_PATH` to the local (modified) copy, but passing it on the command line ensures CMake picks it up.

### UF2 file not generated

Check that `pico_add_extra_outputs(DSPi)` is present in `firmware/DSPi/CMakeLists.txt`. The `.uf2` file is generated as a post-build step. If `make` completes without errors but no `.uf2` appears, the extra outputs step may have failed silently — check the build output for warnings.

### Preset saves don't persist after flash

This indicates the flash SPI clock divider is too high for reliable erase/program. Verify that `PICO_FLASH_SPI_CLKDIV=6` is in your compile definitions. On RP2350, also verify that `flash_clkdiv.c` is compiled and linked (check for `dspi_flash_apply_clkdiv` in the linker map).

### Device not recognized after flashing

- Verify you used the correct build: RP2040 `.uf2` for Pico, RP2350 `.uf2` for Pico 2.
- Check the drive label after BOOTSEL — it should be `RPI-RP2`.
- Try a different USB cable. Some charge-only cables don't pass data.

### Flash write errors during `make`

If `make` fails with flash-related errors during the UF2 generation step, ensure no other process has the build directory locked. On Windows, close any file explorer windows pointing to the build directory.

### Stale build after switching branches

After switching git branches or pulling updates that change submodules:

```bash
git submodule update --init --recursive
rm -rf build-rp2040 build-rp2350
# Rebuild from scratch (see above)
```

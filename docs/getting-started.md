# Getting Started

**DSPi** turns a Raspberry Pi Pico or Pico 2 into a full-featured USB audio DSP processor — parametric EQ, active crossovers, room correction, loudness compensation, headphone crossfeed, and more, all for under $10 in hardware. It appears as a standard USB sound card on macOS, Windows, Linux, and iOS, and outputs 24-bit audio over S/PDIF or I2S to your DAC or amplifier.

This guide walks you through three paths:

1. **Flashing pre-built firmware** — the fastest way to get running.
2. **Setting up the web interface** — control DSPi from your browser.
3. **Building from source** — for development or custom builds.

---

## Prerequisites

### Hardware

| Item | Notes |
|------|-------|
| **RP2040 board** (e.g. Raspberry Pi Pico) **or** **RP2350 board** (e.g. Raspberry Pi Pico 2) | RP2350 supports more output channels and uses a hardware FPU. Both platforms are production-ready. |
| **USB cable** | Micro-USB for the Pico, or matching connector for your board. Must support data (not charge-only). |
| **Output wiring** | Depends on your use case — see [Wiring Guide](#wiring-guide) below. |

#### Wiring Guide

DSPi outputs audio on GPIO pins. The defaults work out of the box:

**RP2350 (Pico 2) — up to 8 output channels + 1 PDM subwoofer:**

| Function | Default Pin | Connection |
|:---------|:------------|:-----------|
| Output Slot 0 (Out 1–2) | GPIO 6 | S/PDIF or I2S data — main L/R |
| Output Slot 1 (Out 3–4) | GPIO 7 | S/PDIF or I2S data — pair 2 |
| Output Slot 2 (Out 5–6) | GPIO 8 | S/PDIF or I2S data — pair 3 |
| Output Slot 3 (Out 7–8) | GPIO 9 | S/PDIF or I2S data — pair 4 |
| Subwoofer (PDM, Out 9) | GPIO 10 | Active sub or low-pass filter |
| I2S BCK (shared) | GPIO 14 | Bit clock for I2S slots |
| I2S LRCLK | GPIO 15 | Word clock (always BCK + 1) |
| I2S MCK (optional) | GPIO 13 | 128× or 256× Fs master clock |
| USB | Micro-USB | Host (PC/Mac/mobile) |

**RP2040 (Pico) — up to 4 output channels + 1 PDM subwoofer:**

| Function | Default Pin | Connection |
|:---------|:------------|:-----------|
| Output Slot 0 (Out 1–2) | GPIO 6 | S/PDIF or I2S data — main L/R |
| Output Slot 1 (Out 3–4) | GPIO 7 | S/PDIF or I2S data — pair 2 |
| Subwoofer (PDM, Out 5) | GPIO 10 | Active sub or low-pass filter |
| I2S BCK (shared) | GPIO 14 | Bit clock for I2S slots |
| I2S LRCLK | GPIO 15 | Word clock (always BCK + 1) |
| I2S MCK (optional) | GPIO 13 | 128× or 256× Fs master clock |
| USB | Micro-USB | Host (PC/Mac/mobile) |

> **S/PDIF** requires a Toshiba TOSLINK transmitter (e.g. TOTX179) or a simple resistive divider for coaxial. **I2S** is 24-bit in 32-bit left-justified frames — wires directly into most I2S DACs (PCM5102, ES9038, etc.). **PDM** output needs a resistor-capacitor low-pass filter. All pin assignments can be changed at runtime without reflashing.

### Software

What you need depends on your path:

| Path | Requirements |
|------|-------------|
| **Flashing pre-built firmware** | A computer with a USB port and a file manager. |
| **Web interface** | Python 3.10+, pip. Linux requires a udev rule. |
| **Building from source** | CMake ≥ 3.13, `arm-none-eabi-gcc` toolchain, Python 3, Git. |

---

## Quick Start — Flashing Pre-built Firmware

### Step 1: Download the firmware

Download the latest `DSPi.uf2` for your board from the [releases page](https://github.com/WeebLabs/DSPi/releases). Choose the RP2040 build for the original Pico, or the RP2350 build for the Pico 2.

### Step 2: Enter BOOTSEL mode

1. **Unplug** the Pico from USB if it's connected.
2. **Hold the BOOTSEL button** (the one closest to the USB connector).
3. While holding BOOTSEL, **plug the Pico into your computer** via USB.
4. Release the button.

A mass-storage drive named **RPI-RP2** (RP2040) or **RP2350** will appear on your computer, just like a USB thumb drive.

### Step 3: Flash

Drag and drop the `DSPi.uf2` file onto the drive. The Pico will automatically:

1. Copy the firmware into flash.
2. Unmount the drive.
3. Reboot into DSPi.

### Step 4: Verify

After a few seconds the Pico should enumerate as a USB audio device. Check:

- **macOS:** It appears in Sound settings as "Weeb Labs DSPi".
- **Windows:** It appears in Sound settings as a playback/recording device. WinUSB drivers install automatically.
- **Linux:** It appears as an ALSA device. Check with `aplay -l`.

Select it as your audio output device and play music. If your output wiring is connected, you should hear audio.

---

## Quick Start — Web Interface

The web interface lets you control all DSP features (EQ, mixer, presets, metering, etc.) from your browser. It communicates with DSPi through a lightweight Python bridge over USB.

### Step 1: Install dependencies

```bash
cd DSPi/web/bridge
pip install -r requirements.txt
```

This installs `pyusb` (USB communication) and `aiohttp` (HTTP/WebSocket server). You also need `libusb` installed on your system:

- **Ubuntu/Debian:** `sudo apt install libusb-1.0-0-dev`
- **macOS:** `brew install libusb`
- **Windows:** libusb is bundled with pyusb via `libusb-wheel`.

### Step 2: Set up USB access (Linux only)

On Linux, the device is only accessible as root by default. Create a udev rule to allow user access:

```bash
sudo tee /etc/udev/rules.d/99-dspi.rules << 'EOF'
SUBSYSTEM=="usb", ATTR{idVendor}=="2e8a", ATTR{idProduct}=="feaa", MODE="0666"
EOF
sudo udevadm control --reload-rules && sudo udevadm trigger
```

macOS and Windows do not need this step.

### Step 3: Start the bridge

Make sure your DSPi is plugged in via USB, then:

```bash
cd web/bridge
python bridge.py
```

The bridge will:

- Scan for a DSPi device (VID `0x2E8A`, PID `0xFEAA`) and connect automatically.
- Start an HTTP server on port 8765 serving the web UI and a WebSocket API.
- Begin pushing metering data at ~10 Hz to connected clients.

You should see output like:

```
Starting DSPi bridge on http://localhost:8765
Connected to DSPi (serial: ...)
```

**CLI options:**

```
python bridge.py [--port PORT] [--static PATH] [--no-auto]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `8765` | HTTP/WebSocket port |
| `--static` | `../app` | Path to the web app files |
| `--no-auto` | off | Don't auto-connect at startup |

### Step 4: Open the browser

Navigate to [http://localhost:8765](http://localhost:8765). The web app loads and connects to DSPi via the bridge's WebSocket. You should see the DSPi control panel with live metering.

---

## Quick Start — Building from Source

Building from source is necessary if you want to modify the firmware or work on the latest development branch.

### Step 1: Install the toolchain

You need:

- **CMake** 3.13 or newer
- **ARM GNU Toolchain** (`arm-none-eabi-gcc`, `arm-none-eabi-gdb`, etc.)
- **Python 3** (for pico-sdk helper scripts)
- **Git**
- **Ninja** (optional, faster than Make)

Install these via your package manager or from [ARM Developer](https://developer.arm.com/tools-and-software/open-source-software/developer-tools/gnu-toolchain).

### Step 2: Clone the repository

DSPi includes the pico-sdk and modified pico-extras as submodules. Clone recursively:

```bash
git clone --recursive https://github.com/WeebLabs/DSPi.git
cd DSPi
```

If you already cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

### Step 3: Configure and build

The build system uses separate output directories for each platform. Both platforms run at 307.2 MHz, 1.15 V.

**Build for RP2040 (Raspberry Pi Pico):**

```bash
mkdir build-rp2040
cd build-rp2040
cmake -DPICO_BOARD=pico -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
make -j$(nproc)
```

Output: `build-rp2040/DSPi/DSPi.uf2`

**Build for RP2350 (Raspberry Pi Pico 2):**

```bash
mkdir build-rp2350
cd build-rp2350
cmake -DPICO_BOARD=pico2 -DPICO_EXTRAS_PATH=../firmware/pico-extras ../firmware
make -j$(nproc)
```

Output: `build-rp2350/DSPi/DSPi.uf2`

> The firmware is built as `copy_to_ram` — it copies itself into RAM at boot for faster execution. The build also sets `PICO_FLASH_SPI_CLKDIV=6` to keep flash access safely within spec at the 307.2 MHz system clock.

### Step 4: Flash

Use the same BOOTSEL drag-and-drop method described in [Flashing Pre-built Firmware](#quick-start--flashing-pre-built-firmware). Alternatively, if you already have DSPi firmware running, you can trigger a reboot into the bootloader from the web interface or by sending the `REQ_ENTER_BOOTLOADER` (0xF0) USB vendor command.

---

## Next Steps

- **[Firmware Guide](firmware.md)** — in-depth firmware architecture, signal chain, and platform differences.
- **[Web Interface](web-interface.md)** — full bridge configuration, WebSocket API reference, and WebUSB details.
- **[Configuration](configuration.md)** — DSP features, EQ setup, matrix mixer routing, presets, and output configuration.

For detailed specifications of individual features, see the [feature specs](../Documentation/Features/) under `Documentation/Features/`.

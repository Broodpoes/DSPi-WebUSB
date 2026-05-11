# DSPi Documentation

DSPi is a USB audio DSP processor for RP2040/RP2350. It appears as a USB sound card and applies real-time DSP — parametric EQ, active crossovers, loudness compensation, headphone crossfeed, volume levelling, and matrix mixing — outputting over S/PDIF, I2S, or PDM.

## Guides

| Guide | Description |
|-------|-------------|
| [Getting Started](getting-started.md) | Quick-start: flash firmware, set up web interface, build from source |
| [Firmware Guide](firmware.md) | Build firmware for RP2040/RP2350, flashing, WebUSB support, platform differences |
| [Web Interface](web-interface.md) | Python bridge setup, web app usage, WebUSB direct access |
| [Configuration](configuration.md) | Presets, audio outputs, DSP settings, pin configuration, bulk state transfer |
| [Troubleshooting](troubleshooting.md) | Build errors, USB issues, bridge problems, audio diagnostics, recovery |

## Reference

| Reference | Description |
|-----------|-------------|
| [API Reference](api-reference.md) | Complete WebSocket JSON-RPC method reference (68 methods) |
| [USB Protocol](usb-protocol.md) | Low-level USB vendor command reference (80+ commands, wire formats) |

## Architecture & Specs

Detailed architecture and per-feature specifications live in the [`Documentation/`](../Documentation/) directory:

- [`current_architecture.md`](../Documentation/current_architecture.md) — Authoritative architecture reference (1467 lines)
- [`Features/`](../Documentation/Features/) — 16 feature spec files covering protocol formats, wire layouts, and edge cases

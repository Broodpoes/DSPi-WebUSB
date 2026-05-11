"""
DSPi USB Protocol — Python implementation of the vendor control transfer protocol.

Implements all vendor commands defined in firmware/DSPi/config.h for communicating
with the DSPi firmware over USB control transfers (EP0, interface 2).
"""

import struct
import usb.core
import usb.util

# USB IDs
VENDOR_ID = 0x2E8A
PRODUCT_ID = 0xFEAA
VENDOR_INTERFACE = 2

# Request types
REQ_TYPE_OUT = 0x41  # Host-to-device, vendor, interface
REQ_TYPE_IN  = 0xC1  # Device-to-host, vendor, interface

# ── Vendor Request Codes ──────────────────────────────────────────────────
# EQ
REQ_SET_EQ_PARAM    = 0x42
REQ_GET_EQ_PARAM    = 0x43
REQ_SET_PREAMP      = 0x44
REQ_GET_PREAMP      = 0x45
REQ_SET_BYPASS      = 0x46
REQ_GET_BYPASS      = 0x47
REQ_SET_DELAY       = 0x48
REQ_GET_DELAY       = 0x49

# Status / Save / Reset
REQ_GET_STATUS      = 0x50
REQ_SAVE_PARAMS     = 0x51
REQ_LOAD_PARAMS     = 0x52
REQ_FACTORY_RESET   = 0x53

# Channel gain/mute
REQ_SET_CHANNEL_GAIN = 0x54
REQ_GET_CHANNEL_GAIN = 0x55
REQ_SET_CHANNEL_MUTE = 0x56
REQ_GET_CHANNEL_MUTE = 0x57

# Loudness
REQ_SET_LOUDNESS            = 0x58
REQ_GET_LOUDNESS            = 0x59
REQ_SET_LOUDNESS_REF        = 0x5A
REQ_GET_LOUDNESS_REF        = 0x5B
REQ_SET_LOUDNESS_INTENSITY  = 0x5C
REQ_GET_LOUDNESS_INTENSITY  = 0x5D

# Crossfeed
REQ_SET_CROSSFEED           = 0x5E
REQ_GET_CROSSFEED           = 0x5F
REQ_SET_CROSSFEED_PRESET    = 0x60
REQ_GET_CROSSFEED_PRESET    = 0x61
REQ_SET_CROSSFEED_FREQ      = 0x62
REQ_GET_CROSSFEED_FREQ      = 0x63
REQ_SET_CROSSFEED_FEED      = 0x64
REQ_GET_CROSSFEED_FEED      = 0x65
REQ_SET_CROSSFEED_ITD       = 0x66
REQ_GET_CROSSFEED_ITD       = 0x67

# Matrix Mixer
REQ_SET_MATRIX_ROUTE        = 0x70
REQ_GET_MATRIX_ROUTE        = 0x71
REQ_SET_OUTPUT_ENABLE       = 0x72
REQ_GET_OUTPUT_ENABLE       = 0x73
REQ_SET_OUTPUT_GAIN         = 0x74
REQ_GET_OUTPUT_GAIN         = 0x75
REQ_SET_OUTPUT_MUTE         = 0x76
REQ_GET_OUTPUT_MUTE         = 0x77
REQ_SET_OUTPUT_DELAY        = 0x78
REQ_GET_OUTPUT_DELAY        = 0x79

# Core 1
REQ_GET_CORE1_MODE          = 0x7A
REQ_GET_CORE1_CONFLICT      = 0x7B

# Pin config
REQ_SET_OUTPUT_PIN          = 0x7C
REQ_GET_OUTPUT_PIN          = 0x7D

# Device ID
REQ_GET_SERIAL              = 0x7E
REQ_GET_PLATFORM            = 0x7F

# Clip detection
REQ_CLEAR_CLIPS             = 0x83

# Presets
REQ_PRESET_SAVE             = 0x90
REQ_PRESET_LOAD             = 0x91
REQ_PRESET_DELETE           = 0x92
REQ_PRESET_GET_NAME         = 0x93
REQ_PRESET_SET_NAME         = 0x94
REQ_PRESET_GET_DIR          = 0x95
REQ_PRESET_SET_STARTUP      = 0x96
REQ_PRESET_GET_STARTUP      = 0x97
REQ_PRESET_SET_INCLUDE_PINS = 0x98
REQ_PRESET_GET_INCLUDE_PINS = 0x99
REQ_PRESET_GET_ACTIVE       = 0x9A
REQ_SET_CHANNEL_NAME        = 0x9B
REQ_GET_CHANNEL_NAME        = 0x9C

# Bulk params
REQ_GET_ALL_PARAMS          = 0xA0
REQ_SET_ALL_PARAMS          = 0xA1

# Buffer stats
REQ_GET_BUFFER_STATS        = 0xB0
REQ_RESET_BUFFER_STATS      = 0xB1
REQ_GET_USB_ERROR_STATS     = 0xB2
REQ_RESET_USB_ERROR_STATS   = 0xB3

# Volume leveller
REQ_SET_LEVELLER_ENABLE     = 0xB4
REQ_GET_LEVELLER_ENABLE     = 0xB5
REQ_SET_LEVELLER_AMOUNT     = 0xB6
REQ_GET_LEVELLER_AMOUNT     = 0xB7
REQ_SET_LEVELLER_SPEED      = 0xB8
REQ_GET_LEVELLER_SPEED      = 0xB9
REQ_SET_LEVELLER_MAX_GAIN   = 0xBA
REQ_GET_LEVELLER_MAX_GAIN   = 0xBB
REQ_SET_LEVELLER_LOOKAHEAD  = 0xBC
REQ_GET_LEVELLER_LOOKAHEAD  = 0xBD
REQ_SET_LEVELLER_GATE       = 0xBE
REQ_GET_LEVELLER_GATE       = 0xBF

# I2S
REQ_SET_OUTPUT_TYPE         = 0xC0
REQ_GET_OUTPUT_TYPE         = 0xC1
REQ_SET_I2S_BCK_PIN         = 0xC2
REQ_GET_I2S_BCK_PIN         = 0xC3
REQ_SET_MCK_ENABLE          = 0xC4
REQ_GET_MCK_ENABLE          = 0xC5
REQ_SET_MCK_PIN             = 0xC6
REQ_GET_MCK_PIN             = 0xC7
REQ_SET_MCK_MULTIPLIER      = 0xC8
REQ_GET_MCK_MULTIPLIER      = 0xC9

# Per-channel preamp
REQ_SET_PREAMP_CH           = 0xD0
REQ_GET_PREAMP_CH           = 0xD1

# Master volume
REQ_SET_MASTER_VOLUME       = 0xD2
REQ_GET_MASTER_VOLUME       = 0xD3
REQ_SET_MASTER_VOLUME_MODE  = 0xD4
REQ_GET_MASTER_VOLUME_MODE  = 0xD5
REQ_SAVE_MASTER_VOLUME      = 0xD6
REQ_GET_SAVED_MASTER_VOLUME = 0xD7

# System
REQ_ENTER_BOOTLOADER        = 0xF0

# Platform IDs
PLATFORM_RP2040 = 0
PLATFORM_RP2350 = 1

# Master volume constants
MASTER_VOL_MUTE_DB = -128.0

# Filter types
FILTER_FLAT      = 0
FILTER_PEAKING   = 1
FILTER_LOW_SHELF = 2
FILTER_HIGH_SHELF= 3
FILTER_LOW_PASS  = 4
FILTER_HIGH_PASS = 5

# Timeout for control transfers (ms)
CTRL_TIMEOUT = 2000

# Bulk transfer size
BULK_PARAMS_SIZE = 2896


class DSPiDevice:
    """High-level interface to a DSPi device via USB."""

    def __init__(self, device: usb.core.Device):
        self.dev = device
        self._claimed = False

    # ── Connection ─────────────────────────────────────────────────────

    def connect(self):
        """Claim the vendor interface."""
        if self.dev.is_kernel_driver_active(VENDOR_INTERFACE):
            self.dev.detach_kernel_driver(VENDOR_INTERFACE)
        usb.util.claim_interface(self.dev, VENDOR_INTERFACE)
        self._claimed = True

    def disconnect(self):
        """Release the vendor interface."""
        if self._claimed:
            usb.util.release_interface(self.dev, VENDOR_INTERFACE)
            self._claimed = False

    def _ctrl_in(self, bRequest, wValue=0, wLength=64):
        """Device-to-host control transfer with retry on pipe stall."""
        try:
            return self.dev.ctrl_transfer(REQ_TYPE_IN, bRequest, wValue,
                                          VENDOR_INTERFACE, wLength, CTRL_TIMEOUT)
        except usb.core.USBError as e:
            if e.errno == 32:  # EPIPE — endpoint stall, retry once
                return self.dev.ctrl_transfer(REQ_TYPE_IN, bRequest, wValue,
                                              VENDOR_INTERFACE, wLength, CTRL_TIMEOUT)
            raise

    def _ctrl_out(self, bRequest, wValue=0, data=b''):
        """Host-to-device control transfer with retry on pipe stall."""
        try:
            return self.dev.ctrl_transfer(REQ_TYPE_OUT, bRequest, wValue,
                                          VENDOR_INTERFACE, data, CTRL_TIMEOUT)
        except usb.core.USBError as e:
            if e.errno == 32:  # EPIPE — endpoint stall, retry once
                return self.dev.ctrl_transfer(REQ_TYPE_OUT, bRequest, wValue,
                                              VENDOR_INTERFACE, data, CTRL_TIMEOUT)
            raise

    # ── Device Info ────────────────────────────────────────────────────

    def get_platform(self) -> int:
        """Returns (platform, version_major, version_minor, num_output_channels)."""
        data = self._ctrl_in(REQ_GET_PLATFORM, wLength=4)
        return int(data[0])

    def get_serial(self) -> str:
        """Returns 16-char hex serial number."""
        data = self._ctrl_in(REQ_GET_SERIAL, wLength=16)
        return bytes(data).decode('ascii')

    # ── EQ ─────────────────────────────────────────────────────────────

    def get_eq_param(self, channel: int, band: int) -> dict:
        """Read one EQ band: {channel, band, type, freq, Q, gain_db}."""
        def _get_param(ch, b, param):
            wValue = (ch << 8) | (b << 4) | param
            return bytes(self._ctrl_in(REQ_GET_EQ_PARAM, wValue, 4))
        ftype = int(struct.unpack_from('<I', _get_param(channel, band, 0))[0])
        freq  = struct.unpack_from('<f', _get_param(channel, band, 1))[0]
        q     = struct.unpack_from('<f', _get_param(channel, band, 2))[0]
        gain  = struct.unpack_from('<f', _get_param(channel, band, 3))[0]
        return {"channel": channel, "band": band, "type": ftype,
                "freq": freq, "Q": q, "gain_db": gain}

    def set_eq_param(self, channel: int, band: int, ftype: int,
                     freq: float, q: float, gain_db: float):
        """Write one EQ band."""
        data = struct.pack('<BBBBfff', channel, band, ftype, 0, freq, q, gain_db)
        self._ctrl_out(REQ_SET_EQ_PARAM, data=data)

    # ── Bypass ─────────────────────────────────────────────────────────

    def get_bypass(self) -> bool:
        return bool(self._ctrl_in(REQ_GET_BYPASS, wLength=1)[0])

    def set_bypass(self, on: bool):
        self._ctrl_out(REQ_SET_BYPASS, data=bytes([int(on)]))

    # ── Per-Channel Preamp ─────────────────────────────────────────────

    def get_preamp_ch(self, channel: int) -> float:
        data = self._ctrl_in(REQ_GET_PREAMP_CH, wValue=channel, wLength=4)
        return struct.unpack('<f', data)[0]

    def set_preamp_ch(self, channel: int, db: float):
        self._ctrl_out(REQ_SET_PREAMP_CH, wValue=channel,
                        data=struct.pack('<f', db))

    # Legacy preamp (sets both channels)
    def get_preamp(self) -> float:
        data = self._ctrl_in(REQ_GET_PREAMP, wLength=4)
        return struct.unpack('<f', data)[0]

    def set_preamp(self, db: float):
        self._ctrl_out(REQ_SET_PREAMP, data=struct.pack('<f', db))

    # ── Delays ─────────────────────────────────────────────────────────

    def get_delay(self, channel: int) -> float:
        data = self._ctrl_in(REQ_GET_DELAY, wValue=channel, wLength=4)
        return struct.unpack('<f', data)[0]

    def set_delay(self, channel: int, ms: float):
        self._ctrl_out(REQ_SET_DELAY, wValue=channel,
                        data=struct.pack('<f', ms))

    # ── Channel Gain / Mute ────────────────────────────────────────────

    def get_channel_gain(self, channel: int) -> float:
        data = self._ctrl_in(REQ_GET_CHANNEL_GAIN, wValue=channel, wLength=4)
        return struct.unpack('<f', data)[0]

    def set_channel_gain(self, channel: int, db: float):
        self._ctrl_out(REQ_SET_CHANNEL_GAIN, wValue=channel,
                        data=struct.pack('<f', db))

    def get_channel_mute(self, channel: int) -> bool:
        return bool(self._ctrl_in(REQ_GET_CHANNEL_MUTE, wValue=channel, wLength=1)[0])

    def set_channel_mute(self, channel: int, mute: bool):
        self._ctrl_out(REQ_SET_CHANNEL_MUTE, wValue=channel,
                        data=bytes([int(mute)]))

    # ── Loudness ───────────────────────────────────────────────────────

    def get_loudness(self) -> bool:
        return bool(self._ctrl_in(REQ_GET_LOUDNESS, wLength=1)[0])

    def set_loudness(self, on: bool):
        self._ctrl_out(REQ_SET_LOUDNESS, data=bytes([int(on)]))

    def get_loudness_ref(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_LOUDNESS_REF, wLength=4))[0]

    def set_loudness_ref(self, spl: float):
        self._ctrl_out(REQ_SET_LOUDNESS_REF, data=struct.pack('<f', spl))

    def get_loudness_intensity(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_LOUDNESS_INTENSITY, wLength=4))[0]

    def set_loudness_intensity(self, pct: float):
        self._ctrl_out(REQ_SET_LOUDNESS_INTENSITY, data=struct.pack('<f', pct))

    # ── Crossfeed ──────────────────────────────────────────────────────

    def get_crossfeed(self) -> bool:
        return bool(self._ctrl_in(REQ_GET_CROSSFEED, wLength=1)[0])

    def set_crossfeed(self, on: bool):
        self._ctrl_out(REQ_SET_CROSSFEED, data=bytes([int(on)]))

    def get_crossfeed_preset(self) -> int:
        return int(self._ctrl_in(REQ_GET_CROSSFEED_PRESET, wLength=1)[0])

    def set_crossfeed_preset(self, preset: int):
        self._ctrl_out(REQ_SET_CROSSFEED_PRESET, data=bytes([preset]))

    def get_crossfeed_freq(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_CROSSFEED_FREQ, wLength=4))[0]

    def set_crossfeed_freq(self, hz: float):
        self._ctrl_out(REQ_SET_CROSSFEED_FREQ, data=struct.pack('<f', hz))

    def get_crossfeed_feed(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_CROSSFEED_FEED, wLength=4))[0]

    def set_crossfeed_feed(self, db: float):
        self._ctrl_out(REQ_SET_CROSSFEED_FEED, data=struct.pack('<f', db))

    def get_crossfeed_itd(self) -> bool:
        return bool(self._ctrl_in(REQ_GET_CROSSFEED_ITD, wLength=1)[0])

    def set_crossfeed_itd(self, on: bool):
        self._ctrl_out(REQ_SET_CROSSFEED_ITD, data=bytes([int(on)]))

    # ── Matrix Mixer ───────────────────────────────────────────────────

    def get_matrix_route(self, input_ch: int, output: int) -> dict:
        wValue = (input_ch << 8) | output
        data = self._ctrl_in(REQ_GET_MATRIX_ROUTE, wValue, 8)
        inp, out, enabled, phase = struct.unpack_from('BBBB', data, 0)
        gain = struct.unpack_from('<f', data, 4)[0]
        return {"input": inp, "output": out,
                "enabled": bool(enabled), "phase_invert": bool(phase),
                "gain_db": gain}

    def set_matrix_route(self, input_ch: int, output: int,
                         enabled: bool, phase_invert: bool, gain_db: float):
        data = struct.pack('<BBBBf', input_ch, output,
                           int(enabled), int(phase_invert), gain_db)
        self._ctrl_out(REQ_SET_MATRIX_ROUTE, data=data)

    def get_output_enable(self, output: int) -> bool:
        return bool(self._ctrl_in(REQ_GET_OUTPUT_ENABLE, wValue=output, wLength=1)[0])

    def set_output_enable(self, output: int, on: bool):
        self._ctrl_out(REQ_SET_OUTPUT_ENABLE, wValue=output,
                        data=bytes([int(on)]))

    def get_output_gain(self, output: int) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_OUTPUT_GAIN, wValue=output, wLength=4))[0]

    def set_output_gain(self, output: int, db: float):
        self._ctrl_out(REQ_SET_OUTPUT_GAIN, wValue=output,
                        data=struct.pack('<f', db))

    def get_output_mute(self, output: int) -> bool:
        return bool(self._ctrl_in(REQ_GET_OUTPUT_MUTE, wValue=output, wLength=1)[0])

    def set_output_mute(self, output: int, mute: bool):
        self._ctrl_out(REQ_SET_OUTPUT_MUTE, wValue=output,
                        data=bytes([int(mute)]))

    def get_output_delay(self, output: int) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_OUTPUT_DELAY, wValue=output, wLength=4))[0]

    def set_output_delay(self, output: int, ms: float):
        self._ctrl_out(REQ_SET_OUTPUT_DELAY, wValue=output,
                        data=struct.pack('<f', ms))

    # ── Core 1 ─────────────────────────────────────────────────────────

    def get_core1_mode(self) -> int:
        return int(self._ctrl_in(REQ_GET_CORE1_MODE, wLength=1)[0])

    def get_core1_conflict(self, output: int = 0) -> bool:
        """Check if enabling the given output would cause a Core 1 conflict."""
        return bool(self._ctrl_in(REQ_GET_CORE1_CONFLICT, wValue=output, wLength=1)[0])

    # ── Pin Config ─────────────────────────────────────────────────────

    def get_output_pin(self, output: int) -> int:
        return int(self._ctrl_in(REQ_GET_OUTPUT_PIN, wValue=output, wLength=1)[0])

    def set_output_pin(self, output: int, pin: int) -> int:
        """Returns status code (0=success)."""
        wValue = (pin << 8) | output
        return int(self._ctrl_in(REQ_SET_OUTPUT_PIN, wValue=wValue, wLength=1)[0])

    # ── Clip Detection ─────────────────────────────────────────────────

    def clear_clips(self) -> int:
        """Clear clip flags. Returns the clip flags that were set before clearing."""
        data = self._ctrl_in(REQ_CLEAR_CLIPS, wLength=2)
        return struct.unpack('<H', bytes(data))[0]

    # ── Presets ────────────────────────────────────────────────────────

    def preset_save(self, slot: int):
        self._ctrl_in(REQ_PRESET_SAVE, wValue=slot, wLength=1)

    def preset_load(self, slot: int):
        self._ctrl_in(REQ_PRESET_LOAD, wValue=slot, wLength=1)

    def preset_delete(self, slot: int):
        self._ctrl_in(REQ_PRESET_DELETE, wValue=slot, wLength=1)

    def preset_get_name(self, slot: int) -> str:
        data = self._ctrl_in(REQ_PRESET_GET_NAME, wValue=slot, wLength=32)
        return bytes(data).split(b'\x00', 1)[0].decode('ascii', errors='replace')

    def preset_set_name(self, slot: int, name: str):
        buf = name.encode('ascii')[:31].ljust(32, b'\x00')
        self._ctrl_out(REQ_PRESET_SET_NAME, wValue=slot, data=buf)

    def preset_get_dir(self) -> bytes:
        return bytes(self._ctrl_in(REQ_PRESET_GET_DIR, wLength=64))

    def preset_set_startup(self, mode: int, slot: int):
        self._ctrl_out(REQ_PRESET_SET_STARTUP, data=struct.pack('<BB', mode, slot))

    def preset_get_startup(self) -> dict:
        data = self._ctrl_in(REQ_PRESET_GET_STARTUP, wLength=3)
        return {"mode": int(data[0]), "slot": int(data[1]), "last_active": int(data[2])}

    def preset_set_include_pins(self, include: bool):
        self._ctrl_out(REQ_PRESET_SET_INCLUDE_PINS, data=bytes([int(include)]))

    def preset_get_include_pins(self) -> bool:
        return bool(self._ctrl_in(REQ_PRESET_GET_INCLUDE_PINS, wLength=1)[0])

    def preset_get_active(self) -> int:
        return int(self._ctrl_in(REQ_PRESET_GET_ACTIVE, wLength=1)[0])

    def set_channel_name(self, channel: int, name: str):
        buf = name.encode('ascii')[:31].ljust(32, b'\x00')
        self._ctrl_out(REQ_SET_CHANNEL_NAME, wValue=channel, data=buf)

    def get_channel_name(self, channel: int) -> str:
        data = self._ctrl_in(REQ_GET_CHANNEL_NAME, wValue=channel, wLength=32)
        return bytes(data).split(b'\x00', 1)[0].decode('ascii', errors='replace')

    # ── Bulk Parameters ────────────────────────────────────────────────

    def get_all_params(self) -> bytes:
        """Read entire DSP state (~2896 bytes)."""
        return bytes(self._ctrl_in(REQ_GET_ALL_PARAMS, wLength=BULK_PARAMS_SIZE))

    def set_all_params(self, data: bytes):
        """Write entire DSP state."""
        self._ctrl_out(REQ_SET_ALL_PARAMS, data=data)

    # ── Buffer Stats ───────────────────────────────────────────────────

    def get_buffer_stats(self) -> bytes:
        return bytes(self._ctrl_in(REQ_GET_BUFFER_STATS, wLength=64))

    def reset_buffer_stats(self):
        self._ctrl_in(REQ_RESET_BUFFER_STATS, wLength=1)

    def get_usb_error_stats(self) -> bytes:
        return bytes(self._ctrl_in(REQ_GET_USB_ERROR_STATS, wLength=24))

    def reset_usb_error_stats(self):
        self._ctrl_in(REQ_RESET_USB_ERROR_STATS, wLength=1)

    # ── Volume Leveller ────────────────────────────────────────────────

    def get_leveller_enable(self) -> bool:
        return bool(self._ctrl_in(REQ_GET_LEVELLER_ENABLE, wLength=1)[0])

    def set_leveller_enable(self, on: bool):
        self._ctrl_out(REQ_SET_LEVELLER_ENABLE, data=bytes([int(on)]))

    def get_leveller_amount(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_LEVELLER_AMOUNT, wLength=4))[0]

    def set_leveller_amount(self, val: float):
        self._ctrl_out(REQ_SET_LEVELLER_AMOUNT, data=struct.pack('<f', val))

    def get_leveller_speed(self) -> int:
        return int(self._ctrl_in(REQ_GET_LEVELLER_SPEED, wLength=1)[0])

    def set_leveller_speed(self, speed: int):
        self._ctrl_out(REQ_SET_LEVELLER_SPEED, data=bytes([speed]))

    def get_leveller_max_gain(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_LEVELLER_MAX_GAIN, wLength=4))[0]

    def set_leveller_max_gain(self, db: float):
        self._ctrl_out(REQ_SET_LEVELLER_MAX_GAIN, data=struct.pack('<f', db))

    def get_leveller_lookahead(self) -> bool:
        return bool(self._ctrl_in(REQ_GET_LEVELLER_LOOKAHEAD, wLength=1)[0])

    def set_leveller_lookahead(self, on: bool):
        self._ctrl_out(REQ_SET_LEVELLER_LOOKAHEAD, data=bytes([int(on)]))

    def get_leveller_gate(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_LEVELLER_GATE, wLength=4))[0]

    def set_leveller_gate(self, db: float):
        self._ctrl_out(REQ_SET_LEVELLER_GATE, data=struct.pack('<f', db))

    # ── I2S ────────────────────────────────────────────────────────────

    def get_output_type(self, slot: int) -> int:
        return int(self._ctrl_in(REQ_GET_OUTPUT_TYPE, wValue=slot, wLength=1)[0])

    def set_output_type(self, slot: int, otype: int):
        """Returns status code (0=success)."""
        wValue = (otype << 8) | slot
        return int(self._ctrl_in(REQ_SET_OUTPUT_TYPE, wValue=wValue, wLength=1)[0])

    def get_i2s_bck_pin(self) -> int:
        return int(self._ctrl_in(REQ_GET_I2S_BCK_PIN, wLength=1)[0])

    def set_i2s_bck_pin(self, pin: int):
        """Returns status code (0=success)."""
        return int(self._ctrl_in(REQ_SET_I2S_BCK_PIN, wValue=pin, wLength=1)[0])
    def get_mck_enable(self) -> bool:
        return bool(self._ctrl_in(REQ_GET_MCK_ENABLE, wLength=1)[0])

    def set_mck_enable(self, on: bool):
        """Returns status code (0=success)."""
        return int(self._ctrl_in(REQ_SET_MCK_ENABLE, wValue=int(on), wLength=1)[0])

    def get_mck_pin(self) -> int:
        return int(self._ctrl_in(REQ_GET_MCK_PIN, wLength=1)[0])

    def set_mck_pin(self, pin: int):
        """Returns status code (0=success)."""
        return int(self._ctrl_in(REQ_SET_MCK_PIN, wValue=pin, wLength=1)[0])

    def get_mck_multiplier(self) -> int:
        return int(self._ctrl_in(REQ_GET_MCK_MULTIPLIER, wLength=1)[0])

    def set_mck_multiplier(self, mult: int):
        """Returns status code (0=success). mult=0 for 128x, 1 for 256x."""
        return int(self._ctrl_in(REQ_SET_MCK_MULTIPLIER, wValue=mult, wLength=1)[0])

    # ── Master Volume ──────────────────────────────────────────────────

    def get_master_volume(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_MASTER_VOLUME, wLength=4))[0]

    def set_master_volume(self, db: float):
        self._ctrl_out(REQ_SET_MASTER_VOLUME, data=struct.pack('<f', db))

    def get_master_volume_mode(self) -> int:
        return int(self._ctrl_in(REQ_GET_MASTER_VOLUME_MODE, wLength=1)[0])

    def set_master_volume_mode(self, mode: int):
        self._ctrl_out(REQ_SET_MASTER_VOLUME_MODE, data=bytes([mode]))

    def save_master_volume(self):
        self._ctrl_in(REQ_SAVE_MASTER_VOLUME, wLength=1)

    def get_saved_master_volume(self) -> float:
        return struct.unpack('<f', self._ctrl_in(REQ_GET_SAVED_MASTER_VOLUME, wLength=4))[0]

    # ── Status / Telemetry ─────────────────────────────────────────────

    def get_status(self, wValue: int) -> bytes:
        """Read a status field. wValue selects the field (see REQ_GET_STATUS docs)."""
        # wValue=9 returns NUM_CHANNELS*2 + 4 bytes (RP2040=18, RP2350=26)
        wLength = 26 if wValue == 9 else 4
        return bytes(self._ctrl_in(REQ_GET_STATUS, wValue=wValue, wLength=wLength))

    def get_peaks_and_cpu(self) -> dict:
        """wValue=9: all peaks + CPU loads in one call."""
        data = self.get_status(9)
        # 12 bytes: peaks[0..4] as uint16, clip_hi, clip_lo, cpu0, cpu1
        # Exact layout depends on NUM_CHANNELS
        return {"raw": data.hex()}

    # ── Save / Load / Reset ────────────────────────────────────────────

    def save_params(self):
        self._ctrl_in(REQ_SAVE_PARAMS, wLength=1)

    def load_params(self):
        self._ctrl_in(REQ_LOAD_PARAMS, wLength=1)

    def factory_reset(self):
        self._ctrl_in(REQ_FACTORY_RESET, wLength=1)

    # ── Firmware Update ────────────────────────────────────────────────

    def enter_bootloader(self):
        """Reboot device into UF2 bootloader. Device will disconnect."""
        try:
            self._ctrl_in(REQ_ENTER_BOOTLOADER, wLength=1)
        except usb.core.USBError:
            pass  # Expected — device disconnects

    # ── Device Discovery ───────────────────────────────────────────────

    @staticmethod
    def find_all() -> list:
        """Find all connected DSPi devices. Returns list of usb.core.Device."""
        return list(usb.core.find(find_all=True, idVendor=VENDOR_ID, idProduct=PRODUCT_ID))

    @staticmethod
    def open_first() -> 'DSPiDevice':
        """Open the first DSPi device found. Raises if none connected."""
        dev = usb.core.find(idVendor=VENDOR_ID, idProduct=PRODUCT_ID)
        if dev is None:
            raise RuntimeError("No DSPi device found (VID=%04X PID=%04X)" % (VENDOR_ID, PRODUCT_ID))
        dspi = DSPiDevice(dev)
        dspi.connect()
        return dspi

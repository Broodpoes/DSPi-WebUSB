#!/usr/bin/env python3
"""
DSPi Bridge — WebSocket bridge between browser and DSPi USB device.

Serves the web app static files and exposes a JSON-RPC-like WebSocket API
that translates browser commands into USB vendor control transfers.

Usage:
    python bridge.py [--port 8765] [--static ../app]
"""

import asyncio
import json
import os
import sys
import struct
import logging
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from aiohttp import web, WSMsgType

# Add this directory to path for usb_protocol import
sys.path.insert(0, os.path.dirname(__file__))
from usb_protocol import DSPiDevice

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dspi-bridge")

# ── Global Device State ─────────────────────────────────────────────────────

_device: DSPiDevice | None = None
_meter_task: asyncio.Task | None = None
_ws_clients: set[web.WebSocketResponse] = set()
_usb_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="usb")


def _connect_device():
    """Try to connect to a DSPi device."""
    global _device
    try:
        _device = DSPiDevice.open_first()
        platform = _device.get_platform()
        serial = _device.get_serial()
        log.info("Connected to DSPi: platform=%s serial=%s",
                 "RP2350" if platform == 1 else "RP2040", serial)
        return True
    except Exception as e:
        log.warning("No DSPi device found: %s", e)
        _device = None
        return False


def _disconnect_device():
    global _device
    if _device:
        try:
            _device.disconnect()
        except Exception:
            pass
        _device = None


# ── Command Dispatch ────────────────────────────────────────────────────────

def _float_from_bytes(data: bytes, offset=0) -> float:
    return struct.unpack_from('<f', data, offset)[0]


def _handle_command(method: str, params: dict) -> any:
    """Execute a single command on the device. Returns result or raises."""
    if _device is None:
        raise RuntimeError("No device connected")

    d = _device  # shorthand

    # ── Device Info ─────────────────────────────────────────
    if method == "get_info":
        return {
            "platform": d.get_platform(),
            "serial": d.get_serial(),
        }

    # ── EQ ──────────────────────────────────────────────────
    elif method == "get_eq_param":
        return d.get_eq_param(params["channel"], params["band"])
    elif method == "set_eq_param":
        d.set_eq_param(
            int(params["channel"]), int(params["band"]), int(params["type"]),
            float(params.get("freq") or 1000.0),
            float(params.get("Q") or 0.707),
            float(params.get("gain_db") or 0.0))
        return "ok"
    elif method == "get_bypass":
        return d.get_bypass()
    elif method == "set_bypass":
        d.set_bypass(params["on"])
        return "ok"

    # ── Preamp ──────────────────────────────────────────────
    elif method == "get_preamp_ch":
        return {"channel": params["channel"], "db": d.get_preamp_ch(params["channel"])}
    elif method == "set_preamp_ch":
        d.set_preamp_ch(params["channel"], params["db"])
        return "ok"

    # ── Delays ──────────────────────────────────────────────
    elif method == "get_delay":
        return {"channel": params["channel"], "ms": d.get_delay(params["channel"])}
    elif method == "set_delay":
        d.set_delay(params["channel"], params["ms"])
        return "ok"

    # ── Channel Gain/Mute ───────────────────────────────────
    elif method == "get_channel_gain":
        return {"channel": params["channel"], "db": d.get_channel_gain(params["channel"])}
    elif method == "set_channel_gain":
        d.set_channel_gain(params["channel"], params["db"])
        return "ok"
    elif method == "get_channel_mute":
        return {"channel": params["channel"], "muted": d.get_channel_mute(params["channel"])}
    elif method == "set_channel_mute":
        d.set_channel_mute(params["channel"], params["muted"])
        return "ok"

    # ── Loudness ────────────────────────────────────────────
    elif method == "get_loudness":
        return {"enabled": d.get_loudness(),
                "ref_spl": d.get_loudness_ref(),
                "intensity": d.get_loudness_intensity()}
    elif method == "set_loudness":
        d.set_loudness(params["enabled"])
        return "ok"
    elif method == "set_loudness_ref":
        d.set_loudness_ref(params["spl"])
        return "ok"
    elif method == "set_loudness_intensity":
        d.set_loudness_intensity(params["pct"])
        return "ok"

    # ── Crossfeed ───────────────────────────────────────────
    elif method == "get_crossfeed":
        return {"enabled": d.get_crossfeed(),
                "preset": d.get_crossfeed_preset(),
                "freq": d.get_crossfeed_freq(),
                "feed": d.get_crossfeed_feed(),
                "itd": d.get_crossfeed_itd()}
    elif method == "set_crossfeed":
        d.set_crossfeed(params["enabled"])
        return "ok"
    elif method == "set_crossfeed_preset":
        d.set_crossfeed_preset(params["preset"])
        return "ok"
    elif method == "set_crossfeed_freq":
        d.set_crossfeed_freq(params["hz"])
        return "ok"
    elif method == "set_crossfeed_feed":
        d.set_crossfeed_feed(params["db"])
        return "ok"
    elif method == "set_crossfeed_itd":
        d.set_crossfeed_itd(params["on"])
        return "ok"

    # ── Matrix Mixer ────────────────────────────────────────
    elif method == "get_matrix_route":
        return d.get_matrix_route(params["input"], params["output"])
    elif method == "set_matrix_route":
        d.set_matrix_route(params["input"], params["output"],
                           params["enabled"], params["phase_invert"], params["gain_db"])
        return "ok"
    elif method == "get_output_enable":
        return {"output": params["output"], "enabled": d.get_output_enable(params["output"])}
    elif method == "set_output_enable":
        d.set_output_enable(params["output"], params["enabled"])
        return "ok"
    elif method == "get_output_gain":
        return {"output": params["output"], "db": d.get_output_gain(params["output"])}
    elif method == "set_output_gain":
        d.set_output_gain(params["output"], params["db"])
        return "ok"
    elif method == "get_output_mute":
        return {"output": params["output"], "muted": d.get_output_mute(params["output"])}
    elif method == "set_output_mute":
        d.set_output_mute(params["output"], params["muted"])
        return "ok"
    elif method == "get_output_delay":
        return {"output": params["output"], "ms": d.get_output_delay(params["output"])}
    elif method == "set_output_delay":
        d.set_output_delay(params["output"], params["ms"])
        return "ok"

    # ── Presets ─────────────────────────────────────────────
    elif method == "preset_save":
        d.preset_save(params["slot"])
        return "ok"
    elif method == "preset_load":
        d.preset_load(params["slot"])
        return "ok"
    elif method == "preset_delete":
        d.preset_delete(params["slot"])
        return "ok"
    elif method == "preset_get_name":
        return {"slot": params["slot"], "name": d.preset_get_name(params["slot"])}
    elif method == "preset_set_name":
        d.preset_set_name(params["slot"], params["name"])
        return "ok"
    elif method == "preset_get_dir":
        return {"raw": d.preset_get_dir().hex()}
    elif method == "preset_set_startup":
        d.preset_set_startup(params["mode"], params["slot"])
        return "ok"
    elif method == "preset_get_startup":
        return d.preset_get_startup()
    elif method == "preset_set_include_pins":
        d.preset_set_include_pins(params["include"])
        return "ok"
    elif method == "preset_get_include_pins":
        return {"include_pins": d.preset_get_include_pins()}
    elif method == "preset_get_active":
        return {"slot": d.preset_get_active()}
    elif method == "get_channel_name":
        return {"channel": params["channel"], "name": d.get_channel_name(params["channel"])}
    elif method == "set_channel_name":
        d.set_channel_name(params["channel"], params["name"])
        return "ok"

    # ── Bulk Params ─────────────────────────────────────────
    elif method == "get_all_params":
        import base64
        return {"data_b64": base64.b64encode(d.get_all_params()).decode()}
    elif method == "set_all_params":
        import base64
        d.set_all_params(base64.b64decode(params["data_b64"]))
        return "ok"

    # ── Master Volume ───────────────────────────────────────
    elif method == "get_master_volume":
        return {"db": d.get_master_volume()}
    elif method == "set_master_volume":
        d.set_master_volume(params["db"])
        return "ok"
    elif method == "get_master_volume_mode":
        return {"mode": d.get_master_volume_mode()}
    elif method == "set_master_volume_mode":
        d.set_master_volume_mode(params["mode"])
        return "ok"
    elif method == "save_master_volume":
        d.save_master_volume()
        return "ok"
    elif method == "get_saved_master_volume":
        return {"db": d.get_saved_master_volume()}

    # ── Volume Leveller ─────────────────────────────────────
    elif method == "get_leveller":
        return {"enabled": d.get_leveller_enable(),
                "amount": d.get_leveller_amount(),
                "speed": d.get_leveller_speed(),
                "max_gain": d.get_leveller_max_gain(),
                "lookahead": d.get_leveller_lookahead(),
                "gate": d.get_leveller_gate()}
    elif method == "set_leveller_enable":
        d.set_leveller_enable(params["on"])
        return "ok"
    elif method == "set_leveller_amount":
        d.set_leveller_amount(params["val"])
        return "ok"
    elif method == "set_leveller_speed":
        d.set_leveller_speed(params["speed"])
        return "ok"
    elif method == "set_leveller_max_gain":
        d.set_leveller_max_gain(params["db"])
        return "ok"
    elif method == "set_leveller_lookahead":
        d.set_leveller_lookahead(params["on"])
        return "ok"
    elif method == "set_leveller_gate":
        d.set_leveller_gate(params["db"])
        return "ok"

    # ── I2S / Output Config ─────────────────────────────────
    elif method == "get_output_type":
        return {"slot": params["slot"], "type": d.get_output_type(params["slot"])}
    elif method == "set_output_type":
        status = d.set_output_type(params["slot"], params["type"])
        return {"status": status}
    elif method == "get_i2s_config":
        return {"bck_pin": d.get_i2s_bck_pin(),
                "mck_enabled": d.get_mck_enable(),
                "mck_pin": d.get_mck_pin(),
                "mck_multiplier": d.get_mck_multiplier()}
    elif method == "set_i2s_bck_pin":
        status = d.set_i2s_bck_pin(params["pin"])
        return {"status": status}
    elif method == "set_mck_enable":
        status = d.set_mck_enable(params["on"])
        return {"status": status}
    elif method == "set_mck_pin":
        status = d.set_mck_pin(params["pin"])
        return {"status": status}
    elif method == "set_mck_multiplier":
        status = d.set_mck_multiplier(params["mult"])
        return {"status": status}

    # ── Diagnostics ─────────────────────────────────────────
    elif method == "get_peaks":
        data = d.get_status(9)
        return {"raw": data.hex()}
    elif method == "get_status":
        data = d.get_status(params["wValue"])
        return {"raw": data.hex()}
    elif method == "clear_clips":
        flags = d.clear_clips()
        return {"clip_flags": flags}
    elif method == "get_core1_mode":
        return {"mode": d.get_core1_mode()}

    elif method == "get_core1_conflict":
        output = params.get("output", 0)
        return {"conflict": d.get_core1_conflict(output)}
    elif method == "get_output_pin":
        return {"output": params["output"], "pin": d.get_output_pin(params["output"])}
    elif method == "set_output_pin":
        return {"status": d.set_output_pin(params["output"], params["pin"])}
    elif method == "get_buffer_stats":
        return {"raw": d.get_buffer_stats().hex()}
    elif method == "reset_buffer_stats":
        d.reset_buffer_stats()
        return "ok"
    elif method == "get_usb_error_stats":
        return {"raw": d.get_usb_error_stats().hex()}
    elif method == "reset_usb_error_stats":
        d.reset_usb_error_stats()
        return "ok"

    # ── Save/Load/Reset ─────────────────────────────────────
    elif method == "save_params":
        d.save_params()
        return "ok"
    elif method == "load_params":
        d.load_params()
        return "ok"
    elif method == "factory_reset":
        d.factory_reset()
        return "ok"
    elif method == "enter_bootloader":
        d.enter_bootloader()
        _disconnect_device()
        return "ok"

    else:
        raise ValueError(f"Unknown method: {method}")


# ── Metering Background Task ────────────────────────────────────────────────

async def _meter_loop():
    """Push peak/clip/CPU data to connected WebSocket clients at ~10Hz."""
    loop = asyncio.get_event_loop()
    while _device:
        try:
            data = await loop.run_in_executor(_usb_executor, _device.get_status, 9)
            msg = json.dumps({"type": "meters", "raw": data.hex()})
            dead = set()
            for ws in _ws_clients:
                try:
                    await ws.send_str(msg)
                except Exception:
                    dead.add(ws)
            _ws_clients -= dead
        except Exception as e:
            log.debug("Meter read error: %s", e)
        await asyncio.sleep(0.1)


def _start_metering():
    global _meter_task
    if _meter_task is None or _meter_task.done():
        _meter_task = asyncio.ensure_future(_meter_loop())


def _stop_metering():
    global _meter_task
    if _meter_task and not _meter_task.done():
        _meter_task.cancel()
        _meter_task = None


# ── WebSocket Handler ───────────────────────────────────────────────────────

async def ws_handler(request: web.Request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    _ws_clients.add(ws)

    log.info("WebSocket client connected (%d total)", len(_ws_clients))

    if _device and (not _meter_task or _meter_task.done()):
        _start_metering()

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    req = json.loads(msg.data)
                    req_id = req.get("id")
                    method = req.get("method", "")
                    params = req.get("params", {})

                    loop = asyncio.get_event_loop()
                    result = await loop.run_in_executor(_usb_executor, _handle_command, method, params)
                    await ws.send_str(json.dumps({"id": req_id, "result": result}))

                except Exception as e:
                    log.warning("Command error: %s", e)
                    await ws.send_str(json.dumps({
                        "id": req.get("id"),
                        "error": {"message": str(e)}
                    }))

            elif msg.type == WSMsgType.ERROR:
                log.error("WebSocket error: %s", ws.exception())
    finally:
        _ws_clients.discard(ws)
        if not _ws_clients:
            _stop_metering()
        log.info("WebSocket client disconnected (%d remaining)", len(_ws_clients))

    return ws


# ── HTTP REST endpoints ─────────────────────────────────────────────────────

async def api_status(request: web.Request):
    """Quick device status check."""
    if _device is None:
        return web.json_response({"connected": False})
    try:
        return web.json_response({
            "connected": True,
            "platform": _device.get_platform(),
            "serial": _device.get_serial(),
        })
    except Exception as e:
        return web.json_response({"connected": False, "error": str(e)})


async def api_connect(request: web.Request):
    """Attempt to connect to a DSPi device."""
    loop = asyncio.get_event_loop()
    ok = await loop.run_in_executor(_usb_executor, _connect_device)
    if ok:
        _start_metering()
        return web.json_response({"connected": True})
    return web.json_response({"connected": False, "error": "No device found"}, status=404)


async def api_disconnect(request: web.Request):
    """Disconnect from device."""
    _stop_metering()
    _disconnect_device()
    return web.json_response({"connected": False})


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="DSPi USB-Web Bridge")
    parser.add_argument("--port", type=int, default=8765, help="HTTP port (default: 8765)")
    parser.add_argument("--static", type=str, default=None,
                        help="Path to static web app files (default: ../app relative to this script)")
    parser.add_argument("--no-auto", action="store_true", help="Don't auto-connect at startup")
    args = parser.parse_args()

    static_dir = args.static or os.path.join(os.path.dirname(__file__), '..', 'app')
    static_dir = os.path.abspath(static_dir)

    app = web.Application()
    app.router.add_get("/api/status", api_status)
    app.router.add_post("/api/connect", api_connect)
    app.router.add_post("/api/disconnect", api_disconnect)
    app.router.add_get("/ws", ws_handler)

    if os.path.isdir(static_dir):
        # Serve index.html for root, and all static assets from the app dir.
        # We use add_static with show_index=False — aiohttp will serve files
        # under the prefix, and we also add a root handler for index.html.
        app.router.add_static("/s", static_dir, name="static",
                               follow_symlinks=True)

        async def serve_index(request):
            return web.FileResponse(os.path.join(static_dir, 'index.html'))
        app.router.add_get("/", serve_index)

        # Also serve asset files at root-level paths so relative URLs work
        # (e.g. /style.css, /transport.js) without the /s/ prefix
        def _make_file_handler(filepath):
            async def _handler(request):
                return web.FileResponse(filepath)
            return _handler
        for fname in os.listdir(static_dir):
            fpath = os.path.join(static_dir, fname)
            if os.path.isfile(fpath) and not fname.startswith('.'):
                app.router.add_get(f"/{fname}", _make_file_handler(fpath))

        log.info("Serving static files from %s", static_dir)
    else:
        log.warning("Static directory %s not found; web UI will not be served", static_dir)
    if not args.no_auto:
        async def _auto_connect(app):
            await asyncio.get_event_loop().run_in_executor(_usb_executor, _connect_device)
            if _device:
                _start_metering()
        app.on_startup.append(_auto_connect)

    log.info("Starting DSPi bridge on http://localhost:%d", args.port)
    web.run_app(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()

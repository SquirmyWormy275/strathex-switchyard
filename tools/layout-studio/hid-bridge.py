"""Private stdio HID transport for verified configuration interfaces only.

Wire facts: Vial/QMK Raw HID and Tom Wong-Cornall ibm-capsense-usb 0.9.0.
No bootloader, EEPROM reset, calibration or solenoid command is exposed here.
The parent owns protocol validation and reviewed configuration transactions.
"""
import base64
import hashlib
import json
import lzma
import sys

import hid


def inventory():
    result = []
    for device in hid.enumerate():
        original = device["vendor_id"] == 0x0481 and device["product_id"] == 0x0002 and (device["interface_number"] == 1 or (device["interface_number"] == -1 and device.get("usage") != 6))
        vial = device.get("usage_page") == 0xFF60 and device.get("usage") == 0x61
        if not original and not vial:
            continue
        identity = {key: device.get(key) for key in ["vendor_id", "product_id", "serial_number", "interface_number", "usage_page", "usage"]}
        identity["path"] = base64.b64encode(device["path"]).decode()
        stable = {key: value for key, value in identity.items() if key != "path"}
        if not identity.get("serial_number"):
            stable["path"] = identity["path"]
        identity["id"] = hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()
        identity["candidateProtocol"] = "original-xwhatsit-0.9" if original else "vial"
        identity["name"] = str(device.get("product_string") or "Configuration interface")[:120]
        result.append(identity)
    return result


device = None
identity = None
for line in sys.stdin.buffer:
    if len(line) > 300000:
        break
    request = json.loads(line)
    try:
        method = request["method"]
        if method == "list":
            result = inventory()
        elif method == "open":
            candidates = [d for d in inventory() if d["id"] == request["deviceId"]]
            if len(candidates) != 1:
                raise ValueError("The exact configuration interface disconnected or changed")
            identity = candidates[0]
            if device:
                device.close()
            device = hid.device()
            device.open_path(base64.b64decode(identity["path"]))
            result = identity
        elif method == "exchange":
            if device is None or not any(d["id"] == identity["id"] for d in inventory()):
                raise ValueError("The exact device is unavailable")
            packet = request["packet"]
            size = 8 if identity["candidateProtocol"].startswith("original") else 32
            if len(packet) != size or any(not isinstance(x, int) or x < 0 or x > 255 for x in packet):
                raise ValueError("Invalid fixed-size packet")
            device.write(bytes([0] + packet))
            result = list(device.read(size, 1500)) if request.get("read", True) else []
            if request.get("read", True) and len(result) != size:
                raise ValueError("The configuration read timed out or was truncated")
        elif method == "read":
            if device is None:
                raise ValueError("Device is closed")
            size = 8 if identity["candidateProtocol"].startswith("original") else 32
            result = list(device.read(size, 1500))
            if len(result) != size:
                raise ValueError("The configuration stream timed out")
        elif method == "decode-definition":
            raw = base64.b64decode(request["data"], validate=True)
            if len(raw) > 65536:
                raise ValueError("Definition is too large")
            decoder = lzma.LZMADecompressor(memlimit=64 * 1024 * 1024)
            decoded = decoder.decompress(raw, max_length=262145)
            if len(decoded) > 262144 or not decoder.eof:
                raise ValueError("Definition decompression exceeds the supported limit")
            result = json.loads(decoded)
        elif method == "close":
            if device:
                device.close()
            device = None
            result = {"closed": True}
        else:
            raise ValueError("Unsupported private transport operation")
        print(json.dumps({"id": request["id"], "result": result}), flush=True)
    except Exception:
        print(json.dumps({"id": request["id"], "error": "Device transport unavailable, changed, locked or returned an unsupported response; no successful write is claimed."}), flush=True)
if device:
    device.close()

"""Explicit private-bus Linux helper acceptance; never opens a browser."""
import json
import hashlib
import os
import re
import signal
import subprocess
import sys
import threading
from pathlib import Path
import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

mode = sys.argv[1]
assert mode in ("accepted", "cancelled", "rejected", "early-response", "stop")
connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
connection.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName", GLib.Variant("(su)", ("org.freedesktop.portal.Desktop", 4)), GLib.VariantType.new("(u)"), Gio.DBusCallFlags.NONE, 5000, None)
info = Gio.DBusNodeInfo.new_for_xml('<node><interface name="org.freedesktop.portal.OpenURI"><method name="OpenURI"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method></interface></node>')
request_info = Gio.DBusNodeInfo.new_for_xml('<node><interface name="org.freedesktop.portal.Request"><method name="Close"/></interface></node>')
observed = {"requests": 0, "close": 0, "browserOpened": False}
loop = GLib.MainLoop()
process = None

def close(_conn, _sender, _path, _interface, _method, _parameters, invocation):
    observed["close"] += 1
    invocation.return_value(None)

def opened(_conn, sender, _path, _interface, _method, parameters, invocation):
    parent, uri, options = parameters.unpack()
    assert parent == "" and uri == "https://github.com/copilot" and options["ask"] is False
    assert re.fullmatch(r"switchyard_[a-f0-9]{32}", options["handle_token"])
    observed["requests"] += 1
    handle = "/org/freedesktop/portal/desktop/request/" + sender[1:].replace(".", "_") + "/" + options["handle_token"]
    connection.register_object(handle, request_info.interfaces[0], close, None, None)
    def respond():
        code = {"accepted": 0, "cancelled": 1, "rejected": 2, "early-response": 0}.get(mode)
        if code is not None:
            connection.emit_signal(sender, handle, "org.freedesktop.portal.Request", "Response", GLib.Variant("(ua{sv})", (code, {})))
        else:
            process.send_signal(signal.SIGTERM)
        return GLib.SOURCE_REMOVE
    if mode == "early-response":
        respond()
    invocation.return_value(GLib.Variant("(o)", (handle,)))
    if mode != "early-response":
        GLib.timeout_add(100 if mode == "stop" else 20, respond)

connection.register_object("/org/freedesktop/portal/desktop", info.interfaces[0], opened, None, None)
helper = Path(__file__).resolve().parents[1] / "client-portal.py"
process = subprocess.Popen([sys.executable, "-I", "-B", str(helper)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME")})
result = {}
def wait():
    output, errors = process.communicate(json.dumps({"schema": "switchyard-client-portal/v1", "id": "github-copilot-web", "targetSha256": hashlib.sha256(b"https://github.com/copilot").hexdigest()}).encode() + b"\n", timeout=15)
    result.update(code=process.returncode, output=output.decode(), errorBytes=len(errors))
    GLib.idle_add(loop.quit)
thread = threading.Thread(target=wait, daemon=True)
thread.start()
GLib.timeout_add_seconds(20, lambda: (process.kill(), loop.quit(), GLib.SOURCE_REMOVE)[-1])
loop.run()
thread.join(timeout=1)
assert result.get("code") == 0, result
value = json.loads(result["output"])
assert value["status"] == ("accepted" if mode == "early-response" else "outcome-unconfirmed" if mode == "stop" else mode), value
assert observed["requests"] == 1 and observed["close"] == (1 if mode == "stop" else 0), observed
assert value["applicationOpenedVerified"] is False and value["accountVerified"] is False and value["sessionIdentified"] is False
print(json.dumps({"mode": mode, "result": value, "observed": observed, "privateBus": True}))

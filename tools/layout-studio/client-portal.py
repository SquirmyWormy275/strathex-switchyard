"""One fixed HTTPS surface through OpenURI; keep its bus alive until Response."""
import json
import hashlib
import signal
import sys
import uuid

TARGETS = {
    "github-copilot-web": "https://github.com/copilot",
    "microsoft-365-copilot-web": "https://copilot.cloud.microsoft/",
    "cursor-cloud": "https://cursor.com/agents",
    "figma-web": "https://www.figma.com/",
}


def main():
    line = sys.stdin.buffer.readline(4097)
    if len(line) > 4096:
        raise ValueError("oversized request")
    request = json.loads(line)
    if set(request) != {"schema", "id", "targetSha256"} or request["schema"] != "switchyard-client-portal/v1" or request["id"] not in TARGETS or request["targetSha256"] != hashlib.sha256(TARGETS[request["id"]].encode("utf8")).hexdigest():
        raise ValueError("unsupported fixed surface")
    import gi
    gi.require_version("Gio", "2.0")
    from gi.repository import Gio, GLib

    connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    loop = GLib.MainLoop()
    handle = None
    outcome = {"status": "outcome-unconfirmed", "response": None}
    token = "switchyard_" + uuid.uuid4().hex
    expected = "/org/freedesktop/portal/desktop/request/" + connection.get_unique_name()[1:].replace(".", "_") + "/" + token
    handle = expected

    def response(_connection, _sender, path, _interface, _signal, parameters, _data):
        if path != handle:
            return
        code, _results = parameters.unpack()
        if code not in (0, 1, 2):
            return
        outcome.update(status={0: "accepted", 1: "cancelled", 2: "rejected"}[code], response=code)
        loop.quit()

    def close_request():
        if handle:
            try:
                connection.call_sync("org.freedesktop.portal.Desktop", handle, "org.freedesktop.portal.Request", "Close", None, None, Gio.DBusCallFlags.NONE, 2000, None)
            except GLib.Error:
                pass
        loop.quit()
        return GLib.SOURCE_REMOVE

    subscription = connection.signal_subscribe("org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request", "Response", None, None, Gio.DBusSignalFlags.NONE, response, None)
    try:
        reply = connection.call_sync("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.portal.OpenURI", "OpenURI", GLib.Variant("(ssa{sv})", ("", TARGETS[request["id"]], {"handle_token": GLib.Variant("s", token), "ask": GLib.Variant("b", False)})), GLib.VariantType.new("(o)"), Gio.DBusCallFlags.NONE, 10000, None)
        handle = reply.unpack()[0]
        if handle != expected:
            # A different returned path cannot inherit the expected identity.
            raise ValueError("portal request identity mismatch")
        GLib.timeout_add_seconds(30, close_request)
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, close_request)
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, close_request)
        if outcome["response"] is None:
            loop.run()
    finally:
        connection.signal_unsubscribe(subscription)
    print(json.dumps({"schema": "switchyard-client-portal-result/v1", "id": request["id"], **outcome, "applicationOpenedVerified": False, "accountVerified": False, "sessionIdentified": False}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No URI, account, environment or native bus exception is exposed.
        print("The fixed desktop portal request did not settle.", file=sys.stderr)
        sys.exit(2)

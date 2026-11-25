"""Python SDK for explicit application integrations, including LangChain."""
import hashlib
import hmac
import json
import time
import threading
import re
import inspect
import urllib.request
from urllib.parse import urlparse
from types import MappingProxyType


class SwitchyardAgent:
    def __init__(self, enrollment, *, on_sequence=None):
        if on_sequence is not None and (not callable(on_sequence) or inspect.iscoroutinefunction(on_sequence)):
            raise ValueError("Use a synchronous sequence persistence callback")
        # Sending always uses the enrollment validated here, even if the caller
        # subsequently changes its original dictionary.
        enrollment = MappingProxyType(dict(enrollment))
        self.enrollment = enrollment
        self._on_sequence = on_sequence
        self._persisting = False
        parsed = urlparse(enrollment["baseUrl"])
        if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1") or parsed.username or parsed.password or parsed.path != "/" or parsed.query or parsed.fragment:
            raise ValueError("Use an enrolled loopback workspace")
        self.sequence = enrollment.get("initialSequence", 0)
        if not isinstance(self.sequence, int) or isinstance(self.sequence, bool) or not 0 <= self.sequence < 2 ** 53 - 1 or not isinstance(enrollment.get("token"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", enrollment["token"]):
            raise ValueError("The SDK requires its exact private enrollment credential and sequence")
        self.session_id = None
        self.claims = {}
        self.lock = threading.RLock()

    def send(self, path, session_id, **fields):
        at = int(time.time() * 1000)
        with self.lock:
            if self._persisting:
                raise ValueError("The persistence callback cannot send SDK requests")
            if not isinstance(session_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", session_id) or self.sequence + 1 >= 2 ** 53:
                raise ValueError("Publish an exact ready session before polling or acknowledging")
            if path == "/agent/v2/poll" and len(self.claims) >= 64:
                raise ValueError("Resolve existing exact claims before polling more commands")
            self.sequence += 1
            # Consume the counter even if saving raises: storage may have
            # committed before reporting failure. No HTTP request is sent then.
            if self._on_sequence is not None:
                self._persisting = True
                try:
                    saved = self._on_sequence(self.sequence)
                    if inspect.isawaitable(saved):
                        if inspect.iscoroutine(saved):
                            saved.close()
                        raise ValueError("Use a synchronous sequence persistence callback")
                finally:
                    self._persisting = False
            body = {"schema": "switchyard-agent-message/v2", "compartment": self.enrollment["compartment"], "agentId": self.enrollment["agentId"], "sessionId": session_id, "sequence": self.sequence, "at": at, **fields}
            data = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
            key = self.enrollment["token"].encode()
            signature = hmac.new(key, b"SWITCHYARD-REQUEST-V2\nPOST\n" + path.encode() + b"\n" + data, hashlib.sha256).hexdigest()
            request = urllib.request.Request(self.enrollment["baseUrl"].rstrip("/") + path, data, {"Content-Type": "application/json", "X-Switchyard-Signature": signature}, method="POST")
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *_):
                    return None
            with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=15) as response:
                raw = response.read(128 * 1024 + 1)
                if len(raw) > 128 * 1024:
                    raise ValueError("Agent response exceeded its bound")
                expected = hmac.new(key, b"SWITCHYARD-RESPONSE-V2\n" + str(response.status).encode() + b"\n" + path.encode() + b"\n" + raw, hashlib.sha256).hexdigest()
                if response.status != 200 or not hmac.compare_digest(response.headers.get("X-Switchyard-Response-Signature", ""), expected):
                    raise ValueError("The local server response failed authentication; no returned action will run and the request outcome is uncertain")
                value = json.loads(raw)
            if not isinstance(value, dict) or value.get("schema") != "switchyard-agent-response/v2" or value.get("requestSequence") != self.sequence or value.get("sessionId") != session_id or not isinstance(value.get("result"), dict):
                raise ValueError("Agent response scope does not match this request")
            result = value["result"]
            if path == "/agent/v2/poll":
                if "command" not in result:
                    raise ValueError("Agent polling response omitted its command contract")
                command = result.get("command")
                if command is not None and (not isinstance(command, dict) or command.get("sessionId") != session_id or command.get("intent") not in ["summon", "resume", "review", "handoff", "status", "cancel"] or not isinstance(command.get("id"), str) or not re.fullmatch(r"[a-f0-9-]{36}", command["id"]) or command.get("content") is not None and (not isinstance(command["content"], str) or len(command["content"]) > 12000)):
                    raise ValueError("Command is outside the exact session's supported contract")
                if command is not None:
                    if len(self.claims) >= 64:
                        raise ValueError("Resolve existing exact claims before polling more commands")
                    self.claims[command["id"]] = session_id
            return result

    def publish(self, session_id, status):
        with self.lock:
            result = self.send("/agent/v2/event", session_id, event={"status": status})
            self.session_id = session_id
            return result

    def poll(self):
        with self.lock:
            return self.send("/agent/v2/poll", self.session_id)

    def acknowledge(self, command_id, outcome):
        with self.lock:
            result = self.send("/agent/v2/ack", self.claims.get(command_id, self.session_id), commandId=command_id, outcome=outcome)
            self.claims.pop(command_id, None)
            return result

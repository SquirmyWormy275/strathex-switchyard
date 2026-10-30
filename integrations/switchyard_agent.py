"""Python SDK for explicit application integrations, including LangChain."""
import hashlib
import hmac
import json
import time
import urllib.request
from urllib.parse import urlparse


class SwitchyardAgent:
    def __init__(self, enrollment):
        self.enrollment = enrollment
        parsed = urlparse(enrollment["baseUrl"])
        if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1") or parsed.username or parsed.password:
            raise ValueError("Use an enrolled loopback workspace")
        self.sequence = enrollment.get("initialSequence", 0)

    def send(self, path, **fields):
        self.sequence += 1
        body = {"schema": "switchyard-agent-message/v1", "compartment": self.enrollment["compartment"], "agentId": self.enrollment["agentId"], "sequence": self.sequence, "at": int(time.time() * 1000), **fields}
        data = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
        signature = hmac.new(self.enrollment["token"].encode(), data, hashlib.sha256).hexdigest()
        request = urllib.request.Request(self.enrollment["baseUrl"].rstrip("/") + path, data, {"Content-Type": "application/json", "X-Switchyard-Signature": signature}, method="POST")
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_):
                return None
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            return json.loads(response.read(65536))

    def publish(self, session_id, status):
        return self.send("/agent/v1/event", event={"sessionId": session_id, "status": status})

    def poll(self):
        return self.send("/agent/v1/poll")

    def acknowledge(self, command_id, outcome):
        return self.send("/agent/v1/ack", commandId=command_id, outcome=outcome)

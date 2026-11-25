"""A real LangChain Runnable emits lifecycle events and handles bounded intents.

Uses synthetic text and RunnableLambda; it requires no external model account.
Run with the suite's enrollment JSON on stdin, after installing langchain-core.
"""
import json
import signal
import sys
import time
import uuid
import os
import threading
from pathlib import Path

from langchain_core.runnables import RunnableLambda

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "integrations"))
from switchyard_agent import SwitchyardAgent

first_line = sys.stdin.buffer.readline(8193)
if len(first_line) > 8192:
    raise ValueError("Enrollment exceeds its bound")
try:
    enrollment = json.loads(first_line)
except ValueError:
    remaining = sys.stdin.buffer.read(8193 - len(first_line))
    if len(first_line) + len(remaining) > 8192:
        raise ValueError("Enrollment exceeds its bound")
    enrollment = json.loads(first_line + remaining)
if enrollment.get("supervised") is True:
    # Only this bundled synthetic process is owned. EOF also covers SIGKILL of
    # its parent; exit immediately even if a loopback request is in flight.
    def watch_owner():
        sys.stdin.buffer.read(1)
        os._exit(0)
    threading.Thread(target=watch_owner, daemon=True).start()
sdk = SwitchyardAgent(enrollment)
session_id = str(uuid.uuid4())
running = True


def stop(*_):
    global running
    running = False


def review(value):
    sdk.publish(session_id, "busy")
    result = {"reviewed": value.upper(), "scope": "synthetic local text only"}
    sdk.publish(session_id, "idle")
    return result


for sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, stop)
pipeline = RunnableLambda(review)
sdk.publish(session_id, "ready")
while running:
    command = sdk.poll().get("command")
    if command:
        if command["sessionId"] != session_id:
            raise ValueError("Wrong exact session")
        if command["intent"] in ("review", "resume", "handoff", "summon", "status"):
            pipeline.invoke("synthetic workflow evidence")
            sdk.acknowledge(command["id"], "completed")
        elif command["intent"] == "cancel":
            sdk.acknowledge(command["id"], "cancelled")
    time.sleep(1.5)
sdk.publish(session_id, "stopped")

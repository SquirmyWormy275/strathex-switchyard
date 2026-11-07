"""Verify the optional runtime without opening HID or contacting providers."""
import importlib.metadata
import json
import re
import sys
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

if sys.version.split()[0] != "3.12.14":
    raise RuntimeError("The optional runtime requires Python 3.12.14")
raw = Path(sys.argv[1]).read_text().replace("\\\n", " ")
expected = {}
for line in raw.splitlines():
    line = re.sub(r"--hash=sha256:[a-f0-9]{64}", "", line).strip()
    if not line or line.startswith("#"):
        continue
    requirement = Requirement(line)
    if requirement.marker is not None and not requirement.marker.evaluate():
        continue
    pins = list(requirement.specifier)
    if len(pins) != 1 or pins[0].operator != "==" or "*" in pins[0].version:
        raise RuntimeError("An optional dependency is not exactly pinned")
    name = canonicalize_name(requirement.name)
    if importlib.metadata.version(name) != pins[0].version:
        raise RuntimeError("An optional dependency differs from the lock")
    expected[name] = pins[0].version

import av
import hid
from faster_whisper import WhisperModel
from langchain_core.runnables import RunnableLambda

if RunnableLambda(lambda value: value + 1).invoke(1) != 2:
    raise RuntimeError("The local LangChain Runnable did not execute")
model_loaded = False
if len(sys.argv) > 2:
    model = WhisperModel(sys.argv[2], device="cpu", compute_type="int8", cpu_threads=1, local_files_only=True)
    model_loaded = True
installed = {canonicalize_name(d.metadata["Name"]) for d in importlib.metadata.distributions()}
print(json.dumps({"schema": "switchyard-runtime-probe/v1", "python": sys.version.split()[0],
                  "packages": expected, "extraDistributions": sorted(installed - expected.keys()),
                  "imports": ["av", "hid", "faster_whisper", "langchain_core"],
                  "modelLoaded": model_loaded, "hidOpened": False, "providerContacted": False}))

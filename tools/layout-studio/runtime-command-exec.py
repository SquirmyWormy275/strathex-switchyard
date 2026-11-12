"""Fixed Linux exec boundary preserving one reviewed read-only tool descriptor."""
import fcntl
import hashlib
import json
import os
import stat
import sys

guardian, executable, arguments_json, expected_digest = sys.argv[1:]
if sys.platform != "linux" or not guardian.isdecimal() or os.getppid() != int(guardian) or executable != "/usr/bin/bwrap":
    sys.exit(2)
arguments = json.loads(arguments_json)
if not isinstance(arguments, list) or any(not isinstance(a, str) for a in arguments) or "/proc/self/fd/3" not in arguments:
    sys.exit(2)
before = os.fstat(3)
if not stat.S_ISREG(before.st_mode) or before.st_size > 512 * 1024 * 1024 or fcntl.fcntl(3, fcntl.F_GETFL) & os.O_ACCMODE != os.O_RDONLY:
    sys.exit(2)
digest = hashlib.sha256()
position = 0
while position <= before.st_size:
    chunk = os.pread(3, min(65536, before.st_size - position + 1), position)
    if not chunk:
        break
    position += len(chunk)
    digest.update(chunk)
after = os.fstat(3)
if position != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns) or digest.hexdigest() != expected_digest or os.getppid() != int(guardian):
    sys.exit(2)
os.set_inheritable(3, True)
os.execve(executable, [executable, *arguments], os.environ)

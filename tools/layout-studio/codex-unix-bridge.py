"""Internal bounded JSONL/WebSocket carrier. No daemon, account or thread selection."""
import base64
import hashlib
import json
import os
import select
import signal
import socket
import stat
import struct
import sys

MAX = 1024 * 1024


def require(value):
    if not value:
        raise ValueError("Unconfirmed private transport")


def json_object(data):
    def invalid(_):
        raise ValueError("Non-JSON numeric value")
    value = json.loads(data.decode("utf-8", "strict"), parse_constant=invalid)
    require(isinstance(value, dict))
    return value


def process_identity(pid):
    proc = "/proc/" + str(pid)
    with open(proc + "/stat", encoding="ascii") as stream:
        fields = stream.read(8192).rsplit(")", 1)[1].split()
    require(fields[0] != "Z")
    return os.stat(proc).st_uid, fields[19], os.readlink(proc + "/exe")


def frame(opcode, payload):
    require(len(payload) <= MAX)
    mask = os.urandom(4)
    length = len(payload)
    header = bytes([0x80 | opcode, 0x80 | length]) if length < 126 else bytes([0x80 | opcode, 0xfe]) + struct.pack("!H", length) if length <= 65535 else bytes([0x80 | opcode, 0xff]) + struct.pack("!Q", length)
    return header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload))


def run():
    require(sys.platform == "linux" and len(sys.argv) == 1)
    signal.alarm(8)
    initial = bytearray()
    while True:
        character = os.read(0, 1)
        require(character and len(initial) < 16384)
        if character == b"\n":
            break
        initial.extend(character)
    request = json_object(initial)
    require(set(request) == {"schema", "parentPid", "peerPid", "peerBirth", "peerExecutableSha256", "peerExecutable", "socketPath", "socketDevice", "socketInode"})
    require(request["schema"] == "switchyard-pinned-codex-unix/v1" and type(request["parentPid"]) is int and os.getppid() == request["parentPid"])
    require(type(request["peerPid"]) is int and 0 < request["peerPid"] <= 2147483647)
    uid = os.getuid()
    path = request["socketPath"]
    require(isinstance(path, str) and os.path.isabs(path) and os.path.normpath(path) == path and len(path.encode()) <= 100)
    before, parent = os.lstat(path), os.lstat(os.path.dirname(path))
    require(stat.S_ISSOCK(before.st_mode) and before.st_uid == uid and before.st_mode & 0o077 == 0)
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == uid and parent.st_mode & 0o077 == 0)
    require(str(before.st_dev) == request["socketDevice"] and str(before.st_ino) == request["socketInode"])
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(8)
        connection.connect(path)
        peer = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        require(peer[0] == request["peerPid"] and peer[1] == uid)
        require(process_identity(peer[0]) == (uid, request["peerBirth"], request["peerExecutable"]))
        digest = hashlib.sha256()
        with open("/proc/" + str(peer[0]) + "/exe", "rb") as image:
            source = os.fstat(image.fileno())
            require(stat.S_ISREG(source.st_mode) and source.st_uid in (0, uid) and source.st_mode & 0o6022 == 0 and source.st_size <= 512 * 1024 * 1024)
            while chunk := image.read(1024 * 1024):
                digest.update(chunk)
        require(digest.hexdigest() == request["peerExecutableSha256"])
        require(process_identity(peer[0]) == (uid, request["peerBirth"], request["peerExecutable"]))
        after, parent_after = os.lstat(path), os.lstat(os.path.dirname(path))
        require((after.st_dev, after.st_ino, after.st_uid, after.st_mode) == (before.st_dev, before.st_ino, before.st_uid, before.st_mode))
        require((parent_after.st_dev, parent_after.st_ino, parent_after.st_uid, parent_after.st_mode) == (parent.st_dev, parent.st_ino, parent.st_uid, parent.st_mode))
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        connection.sendall(("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n").encode("ascii"))
        incoming = bytearray()
        while b"\r\n\r\n" not in incoming:
            chunk = connection.recv(4096)
            require(chunk and len(incoming) + len(chunk) <= 16384)
            incoming.extend(chunk)
        headers, remaining = bytes(incoming).split(b"\r\n\r\n", 1)
        lines = headers.decode("ascii", "strict").split("\r\n")
        require(lines[0].split()[:2] == ["HTTP/1.1", "101"])
        values = {}
        for line in lines[1:]:
            name, value = line.split(":", 1)
            name = name.lower()
            require(name not in values)
            values[name] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()).decode("ascii")
        require(values.get("sec-websocket-accept") == expected and values.get("upgrade", "").lower() == "websocket" and "upgrade" in [item.strip() for item in values.get("connection", "").lower().split(",")])
        require("sec-websocket-extensions" not in values and "sec-websocket-protocol" not in values)
        incoming = bytearray(remaining)
        connection.setblocking(False)
        signal.alarm(0)
        outgoing, stdin, fragment = bytearray(), bytearray(), None
        while True:
            while len(incoming) >= 2:
                first, second = incoming[0], incoming[1]
                final, opcode = bool(first & 0x80), first & 15
                require(first & 0x70 == 0 and second & 0x80 == 0)
                size, offset = second & 0x7f, 2
                if size == 126:
                    if len(incoming) < 4:
                        break
                    size, offset = struct.unpack("!H", incoming[2:4])[0], 4
                    require(size >= 126)
                elif size == 127:
                    if len(incoming) < 10:
                        break
                    size, offset = struct.unpack("!Q", incoming[2:10])[0], 10
                    require(size >= 65536)
                require(size <= MAX and (opcode < 8 or final and size <= 125))
                if len(incoming) < offset + size:
                    break
                payload = bytes(incoming[offset:offset + size])
                del incoming[:offset + size]
                if opcode == 8:
                    return
                if opcode == 9:
                    outgoing.extend(frame(10, payload))
                elif opcode == 10:
                    continue
                elif opcode in (0, 1):
                    require(opcode == 1 and fragment is None or opcode == 0 and fragment is not None)
                    fragment = bytearray(payload) if opcode == 1 else fragment + payload
                    require(len(fragment) <= MAX)
                    if final:
                        message = json.dumps(json_object(fragment), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
                        require(len(message) <= MAX)
                        sys.stdout.buffer.write(message + b"\n")
                        sys.stdout.buffer.flush()
                        fragment = None
                else:
                    raise ValueError("Unsupported WebSocket message")
                require(len(outgoing) <= MAX + 65536)
            if not outgoing and b"\n" in stdin:
                line, remaining = bytes(stdin).split(b"\n", 1)
                stdin = bytearray(remaining)
                require(len(line) <= MAX)
                json_object(line)
                outgoing.extend(frame(1, line))
            readable, writable, _ = select.select([connection] + ([] if outgoing else [0]), [connection] if outgoing else [], [], 1)
            if connection in writable:
                try:
                    count = connection.send(outgoing)
                    require(count > 0)
                    del outgoing[:count]
                except BlockingIOError:
                    pass
            if connection in readable:
                try:
                    chunk = connection.recv(65536)
                    if not chunk:
                        return
                    incoming.extend(chunk)
                    require(len(incoming) <= MAX + 65536)
                except BlockingIOError:
                    pass
            if 0 in readable:
                chunk = os.read(0, 65536)
                if not chunk:
                    return
                stdin.extend(chunk)
                require(len(stdin) <= MAX + 65536)


try:
    run()
except Exception:
    # No peer path, account, JSON content or native error text reaches stderr.
    sys.exit(2)

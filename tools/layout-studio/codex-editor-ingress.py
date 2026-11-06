"""One exact Linux terminal peer, bounded WebSocket/JSONL; no upstream or task authority."""
import base64
import hashlib
import json
import os
import re
import select
import signal
import socket
import stat
import struct
import sys

MAX = 1048576
LIMIT = MAX + 65536


def require(value):
    if not value:
        raise ValueError("Unconfirmed editor transport")


def object_json(data):
    def invalid(_):
        raise ValueError("Invalid number")
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result
    value = json.loads(data.decode("utf-8", "strict"), parse_constant=invalid, object_pairs_hook=pairs)
    require(isinstance(value, dict))
    return value


def encode(value):
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    require(len(data) <= LIMIT)
    return data


def initial_line():
    data = bytearray()
    while True:
        char = os.read(0, 1)
        require(char and len(data) < 16384)
        if char == b"\n":
            return object_json(data)
        data.extend(char)


def frame(opcode, data):
    require(len(data) <= MAX)
    size = len(data)
    header = bytes([0x80 | opcode, size]) if size < 126 else bytes([0x80 | opcode, 126]) + struct.pack("!H", size) if size < 65536 else bytes([0x80 | opcode, 127]) + struct.pack("!Q", size)
    return header + data


def process_identity(pid):
    root = "/proc/" + str(pid)
    with open(root + "/stat", "rb") as source:
        data = source.read(8193)
    require(len(data) <= 8192 and data.startswith((str(pid) + " (").encode()))
    fields = data.rsplit(b") ", 1)[1].split()
    require(len(fields) >= 20 and fields[0] in (b"R", b"S", b"D", b"T", b"t", b"W", b"I", b"P"))
    return os.stat(root).st_uid, fields[19].decode("ascii"), os.readlink(root + "/exe")


def verify_peer(connection, request):
    require(set(request) == {"kind", "pid", "birth", "executable", "executableSha256"} and request["kind"] == "peer")
    pid, path = request["pid"], request["executable"]
    require(type(pid) is int and 0 < pid <= 2147483647 and isinstance(request["birth"], str) and re.fullmatch(r"[1-9][0-9]{0,19}", request["birth"]))
    require(isinstance(path, str) and os.path.isabs(path) and os.path.normpath(path) == path and len(path.encode()) <= 4096)
    require(isinstance(request["executableSha256"], str) and re.fullmatch(r"[a-f0-9]{64}", request["executableSha256"]))
    peer = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    expected = (os.getuid(), request["birth"], path)
    require(peer[0] == pid and peer[1] == expected[0] and process_identity(pid) == expected)
    digest = hashlib.sha256()
    with open("/proc/" + str(pid) + "/exe", "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid in (0, os.getuid()) and info.st_mode & 0o6022 == 0 and info.st_size <= 512 * 1024 * 1024)
        while chunk := source.read(1048576):
            digest.update(chunk)
        after = os.fstat(source.fileno())
        require((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
    require(digest.hexdigest() == request["executableSha256"] and process_identity(pid) == expected)
    return pid, expected


def handshake(connection):
    incoming = bytearray()
    while b"\r\n\r\n" not in incoming:
        chunk = connection.recv(4096)
        require(chunk and len(incoming) + len(chunk) <= 16384)
        incoming.extend(chunk)
    raw, rest = bytes(incoming).split(b"\r\n\r\n", 1)
    lines = raw.decode("ascii", "strict").split("\r\n")
    require(lines[0] == "GET / HTTP/1.1")
    headers = {}
    for line in lines[1:]:
        name, value = line.split(":", 1)
        require(re.fullmatch(r"[A-Za-z0-9-]+", name) and name.lower() not in headers and not re.search(r"[\x00-\x08\x0a-\x1f\x7f]", value))
        headers[name.lower()] = value.strip()
    require(headers.get("upgrade", "").lower() == "websocket" and "upgrade" in [v.strip() for v in headers.get("connection", "").lower().split(",")])
    require(headers.get("sec-websocket-version") == "13" and 0 < len(headers.get("host", "")) <= 255)
    require(not set(headers).intersection({"origin", "sec-websocket-extensions", "sec-websocket-protocol", "content-length", "transfer-encoding"}))
    key = headers.get("sec-websocket-key", "")
    require(len(base64.b64decode(key, validate=True)) == 16)
    accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest())
    connection.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
    return bytearray(rest)


def run():
    require(sys.platform == "linux" and len(sys.argv) == 1)
    def expired(_signal, _frame):
        if _signal == signal.SIGTERM:
            raise SystemExit(2)
        raise TimeoutError("Editor transport deadline")
    signal.signal(signal.SIGALRM, expired)
    signal.signal(signal.SIGTERM, expired)
    signal.alarm(8)
    request = initial_line()
    require(set(request) == {"schema", "parentPid", "socketPath", "directoryDevice", "directoryInode"} and request["schema"] == "switchyard-editor-ingress/v1")
    parent = request["parentPid"]
    require(type(parent) is int and parent > 0 and os.getppid() == parent)
    path = request["socketPath"]
    require(isinstance(path, str) and os.path.isabs(path) and os.path.normpath(path) == path and len(path.encode()) <= 100 and not re.search(r"[\x00-\x1f\x7f]", path))
    directory, name = os.path.split(path)
    require(os.path.realpath(directory) == directory)
    owned = None
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        initial = os.fstat(directory_fd)
        require(stat.S_ISDIR(initial.st_mode) and initial.st_uid == os.getuid() and initial.st_mode & 0o077 == 0)
        require(str(initial.st_dev) == request["directoryDevice"] and str(initial.st_ino) == request["directoryInode"])
        def current():
            require(os.getppid() == parent)
            actual = os.lstat(directory)
            require((actual.st_dev, actual.st_ino, actual.st_uid, actual.st_mode) == (initial.st_dev, initial.st_ino, initial.st_uid, initial.st_mode))
            if owned:
                named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                require((named.st_dev, named.st_ino, named.st_uid, named.st_mode) == owned)
        current()
        os.umask(0o077)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
            listener.bind(path)  # Existing names refuse; never unlink a prior socket.
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            require(stat.S_ISSOCK(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0)
            owned = (info.st_dev, info.st_ino, info.st_uid, info.st_mode)
            current()
            listener.listen(1)
            sys.stdout.buffer.write(encode({"kind": "ready", "socketDevice": str(info.st_dev), "socketInode": str(info.st_ino)}) + b"\n")
            sys.stdout.buffer.flush()
            peer_request = initial_line()
            connection, _ = listener.accept()
            listener.close()  # Exactly one accepted peer; no reconnect or search.
            with connection:
                connection.settimeout(8)
                pid, expected = verify_peer(connection, peer_request)
                current()
                incoming = handshake(connection)
                require(process_identity(pid) == expected)
                output = bytearray(encode({"kind": "peer-verified"}) + b"\n")
                outgoing, stdin, fragment = bytearray(), bytearray(), None
                connection.setblocking(False)
                os.set_blocking(0, False)
                os.set_blocking(1, False)
                signal.alarm(0)
                closing = False
                while True:
                    current()
                    require(process_identity(pid) == expected)
                    while len(incoming) >= 2 and not output and not closing:
                        first, second = incoming[0], incoming[1]
                        final, opcode = bool(first & 0x80), first & 15
                        require(first & 0x70 == 0 and second & 0x80 != 0)
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
                        if len(incoming) < offset + 4 + size:
                            break
                        mask = incoming[offset:offset + 4]
                        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(incoming[offset + 4:offset + 4 + size]))
                        del incoming[:offset + 4 + size]
                        if opcode == 8:
                            require(len(payload) != 1)
                            if payload:
                                code = struct.unpack("!H", payload[:2])[0]
                                require(code in (1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014) or 3000 <= code <= 4999)
                                payload[2:].decode("utf-8", "strict")
                            outgoing.extend(frame(8, payload)); closing = True; signal.alarm(2)
                        elif opcode == 9:
                            outgoing.extend(frame(10, payload))
                        elif opcode == 10:
                            pass
                        elif opcode in (0, 1):
                            require(opcode == 1 and fragment is None or opcode == 0 and fragment is not None)
                            fragment = bytearray(payload) if opcode == 1 else fragment + payload
                            require(len(fragment) <= MAX)
                            if final:
                                message = object_json(fragment)
                                require(len(encode(message)) <= MAX)
                                output.extend(encode({"kind": "message", "message": message}) + b"\n")
                                fragment = None
                        else:
                            raise ValueError("Unsupported frame")
                        require(len(outgoing) <= LIMIT)
                    if closing and not outgoing:
                        return
                    if not outgoing and not closing and b"\n" in stdin:
                        line, rest = bytes(stdin).split(b"\n", 1)
                        stdin = bytearray(rest)
                        require(len(line) <= LIMIT)
                        command = object_json(line)
                        require(set(command) == {"kind", "message"} and command["kind"] == "send" and isinstance(command["message"], dict))
                        outgoing.extend(frame(1, encode(command["message"])))
                    read = ([] if output or closing else [connection]) + ([] if outgoing or closing else [0])
                    write = ([connection] if outgoing else []) + ([1] if output else [])
                    readable, writable, _ = select.select(read, write, [], 1)
                    if connection in writable:
                        count = connection.send(outgoing); require(count > 0); del outgoing[:count]
                    if 1 in writable:
                        count = os.write(1, output); require(count > 0); del output[:count]
                    if connection in readable:
                        chunk = connection.recv(65536)
                        if not chunk:
                            return
                        incoming.extend(chunk); require(len(incoming) <= LIMIT)
                    if 0 in readable:
                        chunk = os.read(0, 65536)
                        if not chunk:
                            return
                        stdin.extend(chunk); require(len(stdin) <= LIMIT)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        if owned:
            try:
                last = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if (last.st_dev, last.st_ino, last.st_uid, last.st_mode) == owned:
                    os.unlink(name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        os.close(directory_fd)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        sys.exit(2)  # No peer identity, private content or raw native errors.
    finally:
        signal.alarm(0)

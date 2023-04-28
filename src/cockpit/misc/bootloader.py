# COCKPIT BOOTLOADER

from hashlib import sha256
import os
import sys


class Bootloader:
    version = None
    checksum = None
    source = None

    def start(self, name, version, checksum, size):
        self.version = version
        self.checksum = checksum

        cachedir = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
        filename = f"{cachedir}/{name}/{version}-{checksum}.py"

        # step one: try to find a cached local copy
        if self.source is None:
            try:
                with open(filename, "rb") as file:
                    data = file.read()
                    if sha256(data).hexdigest() == checksum:
                        self.source = data
            except OSError:
                pass

        # step two: request from the sender
        if self.source is None:
            message = f"""\n{{"command":"need-script","sha256":"{checksum}","size":{size}}}\n"""
            os.write(1, f"{len(message)}\n{message}".encode("ascii"))
            data = b""
            while len(data) < size:
                data += os.read(0, size - len(data))
            if sha256(data).hexdigest() == checksum:
                self.source = data
            else:
                sys.exit("checksum of sent data is incorrect")

        # step three: cache it locally (best effort)
        try:
            os.makedirs(f"{cachedir}/{name}", exist_ok=True)
            with open(filename, "w+b") as file:
                file.write(self.source)
        except OSError:
            pass

        exec(self.source)
        sys.exit(0)


BOOTLOADER = Bootloader()
BOOTLOADER.start("hello", "300", "a0c22dc5d16db10ca0e3d99859ffccb2b4d536b21d6788cfbe2d2cfac60e8117", 22)
# echo 'print("Hello world!")' | python3 bootloader.py

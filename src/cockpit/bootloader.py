# COCKPIT BOOTLOADER

from hashlib import sha256
from pathlib import Path
import os
import sys
import tempfile
import runpy


class Bootloader:
    version = None
    checksum = None
    source = None

    def start(self, name, version, checksum, size):
        self.version = version
        self.checksum = checksum

        xdg_cache_home = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
        cache_file = Path(f"{xdg_cache_home}/{name}/{version}-{checksum}.zip")

        # step one: try to find a cached local copy (best effort)
        if self.source is None:
            try:
                data = cache_file.read_bytes()
                if sha256(data).hexdigest() == checksum:
                    # we don't trust atime, so use mtime to track last-used.
                    # this will fail if the filesystem is read only, but it's
                    # irrelevant because pruning will fail in that case, anyway.
                    self.source = data
                    cache_file.touch()
            except OSError:
                pass

        # step two: request from the sender
        if self.source is None:
            message = f"""\n{{"command":"need-script","sha256":"{checksum}","size":{size}}}\n"""
            os.write(1, f"{len(message)}\n{message}".encode("ascii"))
            data = sys.stdin.buffer.read(size)
            if sha256(data).hexdigest() == checksum:
                self.source = data
            else:
                sys.exit("checksum of sent data is incorrect")

        # step three: cache it locally (best effort)
        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_bytes(self.source)
        except OSError:
            pass

        # step four: run the .pyz as a temporary file
        with tempfile.NamedTemporaryFile(prefix='cockpit-', suffix='.zip', buffering=0) as file:
            file.write(self.source)
            runpy.run_path(file.name)

        sys.exit(0)

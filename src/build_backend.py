import argparse
import base64
import hashlib
import lzma
import os
import shutil
import subprocess
import tarfile
import zipfile
from typing import Dict, Iterable, Optional

from cockpit import __version__

PACKAGE = f'cockpit-{__version__}'
TAG = 'py3-none-any'


def find_sources(*, srcpkg: bool) -> Iterable[str]:
    try:
        subprocess.check_call(['modules/checkout'], stdout=2)       # Needed for git builds...
    except FileNotFoundError:                                       # ...but not present in tarball...
        pass                                                        # ...and not needed either, because...
    assert os.path.exists('src/cockpit/_vendor/ferny/__init__.py')  # ...the code should exist there already.

    if srcpkg:
        yield from {
            'pyproject.toml',
            'src/build_backend.py',
        }

    for path, _dirs, files in os.walk('src', followlinks=True):
        if '__init__.py' in files:
            yield from [os.path.join(path, file) for file in files]


def copy_sources(distdir: str) -> None:
    for source in find_sources(srcpkg=True):
        destination = os.path.join(distdir, source)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy(source, destination)


def build_sdist(sdist_directory: str,
                config_settings: Optional[Dict[str, object]] = None) -> str:
    del config_settings
    sdist_filename = f'{PACKAGE}.tar.gz'
    with tarfile.open(f'{sdist_directory}/{sdist_filename}', 'w:gz', dereference=True) as sdist:
        for filename in find_sources(srcpkg=True):
            sdist.add(filename, arcname=f'{PACKAGE}/{filename}', )
    return sdist_filename


def build_wheel(wheel_directory: str,
                config_settings: Optional[Dict[str, object]] = None,
                metadata_directory: Optional[str] = None) -> str:
    del config_settings, metadata_directory
    wheel_filename = f'{PACKAGE}-{TAG}.whl'
    distinfo = {
        'WHEEL': [
            'Wheel-Version: 1.0',
            'Generator: cockpit build_backend',
            'Root-Is-Purelib: true',
            f'Tag: {TAG}',
        ],
        'METADATA': [
            'Metadata-Version: 2.1',
            'Name: cockpit',
            f'Version: {__version__}',
        ],
        'entry_points.txt': [
            '[console_scripts]',
            'cockpit-bridge = cockpit.bridge:main',
            'cockpit-askpass = cockpit._vendor.ferny.interaction_client:main',
        ],
    }

    with zipfile.ZipFile(f'{wheel_directory}/{wheel_filename}', 'w') as wheel:
        def beipack_self(main: str) -> bytes:
            from cockpit._vendor.bei import beipack
            contents = {name: wheel.read(name) for name in wheel.namelist()}
            pack = beipack.pack(contents, main).encode('utf-8')
            return lzma.compress(pack, preset=lzma.PRESET_EXTREME)

        def write_distinfo(filename: str, lines: Iterable[str]) -> None:
            wheel.writestr(f'{PACKAGE}.dist-info/{filename}', ''.join(f'{line}\n' for line in lines))

        def record_lines() -> Iterable[str]:
            for info in wheel.infolist():
                digest = hashlib.sha256(wheel.read(info.filename)).digest()
                b64_digest = base64.urlsafe_b64encode(digest).rstrip(b'=').decode('ascii')
                yield f'{info.filename},sha256={b64_digest},{info.file_size}'
            yield f'{PACKAGE}.dist-info/RECORD,,'

        for filename in find_sources(srcpkg=False):
            wheel.write(filename, arcname=os.path.relpath(filename, start='src'))

        wheel.writestr('cockpit/data/cockpit-bridge.beipack.xz', beipack_self('cockpit.bridge:main'))

        for filename, lines in distinfo.items():
            write_distinfo(filename, lines)
        write_distinfo('RECORD', record_lines())

    return wheel_filename


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--copy', action='store_true')
    group.add_argument('--sdist', action='store_true')
    group.add_argument('--wheel', action='store_true')
    parser.add_argument('srcdir')
    parser.add_argument('destdir')
    args = parser.parse_args()

    # We have to chdir() for PEP 517, so make sure dest is absolute
    destdir = os.path.abspath(args.destdir)
    os.chdir(args.srcdir)

    os.makedirs(destdir, exist_ok=True)

    if args.copy:
        copy_sources(destdir)
    elif args.sdist:
        print(os.path.join(destdir, build_sdist(destdir)))
    else:
        print(os.path.join(destdir, build_wheel(destdir)))


if __name__ == '__main__':
    main()

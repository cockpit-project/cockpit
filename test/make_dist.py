#!/usr/bin/python3
# This file is part of Cockpit.
#
# Copyright (C) 2021 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

import glob
import io
import multiprocessing
import os
import urllib.request
import subprocess
import sys
import tarfile
import time
import argparse


def message(*args):
    print(*args, file=sys.stderr)


def build_dist():
    '''Build a dist tarball for CI testing

    This supports completely clean git trees, unpacked release tarballs, and already configured trees.
    Returns path to built tarball.
    '''
    if not os.path.exists("Makefile"):
        if os.path.exists('./configure'):
            # unconfigured release tarball
            subprocess.check_call('./configure')
        else:
            # clean git checkout
            subprocess.check_call('./autogen.sh')

    # this is for a development build, not a release, so we care about speed, not best size
    subprocess.check_call(["make", "--silent", "-j%i" % multiprocessing.cpu_count(),
                           "NO_DIST_CACHE=1", "XZ_COMPRESS_FLAGS=-0", "dist"])
    return subprocess.check_output(["make", "dump-dist"], universal_newlines=True).strip()


def download_dist(wait=False):
    '''Download dists tarball for current git SHA from GitHub

    These are produced by .github/workflows/build-dist.yml for every PR and push.
    This is a lot faster than having to npm install and run webpack.

    Returns path to downloaded tarball, or None if it isn't available.
    This can happen because the current directory is not a git checkout, or it is
    a SHA which is not pushed/PRed.
    '''
    try:
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
    except subprocess.CalledProcessError:
        message("make_dist: not a git repository")
        return None

    if subprocess.call(["git", "diff", "--quiet", "--", ":^test"]) > 0:
        message("make_dist: uncommitted local changes, skipping download")
        return None

    dists = glob.glob(f"cockpit-*{sha[:8]}*.tar.xz")
    if dists:
        message("make_dist: already downloaded", dists[0])
        return os.path.abspath(dists[0])

    download_url = f"https://github.com/{ os.getenv('GITHUB_BASE', 'cockpit-project/cockpit') }-dist/raw/master/{sha}.tar"
    request = urllib.request.Request(download_url)
    tario = io.BytesIO()
    retries = 50 if wait else 1  # 25 minutes, once every 30s
    while retries > 0:
        try:
            with urllib.request.urlopen(request) as response:
                sys.stderr.write(f"make_dist: Downloading dist tarball from {download_url} ...\n")
                if os.isatty(sys.stderr.fileno()):
                    total_size = 0
                else:
                    total_size = None
                MB = 10**6
                # read tar into a stringio, as the stream is not seekable and tar requires that
                while True:
                    block = response.read(MB)
                    if len(block) == 0:
                        break
                    if total_size is not None:
                        total_size += len(block)
                        sys.stderr.write(f"\r{ total_size // MB } MB")

                    tario.write(block)

                # clear the download progress in tty mode
                if total_size is not None:
                    sys.stderr.write("\r                             \r")

                break

        except urllib.error.HTTPError as e:
            retries -= 1

            if retries == 0:
                message(f"make_dist: Downloading {download_url} failed:", e)
                return None

            message(f"make_dist: {download_url} not yet available, waiting...")
            time.sleep(30)

    tario.seek(0)
    with tarfile.open(fileobj=tario) as ftar:
        names = ftar.getnames()
        try:
            names.remove('.')
        except ValueError:
            pass
        if len(names) != 1 or not names[0].endswith(".tar.xz"):
            message("make_dist: expected tar with exactly one tar.xz member")
            return None
        ftar.extract(names[0])
        tar_path = os.path.realpath(names[0])

    # Extract node_modules and dist locally for speeding up the build and allowing integration tests to run
    unpack_dirs = [d for d in ["dist", "node_modules"] if not os.path.exists(d)]
    if unpack_dirs:
        message("make_dist: Extracting directories from tarball:", ' '.join(unpack_dirs))
        prefix = os.path.basename(tar_path).split('.tar')[0] + '/'
        prefixed_unpack_dirs = [prefix + d for d in unpack_dirs]
        subprocess.check_call(["tar", "--touch", "--strip-components=1", "-xf", tar_path] + prefixed_unpack_dirs)

    return tar_path


def make_dist(download_only=False, wait_download=False):
    # first try to download a pre-generated dist tarball; this is a lot faster
    # but these tarballs are built for production NPM mode
    source = None
    if os.getenv("NODE_ENV") != "development":
        source = download_dist(wait_download)
    if not source:
        if not download_only and not wait_download:
            source = build_dist()
        else:
            print("make_dist: Download failed: pre-built dist tarball does not exist")
            sys.exit(1)
    return source


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Download or build release tarbal")
    parser.add_argument('-d', '--download-only', action='store_true', help="Fail instead of build locally if download is not available")
    parser.add_argument('-w', '--wait', action='store_true', help="Wait for up to 20 minutes for download tarball (implies -d)")
    args = parser.parse_args()
    print(make_dist(args.download_only, args.wait))

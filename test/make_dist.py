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

import multiprocessing
import os
import subprocess
import sys
import time
import argparse


CACHE_REPO = os.getenv("GITHUB_BASE", "cockpit-project/cockpit") + "-dist"


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
    subprocess.check_call(["make", "--silent", "-j%i" % multiprocessing.cpu_count(), "XZ_OPT=-0", "dist"])
    return subprocess.check_output(["make", "dump-dist"], universal_newlines=True).strip()


def download_cache(wait=False):
    tries = 50 if wait else 1  # 25 minutes, once every 30s
    for retry in range(tries):
        try:
            subprocess.check_call(["tools/webpack-jumpstart"])
            return True
        except subprocess.CalledProcessError as e:
            if e.returncode != 2 or not wait:
                break
            message("make_dist: pre-built dist not yet available, waiting...")
            time.sleep(30)

    message("make_dist: Downloading pre-built dist failed")
    return False


def make_dist(download_only=False, wait_download=False):
    # on an unbuilt tree, try to download a pre-generated webpack build; this is a lot faster
    # these tarballs are built for production NPM mode
    if not os.path.exists("dist") and os.getenv("NODE_ENV") != "development":
        if not download_cache(wait_download) and (download_only or wait_download):
            sys.exit(1)

    return build_dist()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Generate release dist tarball, download cached webpack build if available")
    parser.add_argument('-d', '--download-only', action='store_true', help="Fail instead of build locally if download is not available")
    parser.add_argument('-w', '--wait', action='store_true', help="Wait for up to 20 minutes for download tarball (implies -d)")
    args = parser.parse_args()
    print(make_dist(args.download_only, args.wait))

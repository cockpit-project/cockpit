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
    subprocess.check_call(["make", "--silent", "-j%i" % multiprocessing.cpu_count(),
                           "NO_DIST_CACHE=1", "XZ_COMPRESS_FLAGS=-0", "dist"])
    return subprocess.check_output(["make", "dump-dist"], universal_newlines=True).strip()


def download_cache(wait=False):
    '''Download pre-built webpack for current git SHA from GitHub

    These are produced by .github/workflows/build-dist.yml for every PR and push.
    This is a lot faster than having to npm install and run webpack.

    Returns True when successful, or False if the download isn't available.
    This can happen because dist/ already exists, or the current directory is not a git checkout,
    or it is a SHA which is not pushed/PRed.
    '''
    try:
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
    except subprocess.CalledProcessError:
        message("make_dist: not a git repository")
        return False

    if subprocess.call(["git", "diff", "--quiet", "--", ":^test", ":^packit.yaml", ":^.github"]) > 0:
        message("make_dist: uncommitted local changes, skipping download")
        return False

    dist_git_checkout = os.path.join(os.getenv("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "cockpit-dev", CACHE_REPO + ".git")

    if not os.path.exists(dist_git_checkout):
        message(f"make_dist: Creating dist cache {dist_git_checkout}")
        subprocess.check_call(["git", "init", "--bare", "--quiet", dist_git_checkout])
        subprocess.check_call(["git", "--git-dir", dist_git_checkout, "remote", "add", "origin", "https://github.com/" + CACHE_REPO])

    tag = "sha-" + sha

    retries = 50 if wait else 1  # 25 minutes, once every 30s
    while retries > 0:
        try:
            subprocess.check_call(["git", "--git-dir", dist_git_checkout, "fetch", "--no-tags", "--depth=1", "origin", "tag", tag])
            break
        except subprocess.CalledProcessError:
            retries -= 1

            if retries == 0:
                message(f"make_dist: Downloading pre-built dist for SHA {sha} failed")
                return False

            message(f"make_dist: pre-built dist for {sha} not yet available, waiting...")
            time.sleep(30)

    # Unfortunately our dist tarball generation does not deal with sub-second file mtime differences,
    # which can invert the relative mtime of package-lock.json vs.  dist/*/manifest.json
    # to avoid this, only touch the webpack-built files (to satisfy make dependencies),
    # but leave the `npm install` ones alone.
    for (unpack_path, touch) in [("node_modules", False),
                                 ("package-lock.json", False),
                                 ("dist", True),
                                 ("tools/debian/copyright", True)]:
        if os.path.exists(unpack_path):
            continue
        message(f"make_dist: Extracting cached {unpack_path}...")
        p_git = subprocess.Popen(["git", "--git-dir", dist_git_checkout, "archive", tag, unpack_path],
                                 stdout=subprocess.PIPE)
        subprocess.check_call(["tar", "-x"] + (["--touch"] if touch else []), stdin=p_git.stdout)
        result = p_git.wait()
        assert result == 0

    return True


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

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
import urllib
import subprocess
import sys
import zipfile
import argparse


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


def download_dist():
    '''Download dists tarball for current git SHA from GitHub

    These are produced by .github/workflows/build-dist.yml for every PR and push.
    This is a lot faster than having to npm install and run webpack.

    Returns path to downloaded tarball, or None if it isn't available.
    This can happen because the current directory is not a git checkout, or it is
    a SHA which is not pushed/PRed, or there is no ~/.config/github-token available.
    '''
    try:
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
    except subprocess.CalledProcessError:
        print("make_dist: not a git repository")
        return None

    dists = glob.glob(f"cockpit-*{sha[:8]}*.tar.xz")
    if dists:
        print("make_dist: already downloaded " + dists[0])
        return os.path.abspath(dists[0])

    sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bots"))
    import task

    # task.api defaults to the current checkout's origin, but the artifacts are on cockpit-project
    # except if a developer wants to change the artifact building workflow on their fork, support that with $GITHUB_BASE
    api = task.github.GitHub(repo=os.getenv("GITHUB_BASE", "KKoukiou/cockpit"))

    # downloading GitHub artifacts requires a token
    if not api.token:
        print("make_dist: no GitHub API token available")
        return None

    # iterate artifacts and search our SHA
    page = 1
    batch_size = 100
    download_url = None
    while not download_url and batch_size == 100:
        batch = api.get(f"actions/artifacts?per_page={batch_size}&page={page}")["artifacts"]
        for artifact in batch:
            if artifact["name"] == "dist-" + sha:
                download_url = artifact["archive_download_url"]
                break
        # if the current batch is < 100, we have the last page and can stop
        batch_size = len(batch)
        page += 1

    if not download_url:
        print(f"make_dist: no download available for commit {sha}")
        return None

    print(f"make_dist: Downloading dist tarball from {download_url} ...")
    request = urllib.request.Request(download_url, headers={"Authorization": "token " + api.token})
    zipio = io.BytesIO()
    try:
        with urllib.request.urlopen(request) as response:
            if os.isatty(sys.stdout.fileno()):
                total_size = 0
            else:
                total_size = None
            MB = 10**6
            # read zip into a stringio, as the stream is not seekable and zip requires that
            while True:
                block = response.read(MB)
                if len(block) == 0:
                    break
                if total_size is not None:
                    total_size += len(block)
                    sys.stdout.write(f"\r{ total_size // MB } MB")

                zipio.write(block)

            # clear the download progress in tty mode
            if total_size is not None:
                sys.stdout.write("\r                             \r")

    except urllib.error.HTTPError as e:
        print("make_dist: Download failed:", e)
        return None

    with zipfile.ZipFile(zipio) as fzip:
        names = fzip.namelist()
        if len(names) != 1 or not names[0].endswith(".tar.xz"):
            print("make_dist: expected zip artifact with exactly one tar.xz member")
            return None
        tar_path = fzip.extract(names[0])

    # Extract node_modules and dist locally for speeding up the build and allowing integration tests to run
    unpack_dirs = [d for d in ["dist", "node_modules"] if not os.path.exists(d)]
    if unpack_dirs:
        print("make_dist: Extracting directories from tarball:", ' '.join(unpack_dirs))
        prefix = os.path.basename(tar_path).split('.tar')[0] + '/'
        prefixed_unpack_dirs = [prefix + d for d in unpack_dirs]
        subprocess.check_call(["tar", "--touch", "--strip-components=1", "-xf", tar_path] + prefixed_unpack_dirs)

    return tar_path


def make_dist(download_only):
    # first try to download a pre-generated dist tarball; this is a lot faster
    # but these tarballs are built for production NPM mode
    source = None
    if os.getenv("NODE_ENV") != "development":
        source = download_dist()
    if not source:
        if not download_only:
            source = build_dist()
        else:
            print("make_dist: Download failed: artifact does not exist")
            sys.exit(2)
    return source


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('-d', dest='download-only', action='store_true')
    args = parser.parse_args()
    print(make_dist(getattr(args, 'download-only')))

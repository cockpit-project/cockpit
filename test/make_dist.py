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


def make_dist():
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


if __name__ == '__main__':
    print(make_dist())

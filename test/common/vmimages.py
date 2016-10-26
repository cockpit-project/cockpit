# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2013 Red Hat, Inc.
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

import os
import sys
import subprocess
import shutil
import stat
import tempfile
import time
from common import testinfra

BASE = testinfra.TEST_DIR
IMAGES = os.path.join(BASE, "images")
DATA = os.path.join(os.environ.get("TEST_DATA", BASE), "images")
# threshold in G below which unreferenced qcow2 images will be pruned, even if they aren't old
PRUNE_THRESHOLD_G = float(os.environ.get("PRUNE_THRESHOLD_G", 15))
DEVNULL = open("/dev/null", "r+")

CONFIG = "~/.config/image-stores"
DEFAULT = "https://fedorapeople.org/groups/cockpit/images/"

def download(link, force, stores):
    if not os.path.exists(DATA):
        os.makedirs(DATA)

    dest = os.readlink(link)
    relative_dir = os.path.dirname(os.path.abspath(link))
    full_dest = os.path.join(relative_dir, dest)
    while not ".qcow2" in dest and os.path.islink(full_dest):
        link = full_dest
        dest = os.readlink(link)
        relative_dir = os.path.dirname(os.path.abspath(link))
        full_dest = os.path.join(relative_dir, dest)

    dest = os.path.join(DATA, dest)

    # we have the file but there is not valid link
    if os.path.exists(dest) and not os.path.exists(link):
        os.symlink(dest, os.path.join(IMAGES, os.readlink(link)))

    # The image file in the images directory, may be same as dest
    image_file = os.path.join(IMAGES, os.readlink(link))

    # file already exists, double check that symlink in place
    if not force and os.path.exists(dest):
        if not os.path.exists(image_file):
            os.symlink(os.path.abspath(dest), image_file)
        return

    if not stores:
        config = os.path.expanduser(CONFIG)
        if os.path.exists(config):
            with open(config, 'r') as fp:
                stores = fp.read().strip().split("\n")
        else:
            stores = []
        stores.append(DEFAULT)

    for store in stores:
        try:
            source = os.path.join(store, os.path.basename(dest)) + ".xz"
            subprocess.check_call(["curl", "-s", "-f", "-I", source], stdout=DEVNULL)
            break
        except:
            continue

    sys.stderr.write("{0}\n".format(source))
    (fd, temp) = tempfile.mkstemp(suffix=".partial", prefix=os.path.basename(dest), dir=DATA)
    try:
        curl = subprocess.Popen(["curl", "-#", "-f", source], stdout=subprocess.PIPE)
        unxz = subprocess.Popen(["unxz", "--stdout", "-"], stdin=curl.stdout, stdout=fd)

        curl.stdout.close()
        ret = curl.wait()
        if ret != 0:
            raise Exception("curl: unable to download image (returned: %s)" % ret)
        ret = unxz.wait()
        if ret != 0:
            raise Exception("unxz: unable to unpack image (returned: %s)" % ret)

        os.close(fd)
        os.chmod(temp, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        shutil.move(temp, dest)
    finally:
        # if we had an error and the temp file is left over, delete it
        if os.path.exists(temp):
            os.unlink(temp)

    # Handle alternate TEST_DATA
    if not os.path.exists(image_file):
        os.symlink(os.path.abspath(dest), image_file)

def enough_disk_space():
    """Check if available disk space in our data store is sufficient
    """
    st = os.statvfs(DATA)
    free = st.f_bavail * st.f_frsize / (1024*1024*1024)
    return free >= PRUNE_THRESHOLD_G;

def prune_images(force, dryrun):
    now = time.time()
    targets = []
    for filename in os.listdir(IMAGES):
        path = os.path.join(IMAGES, filename)

        # only consider original image entries as trustworthy sources and ignore non-links
        if path.endswith(".qcow2") or path.endswith(".partial") or not os.path.islink(path):
            continue

        target = os.readlink(path)

        # if the path isn't absolute, it can resolve to either the images directory or here (might be the same)
        if not os.path.isabs(target):
            targets.append(os.path.join(IMAGES, target))
            targets.append(os.path.join(DATA, target))
        else:
            targets.append(target)

    expiry_threshold = now - testinfra.IMAGE_EXPIRE * 86400
    for filename in os.listdir(DATA):
        path = os.path.join(DATA, filename)
        if not force and (enough_disk_space() and os.lstat(path).st_mtime > expiry_threshold):
            continue
        if os.path.isfile(path) and (path.endswith(".qcow2") or path.endswith(".partial")) and path not in targets:
            sys.stderr.write("Pruning {0}\n".format(filename))
            if not dryrun:
                os.unlink(path)

    # now prune broken links
    for filename in os.listdir(IMAGES):
        path = os.path.join(IMAGES, filename)

        # don't prune original image entries and ignore non-links
        if not path.endswith(".qcow2") or not os.path.islink(path):
            continue

        # if the link isn't valid, prune
        if not os.path.isfile(path):
            sys.stderr.write("Pruning link {0}\n".format(path))
            if not dryrun:
                os.unlink(path)

def every_image():
    result = []
    for filename in os.listdir(IMAGES):
        link = os.path.join(IMAGES, filename)
        if os.path.islink(link):
            result.append(filename)
    return result

def download_images(image_list, force, store):
    for image in image_list:
        link = os.path.join(IMAGES, image)
        if not os.path.islink(link):
            raise Exception("image link does not exist: " + image)
        download(link, force, store)

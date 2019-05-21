#!/usr/bin/python3 -u
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

# ensure that this module path is present
machine_dir = os.path.dirname(os.path.realpath(__file__))
if machine_dir not in sys.path:
    sys.path.insert(1, machine_dir)

from machine_core.timeout import Timeout
from machine_core.machine import Machine
from machine_core.exceptions import Failure, RepeatableFailure
from machine_core.machine_virtual import VirtMachine, VirtNetwork, get_build_image, get_test_image
from machine_core.constants import BOTS_DIR, TEST_DIR, IMAGES_DIR, SCRIPTS_DIR, DEFAULT_IMAGE, TEST_OS_DEFAULT
from machine_core.cli import cmd_cli
from machine_core.directories import get_images_data_dir

__all__ = [Timeout, Machine, Failure, RepeatableFailure, VirtMachine, VirtNetwork, get_build_image, get_test_image, get_images_data_dir, BOTS_DIR, TEST_DIR, IMAGES_DIR, SCRIPTS_DIR, DEFAULT_IMAGE, TEST_OS_DEFAULT]

# This can be used as helper program for tests not written in Python: Run given
# image name until SIGTERM or SIGINT; the image must exist in test/images/;
# use image-prepare or image-customize to create that. For example:
# $ bots/image-customize -v -i cockpit centos-7
# $ bots/machine/testvm.py centos-7
if __name__ == "__main__":
    cmd_cli()

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

# Images which are Atomic based
ATOMIC_IMAGES = ["rhel-atomic", "fedora-atomic", "continuous-atomic"]

BOTS_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
TEST_DIR = os.path.join(os.path.dirname(BOTS_DIR), "test")
DEFAULT_IDENTITY_FILE = os.path.join(BOTS_DIR, "machine", "identity")

TEST_OS_DEFAULT = "fedora-28"
DEFAULT_IMAGE = os.environ.get("TEST_OS", TEST_OS_DEFAULT)

# This file is part of Cockpit.
#
# Copyright (C) 2017 Red Hat, Inc.
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

from machine_core.constants import TEST_OS_DEFAULT


def HACK_disable_problematic_preloads(machine):
    # There is something about pre-loading the packagekit page that
    # breaks the CDP of Chromium completely.  This seems to only
    # happen when building with --enable-debug and when the pre-loaded
    # page belongs to a second machine that has been reached via SSH
    # from a first machine.  Thus, we only disable packagekit
    # preloading on selected machines, and only for selected images,
    # in order to confirm or improve this theory.
    if machine.image in [TEST_OS_DEFAULT]:
        machine.write("/usr/share/cockpit/packagekit/override.json", '{ "preload": [ ] }')

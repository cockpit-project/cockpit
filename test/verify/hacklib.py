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


def HACK_disable_problematic_preloads(machine):
    # There is something about pre-loading the packagekit page that
    # breaks the CDP of Chromium completely.  There need to be
    # multiple machines on Cockpit's dashboard, and Cockpit needs to
    # have been build with --enable-debug for this to actually
    # trigger.  Thus, we only disable packagekit preloading on
    # selected machines, and only for selected images.
    if machine.image in ["fedora-30"]:
        machine.write("/usr/share/cockpit/packagekit/override.json", '{ "preload": [ ] }')

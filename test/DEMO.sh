#! /bin/bash
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

# While this script can be executed, it is meant to show the most
# common things that you will be doing when running tests.

export TEST_OS=fedora-20
export TEST_ARCH=x86_64

set -e -x

# Get the Fedora bootstrap tarball if necessary.
#
if [ ! -f fedora-20-x86_64.tar.gz ]; then
  curl -O https://dl.dropboxusercontent.com/s/73o8zc73dze771b/fedora-20-x86_64.tar.gz
fi

# Compile the sources
#
./make-rpms

# Make the test machine image and install the RPMs into it
#
./vm-create
./vm-install cockpit-wip-1.fc20.x86_64.rpm cockpit-test-assets-wip-1.fc20.x86_64.rpm

# Run some tests.  This will _not_ change the test machine image.
#
./check-shutdown-restart

# And some more tests.
#
./check-realms

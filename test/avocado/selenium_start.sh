#!/bin/bash
#
# Copyright (C) 2015 Red Hat Inc.
# Author: Dominik Perpeet <dperpeet@redhat.com>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA
# 02110-1301 USA.

set -e
TICKS=120

function wait_curl(){
    LINK=$1
    GREP_CMD=$2
    FOUND=""
    FULLLINK="http://localhost:4444$LINK"
    for foo in `seq $TICKS`; do
        if curl -s --connect-timeout 1 $FULLLINK | grep "$GREP_CMD" >/dev/null; then
            echo "$FULLLINK ('$GREP_CMD' available on page)" >&2
            FOUND="yes"
            break
        else
            sleep 0.5
        fi
    done
    if [ -z "$FOUND" ]; then
        echo "ERROR: $FULLLINK ('$GREP_CMD' not available)" >&2
        return 1
    fi
}

# Make sure docker is up and running
systemctl start docker

docker run  -d -p 4444:4444 --name selenium-hub selenium/hub:2.48.2 2> >(grep -v 'Usage of loopback devices' >&2)
wait_curl /grid/console "Grid Console"
docker run -d --link selenium-hub:hub selenium/node-chrome:2.48.2 2> >(grep -v 'Usage of loopback devices' >&2)
wait_curl /grid/console "googlechrome"
docker run -d --link selenium-hub:hub selenium/node-firefox:2.48.2 2> >(grep -v 'Usage of loopback devices' >&2)
wait_curl /grid/console "firefox"

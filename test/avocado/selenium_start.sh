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

docker run  -d -p 4444:4444 --name selenium-hub selenium/hub:3
wait_curl /grid/console "Grid Console"
docker run -d --shm-size=512M --link selenium-hub:hub -p 5901:5900 -e VNC_NO_PASSWORD=1 selenium/node-chrome-debug:3
wait_curl /grid/console "browserName: chrome"
docker run -d --shm-size=512M --link selenium-hub:hub -p 5902:5900 -e VNC_NO_PASSWORD=1 selenium/node-firefox-debug:3
wait_curl /grid/console "browserName: firefox"

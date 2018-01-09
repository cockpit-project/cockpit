#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2017 Slavek Kabrda
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

import gzip
import json
import sys

def failures(item):
    return item.get("status") == "failure"

def load(filename_or_fp, only=failures, limit=None, verbose=False):
    count = 0
    opened = False
    if isinstance(filename_or_fp, str):
        fp = gzip.open(filename_or_fp, 'rb')
        opened = True
    else:
        fp = filename_or_fp
    try:
        while True:
            line = fp.readline().decode('utf-8')
            if not line:
                return

            # Parse the line
            item = json.loads(line)

            # Now actually check for only values
            if only is not None and not only(item):
                continue

            yield item
            count += 1
            if verbose and count % 1000 == 0:
                sys.stderr.write("{0}: Items loaded\r".format(count))
            if limit is not None and count == limit:
                return
    finally:
        if opened:
            fp.close()

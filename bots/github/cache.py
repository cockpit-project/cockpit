#!/usr/bin/env python
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2015 Red Hat, Inc.
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

# Shared GitHub code. When run as a script, we print out info about
# our GitHub interacition.

import json
import os
import stat
import sys
import tempfile
import time
import urllib

__all__ = (
    'Cache',
)

class Cache(object):
    def __init__(self, directory):
        self.directory = directory
        if not os.path.exists(self.directory):
            os.makedirs(self.directory)
        self.prune()

    def prune(self):
        now = time.time()
        for filename in os.listdir(self.directory):
            path = os.path.join(self.directory, filename)
            if os.path.isfile(path) and os.stat(path).st_mtime < now - 7 * 86400:
                os.remove(path)

    def read(self, resource):
        path = os.path.join(self.directory, urllib.quote(resource, safe=''))
        if not os.path.exists(path):
            return None
        with open(path, 'r') as fp:
            try:
                return json.load(fp)
            except ValueError:
                return None

    def write(self, resource, contents):
        path = os.path.join(self.directory, urllib.quote(resource, safe=''))
        (fd, temp) = tempfile.mkstemp(dir=self.directory)
        with os.fdopen(fd, 'w') as fp:
            json.dump(contents, fp)
        os.chmod(temp, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        os.rename(temp, path)

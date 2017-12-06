#!/usr/bin/python3
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
import tempfile
import time
import urllib.request, urllib.parse, urllib.error

__all__ = (
    'Cache',
)

class Cache(object):
    def __init__(self, directory, lag=None):
        self.directory = directory
        self.pruned = False

        # Default to zero lag when command on command line
        if lag is None:
            if os.isatty(0):
                lag = 0
            else:
                lag = 60

        # The lag tells us how long to assume cached data is "current"
        self.lag = lag

        # The mark tells us that stuff before this time is not "current"
        self.marked = 0

    # Prune old expired data from the cache directory
    def prune(self):
        if not os.path.exists(self.directory):
            return
        now = time.time()
        try:
            for filename in os.listdir(self.directory):
                path = os.path.join(self.directory, filename)
                if os.path.isfile(path) and os.stat(path).st_mtime < now - 7 * 86400:
                    os.remove(path)
        except OSError:
            pass

    # Read a resource from the cache or return None
    def read(self, resource):
        path = os.path.join(self.directory, urllib.parse.quote(resource, safe=''))
        try:
            with open(path, 'r') as fp:
                return json.load(fp)
        except (IOError, ValueError):
            return None

    # Write a resource to the cache in an atomic way
    def write(self, resource, contents):
        path = os.path.join(self.directory, urllib.parse.quote(resource, safe=''))
        if not os.path.exists(self.directory):
            os.makedirs(self.directory)
        (fd, temp) = tempfile.mkstemp(dir=self.directory)
        with os.fdopen(fd, 'w') as fp:
            json.dump(contents, fp)
        os.chmod(temp, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        os.rename(temp, path)
        if not self.pruned:
            self.pruned = True
            self.prune()

    # Tell the cache that stuff before this time is not "current"
    def mark(self, mtime=None):
        if not mtime:
            mtime = time.time()
        self.marked = mtime

    # Check if a given resource in the cache is "current" or not
    def current(self, resource):
        path = os.path.join(self.directory, urllib.parse.quote(resource, safe=''))
        try:
            mtime = os.path.getmtime(path)
            return mtime > self.marked and mtime > (time.time() - self.lag)
        except OSError:
            return False

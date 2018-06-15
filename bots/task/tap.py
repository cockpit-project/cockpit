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

# Common functions for processing task and test output

import re

# These are lines that we preprocess away. Most of the noise can be
# found by the machine learning, but these are examples of lines that
# vary too much in the test corpus, and we normalize them.
#
# When the right hand side matches, we replace with left
NOISE = {
    "Wrote file": re.compile("^Wrote.*\.(png|html|log)"),
    "Journal extracted": re.compile("^Journal extracted to.*\.log"),
    "Core dumps downloaded": re.compile("^Core dumps downloaded to.*\.core"),
    "not ok": re.compile("^not ok.*"),
    "ok": re.compile("^ok.*"),
    "": re.compile("^# Flake.*"),
    'File "\\1"': re.compile('^File "/[^"]+/([^/]+)"'),
    "### ": re.compile('^#{3,80}\s+'),
}

# Normalize a line of tests according to noise
def normalize(line):
    for substitute, pattern in NOISE.items():
        line = pattern.sub(substitute, line)
    return line

# Generate (status, name, body, tracker) for each Test Anything Protocol test
# in the content.
#
# status: possible values "success", "failure", "skip"
# name: the name of the test
# body: full log of the test
# tracker: url tracking the failure, or None
def parse(content, prefix=None, blocks=False):
    name = status = tracker = None
    body = [ ]
    for line in content.split('\n'):
        # The test intro, everything before here is fluff
        if not prefix and line.startswith("1.."):
            prefix = line
            body = [ ]
            name = status = tracker = None

        # A TAP test status line
        elif line.startswith("ok ") or line.startswith("not ok "):
            body.append(normalize(line))
            # Parse out the status
            if line.startswith("not ok "):
                status = "failure"
                line = line[7:]
            else:
                line = line[3:]
                if "# SKIP KNOWN ISSUE" in line.upper():
                    status = "failure"
                    (unused, delim, issue) = line.partition("#")
                    tracker = issue
                if "# SKIP" in line.upper():
                    status = "skip"
                else:
                    status = "success"
            # Parse out the name
            while line[0].isspace() or line[0].isdigit():
                line = line[1:]
            (name, delim, directive) = line.partition("#")
            (name, delim, directive) = name.partition("duration")
            name = name.strip()
            # Old Cockpit tests had strange blocks
            if not blocks:
                yield (status, name, "\n".join(body), tracker)
                status = name = tracker = None
                body = [ ]
        else:
            # Old Cockpit tests didn't separate bound their stuff properly
            if line.startswith("# --------------------"):
                blocks = True
                if status:
                    yield (status, name, "\n".join(body), tracker)
                name = status = tracker = None
                body = [ ]
            body.append(normalize(line))

    if status:
        yield (status, name, "\n".join(body), tracker)


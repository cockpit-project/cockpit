#!/usr/bin/python2
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

from avocado import main
from avocado import Test
import sys
import os
sys.path.append(os.path.abspath(os.path.dirname(__file__)))
import cockpit


class checkexample_foo(Test):
    """
    Example test for cockpit
    """

    def test(self):
        c = cockpit.Cockpit()
        b = c.browser

        b.open("/system")
        b.wait_visible("#login")

if __name__ == "__main__":
    main()

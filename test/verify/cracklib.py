# This file is part of Cockpit.
#
# Copyright (C) 2021 Red Hat, Inc.
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

import re
import base64
import subprocess


def assert_no_password_in_bridges(machine, user, passwd):
    passwd_b64 = base64.b64encode(passwd.encode("utf-8")).decode("ascii")
    basic_auth = base64.b64encode((user + ":" + passwd).encode("utf-8")).decode("ascii")

    regex = '%s\|%s\|%s' % (re.escape(passwd),
                            re.escape(passwd_b64),
                            re.escape(basic_auth))

    bridge_pids = machine.execute("pgrep cockpit-bridge").split()
    for pid in bridge_pids:
        try:
            machine.execute("pid=%s; gcore $pid && ! grep '%s' core.$pid" % (pid, regex))
        except subprocess.CalledProcessError:
            print("Password found, but that's fine...")

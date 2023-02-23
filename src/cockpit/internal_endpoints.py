# This file is part of Cockpit.
#
# Copyright (C) 2022 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import grp
import logging
import os
import pwd

from typing import Optional

from ._vendor.systemd_ctypes import bus

logger = logging.getLogger(__name__)


class cockpit_LoginMessages(bus.Object):
    messages: Optional[str] = None

    def __init__(self):
        fdstr = os.environ.pop('COCKPIT_LOGIN_MESSAGES_MEMFD', None)
        if fdstr is None:
            logger.debug("COCKPIT_LOGIN_MESSAGES_MEMFD wasn't set.  No login messages today.")
            return

        logger.debug("Trying to read login messages from fd %s", fdstr)
        try:
            with open(int(fdstr), 'r') as login_messages:
                login_messages.seek(0)
                self.messages = login_messages.read()
        except (ValueError, OSError, UnicodeDecodeError) as exc:
            # ValueError - the envvar wasn't an int
            # OSError - the fd wasn't open, or other read failure
            # UnicodeDecodeError - didn't contain utf-8
            # For all of these, we simply failed to get the message.
            logger.debug("Reading login messages failed: %s", exc)
        else:
            logger.debug("Successfully read login messages: %s", self.messages)

    @bus.Interface.Method(out_types=['s'])
    def get(self):
        return self.messages or '{}'

    @bus.Interface.Method(out_types=[])
    def dismiss(self):
        self.messages = None


class cockpit_Machines(bus.Object):
    machines = bus.Interface.Property('a{sa{sv}}', value={})

    @bus.Interface.Method(in_types=['s', 's', 'a{sv}'])
    def update(self, *args):
        ...


class cockpit_User(bus.Object):
    name = bus.Interface.Property('s', value='')
    full = bus.Interface.Property('s', value='')
    id = bus.Interface.Property('i', value=0)
    home = bus.Interface.Property('s', value='')
    shell = bus.Interface.Property('s', value='')
    groups = bus.Interface.Property('as', value=[])

    def __init__(self):
        user = pwd.getpwuid(os.getuid())
        self.name = user.pw_name
        self.full = user.pw_gecos
        self.id = user.pw_uid
        self.home = user.pw_dir
        self.shell = user.pw_shell
        self.groups = [gr.gr_name for gr in grp.getgrall() if user.pw_name in gr.gr_mem]


EXPORTS = [
    ('/LoginMessages', cockpit_LoginMessages),
    ('/machines', cockpit_Machines),
    ('/user', cockpit_User),
]

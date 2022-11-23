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
import socket

from systemd_ctypes import bus

logger = logging.getLogger(__name__)


class cockpit_Config(bus.Object):
    def __init__(self):
        ...

    @bus.Interface.Method(out_types='u', in_types='suuu')
    def get_u_int(self, name, _minimum, default, _maximum):
        return default


class cockpit_LoginMessages(bus.Object):
    ...


class cockpit_Machines(bus.Object):
    machines = bus.Interface.Property('a{sa{sv}}', value={})

    @bus.Interface.Method(in_types=['s', 's', 'a{sv}'])
    def update(self, *args):
        ...


class cockpit_Packages(bus.Object):
    ...


class cockpit_Superuser(bus.Object):
    bridges = bus.Interface.Property('as', value=['sudo', 'pkexec'])
    current = bus.Interface.Property('s', value='none')

    @bus.Interface.Method(in_types=['s'])
    def start(self, _bridge):
        ...

    @bus.Interface.Method()
    def stop(self):
        ...

    @bus.Interface.Method(in_types=['s'])
    def answer(self, reply):
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


class InternalEndpoints:
    server = None
    client = None
    slots = None

    @classmethod
    def create(cls):
        client_socket, server_socket = socket.socketpair()
        cls.client = bus.Bus.new(fd=client_socket.detach())
        cls.server = bus.Bus.new(fd=server_socket.detach(), server=True)

        cls.slots = [
            cls.server.add_object('/LoginMessages', cockpit_LoginMessages()),
            cls.server.add_object('/config', cockpit_Config()),
            cls.server.add_object('/machines', cockpit_Machines()),
            cls.server.add_object('/packages', cockpit_Packages()),
            cls.server.add_object('/superuser', cockpit_Superuser()),
            cls.server.add_object('/user', cockpit_User()),
        ]

    @classmethod
    def get_client(cls):
        if cls.client is None:
            cls.create()
        return cls.client

    @classmethod
    def get_server(cls):
        if cls.server is None:
            cls.create()
        return cls.server

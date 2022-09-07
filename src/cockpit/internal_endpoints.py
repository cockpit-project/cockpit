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

from systemd_ctypes import bus

logger = logging.getLogger(__name__)


class ConfigEndpoint(bus.Object):
    def __init__(self):
        ...

    @bus.Object.method(out_types='u', in_types='suuu')
    def get_u_int(self, name, _minimum, default, _maximum):
        return default


@bus.Object.interface('cockpit.LoginMessages')
class LoginMessagesEndpoint(bus.Object):
    ...


@bus.Object.interface('cockpit.Machines')
class MachinesEndpoint(bus.Object):
    @bus.Object.method(in_types=['s', 's', 'a{sv}'])
    def update(self, *args):
        ...

    @bus.Object.property('a{sa{sv}}')
    def machines(self):
        return {}


@bus.Object.interface('cockpit.Packages')
class PackagesEndpoint(bus.Object):
    ...


@bus.Object.interface('cockpit.Superuser')
class SuperuserEndpoint(bus.Object):
    @bus.Object.method(in_types=['s'])
    def start(self, _bridge):
        ...

    @bus.Object.method()
    def stop(self):
        ...

    @bus.Object.method(in_types=['s'])
    def answer(self, reply):
        ...

    @bus.Object.property('as')
    def bridges(self):
        return ['sudo', 'pkexec']

    @bus.Object.property('s')
    def current(self):
        return 'root'


@bus.Object.interface('cockpit.User')
class UserEndpoint(bus.Object):
    def __init__(self):
        self.pwd = pwd.getpwuid(os.getuid())

    @bus.Object.property('s', 'Name')
    def name(self):
        return self.pwd.pw_name

    @bus.Object.property('s', 'Full')
    def full(self):
        return self.pwd.pw_gecos

    @bus.Object.property('i', 'Id')
    def id(self):
        return self.pwd.pw_uid

    @bus.Object.property('s', 'Home')
    def home(self):
        return self.pwd.pw_dir

    @bus.Object.property('s', 'Shell')
    def shell(self):
        return self.pwd.pw_shell

    @bus.Object.property('as', 'Groups')
    def groups(self):
        return [gr.gr_name for gr in grp.getgrall() if self.pwd.pw_name in gr.gr_mem]


class InternalEndpoints:
    server = None
    client = None
    slots = None

    @classmethod
    def create(cls):
        cls.client, cls.server = bus.Bus.socketpair(attach_event=True)
        cls.slots = [
            cls.server.add_object('/LoginMessages', LoginMessagesEndpoint()),
            cls.server.add_object('/config', ConfigEndpoint()),
            cls.server.add_object('/machines', MachinesEndpoint()),
            cls.server.add_object('/packages', PackagesEndpoint()),
            cls.server.add_object('/superuser', SuperuserEndpoint()),
            cls.server.add_object('/user', UserEndpoint()),
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

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
import json
import logging
import os
import pwd

from ..channel import Channel

logger = logging.getLogger(__name__)


def internal_dbus_call(path, _iface, method, args):
    if path == '/user':
        if method == 'GetAll':
            user = pwd.getpwuid(os.getuid())
            groups = [gr.gr_name for gr in grp.getgrall() if user.pw_name in gr.gr_mem]
            attrs = {"Name": user.pw_name, "Full": user.pw_gecos, "Id": user.pw_uid,
                     "Home": user.pw_dir, "Shell": user.pw_shell, "Groups": groups}
            types = {str: "s", list: "as", int: "i"}
            return [{k: {"t": types[v.__class__], "v": v} for k, v in attrs.items()}]

    elif path == '/config':
        if method == 'GetUInt':
            return [args[2]]  # default value

    elif path == '/superuser':
        return []

    elif path == '/packages':
        return []

    elif path == '/LoginMessages':
        return ['{}']

    raise ValueError('unknown call', path, method)


class DBusInternalChannel(Channel):
    payload = 'dbus-json3'
    restrictions = {'bus': 'internal'}

    def do_open(self, options):
        self.ready()

    def do_data(self, data):
        logger.debug('dbus recv %s', data)
        message = json.loads(data)
        if 'add-match' in message:
            pass
        elif 'watch' in message:
            if 'path' in message['watch'] and message['watch']['path'] == '/superuser':
                self.send_message(meta={
                    "cockpit.Superuser": {
                        "methods": {
                            "Start": {
                                "in": ["s"],
                                "out": []
                            },
                            "Stop": {
                                "in": [],
                                "out": []
                            },
                            "Answer": {
                                "in": ["s"],
                                "out": []
                            }
                        },
                        "properties": {
                            "Bridges": {
                                "flags": "r",
                                "type": "as"
                            },
                            "Current": {
                                "flags": "r",
                                "type": "s"
                            }
                        },
                        "signals": {}
                    }
                })
                self.send_message(notify={
                    "/superuser": {
                        "cockpit.Superuser": {
                            "Bridges": ['sudo', 'pkexec'],
                            "Current": "root"
                        }
                    }
                })

            elif 'path' in message['watch'] and message['watch']['path'] == '/machines':
                self.send_message(meta={
                    "cockpit.Machines": {
                        "methods": {
                            "Update": {"in": ["s", "s", "a{sv}"], "out": []}
                        },
                        "properties": {
                            "Machines": {
                                "flags": "r",
                                "type": "a{sa{sv}}"
                            }
                        },
                        "signals": {}
                    }
                })
                self.send_message(notify={"/machines": {"cockpit.Machines": {"Machines": {}}}})

            self.send_message(reply=[], id=message['id'])
        elif 'call' in message:
            reply = internal_dbus_call(*message['call'])
            self.send_message(reply=[reply], id=message['id'])
        else:
            raise ValueError('unknown dbus method', message)

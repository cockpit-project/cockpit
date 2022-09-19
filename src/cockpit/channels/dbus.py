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

import asyncio
import errno
import json
import logging
import xml.etree.ElementTree as ET

from systemd_ctypes import Bus, BusError, introspection

from ..channel import Channel, ChannelError
from ..internal_endpoints import InternalEndpoints

logger = logging.getLogger(__name__)


class InterfaceCache:
    def __init__(self):
        self.cache = {}

    async def introspect_path(self, bus, destination, object_path):
        xml, = await bus.call_method_async(destination, object_path, 'org.freedesktop.DBus.Introspectable', 'Introspect')

        et = ET.fromstring(xml)

        interfaces = {tag.attrib['name']: introspection.parse_interface(tag) for tag in et.findall('interface')}

        # Add all interfaces we found: we might use them later
        self.cache.update(interfaces)

        return interfaces

    async def get_interface(self, interface_name, bus=None, destination=None, object_path=None):
        try:
            return self.cache[interface_name]
        except KeyError:
            pass

        if bus and object_path:
            try:
                await self.introspect_path(bus, destination, object_path)
            except BusError:
                pass

        return self.cache.get(interface_name)

    async def get_signature(self, interface_name, method, bus=None, destination=None, object_path=None):
        interface = await self.get_interface(interface_name, bus, destination, object_path)
        if interface is None:
            raise KeyError(f'Interface {interface_name} is not found')

        return ''.join(interface['methods'][method]['in'])


class DBusChannel(Channel):
    payload = 'dbus-json3'

    tasks = None
    matches = None
    name = None
    bus = None

    def do_open(self, options):
        self.cache = InterfaceCache()
        self.name = options.get('name')
        self.matches = []
        self.tasks = set()

        bus = options.get('bus')

        if bus == 'internal':
            self.bus = InternalEndpoints.get_client()
        else:
            try:
                if bus == 'session':
                    logger.debug('get session bus for %s', self.name)
                    self.bus = Bus.default_user()
                else:
                    logger.debug('get system bus for %s', self.name)
                    self.bus = Bus.default_system()
            except OSError as exc:
                raise ChannelError('protocol-error', message=f'failed to connect to {bus} bus: {exc}') from exc

        try:
            self.bus.attach_event(None, 0)
        except OSError as err:
            if err.errno != errno.EBUSY:
                raise

        self.ready()

    def match_hit(self, message):
        logger.debug('got match')
        self.send_message(signal=[
            message.get_path(),
            message.get_interface(),
            message.get_member(),
            list(message.get_body())
        ])

    async def do_call(self, call, message):
        path, iface, method, args = call
        timeout = message.get('timeout')
        cookie = message.get('id')
        flags = message.get('flags')

        # We have to figure out the signature of the call.  Either we got told it:
        signature = message.get('type')

        # ... or there aren't any arguments
        if signature is None and len(args) == 0:
            signature = ''

        # ... or we need to introspect
        if signature is None:
            try:
                logger.debug('Doing introspection request for %s %s', iface, method)
                signature = await self.cache.get_signature(iface, method, self.bus, self.name, path)
            except BusError as error:
                self.send_message(error=[error.name, [f'Introspection: {error.message}']], id=cookie)
                return
            except Exception as exc:
                self.send_message(error=['python.error', [f'Introspection: {str(exc)}']], id=cookie)
                return

        try:
            reply = await self.bus.call_method_async(self.name, path, iface, method, signature, *args, timeout=timeout)
            # TODO: stop hard-coding the endian flag here.
            self.send_message(reply=[reply], id=cookie, flags="<" if flags is not None else None)
        except BusError as error:
            # actually, should send the fields from the message body
            self.send_message(error=[error.name, [error.message]], id=cookie)
        except Exception as exc:
            self.send_message(error=['python.error', [str(exc)]], id=cookie)

    async def do_add_match(self, add_match, message):
        rule = ','.join(f"{key}='{value}'" for key, value in add_match.items())
        logger.debug('adding match %s', add_match)
        self.matches.append(self.bus.add_match("type='signal'," + rule, self.match_hit))
        self.send_message(reply=[], id=message.get('id'))

    async def do_watch(self, watch, message):
        path = watch.get('path')
        path_namespace = watch.get('path_namespace')
        cookie = message.get('id')
        interface_name = message.get('interface')

        path = path or path_namespace

        if path is None or cookie is None:
            logger.debug('ignored incomplete watch request %s', message)
            self.send_message(error=['x.y.z', ['Not Implemented']], id=cookie)
            self.send_message(reply=[], id=cookie)
            return

        try:
            meta = await self.cache.introspect_path(self.bus, self.name, path)
        except BusError as error:
            self.send_message(error=[error.name, [error.message]], id=cookie)
            return

        if interface_name is not None:
            interface = meta.get(interface_name)
            meta = {interface_name: interface}

        self.send_message(meta=meta)

        def handler(message):
            notify = message.get_body()
            logger.debug('NOTIFY: %s', notify)
            self.send_message(notify={path: notify})

        self.matches.append(self.bus.add_match(f"type='signal',sender='{self.name}',path='{path}',interface='org.freedesktop.DBus.Properties'", handler))

        notify = {}
        for name, interface in meta.items():
            try:
                props, = await self.bus.call_method_async(self.name, path, 'org.freedesktop.DBus.Properties', 'GetAll', 's', name)
                notify[name] = {k: v['v'] for k, v in props.items()}
            except BusError:
                pass

        self.send_message(notify={path: notify})
        self.send_message(reply=[], id=message['id'])

    def do_data(self, data):
        message = json.loads(data)
        logger.debug('receive dbus request %s %s', self.name, message)

        if call := message.get('call'):
            task = asyncio.create_task(self.do_call(call, message))
        elif add_match := message.get('add-match'):
            task = asyncio.create_task(self.do_add_match(add_match, message))
        elif watch := message.get('watch'):
            task = asyncio.create_task(self.do_watch(watch, message))
        else:
            logger.debug('ignored dbus request %s', message)
            return

        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

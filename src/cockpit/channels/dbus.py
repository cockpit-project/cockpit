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

from ..channel import Channel
from ..internal_endpoints import InternalEndpoints

logger = logging.getLogger(__name__)


class InterfaceCache:
    def __init__(self):
        self.cache = {}
        self.old = set()  # Interfaces already returned by get_interface_if_new

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

        if bus and destination and object_path:
            try:
                await self.introspect_path(bus, destination, object_path)
            except BusError:
                pass

        return self.cache.get(interface_name)

    async def get_interface_if_new(self, interface_name, bus, destination, object_path):
        if interface_name in self.old:
            return None
        self.old.add(interface_name)
        return await self.get_interface(interface_name, bus, destination, object_path)

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

    # This needs to be a fair mutex so that outgoing messages don't
    # get re-ordered.  asyncio.Lock is fair.
    watch_processing_lock = asyncio.Lock()

    def do_open(self, options):
        self.cache = InterfaceCache()
        self.name = options.get('name')
        self.matches = []
        self.tasks = set()

        bus = options.get('bus')

        if bus == 'internal':
            self.bus = InternalEndpoints.get_client()
        elif bus == 'session':
            logger.debug('get session bus for %s', self.name)
            self.bus = Bus.default_user()
        else:
            logger.debug('get system bus for %s', self.name)
            self.bus = Bus.default_system()

        try:
            self.bus.attach_event(None, 0)
        except OSError as err:
            if err.errno != errno.EBUSY:
                raise

        self.ready()

    def match_hit(self, message):
        logger.debug('got match')

        async def handler_async(message):
            async with self.watch_processing_lock:
                self.send_message(signal=[
                    message.get_path(),
                    message.get_interface(),
                    message.get_member(),
                    list(message.get_body())
                ])

        task = asyncio.create_task(handler_async(message))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def do_call(self, call, message):
        path, iface, method, args = call
        timeout = message.get('timeout')
        cookie = message.get('id')
        flags = message.get('flags')

        # We have to figure out the signature of the call.  Either we got told it:
        signature = message.get('type')

        # ... or all of our arguments are string (and we can guess):
        if signature is None and all(isinstance(arg, str) for arg in args):
            signature = 's' * len(args)

        # ... or we need to introspect
        if signature is None:
            try:
                logger.debug('Doing introspection request for %s %s', iface, method)
                signature = await self.cache.get_signature(iface, method, self.bus, self.name, path)
            except BusError as error:
                self.send_message(error=[error.code, [f'Introspection: {error.description}']], id=cookie)
                return
            except Exception as exc:
                self.send_message(error=['python.error', [f'Introspection: {str(exc)}']], id=cookie)
                return

        try:
            reply = await self.bus.call_method_async(self.name, path, iface, method, signature, *args,
                                                     timeout=timeout)
            # If the method call has kicked off any signals related to
            # watch processing, wait for that to be done.
            async with self.watch_processing_lock:
                # TODO: stop hard-coding the endian flag here.
                self.send_message(reply=[reply], id=cookie, flags="<" if flags is not None else None)
        except BusError as error:
            # actually, should send the fields from the message body
            self.send_message(error=[error.code, [error.description]], id=cookie)
        except Exception as exc:
            self.send_message(error=['python.error', [str(exc)]], id=cookie)

    async def do_add_match(self, add_match, message):
        rule = ','.join(f"{key}='{value}'" for key, value in add_match.items())
        logger.debug('adding match %s', add_match)
        self.matches.append(self.bus.add_match("type='signal'," + rule, self.match_hit))
        self.send_message(reply=[], id=message.get('id'))

    async def setup_objectmanager_watch(self, path, interface_name, meta, notify):
        # Watch the objects managed by the ObjectManager at "path".
        # Properties are not watched, that is done by setup_path_watch
        # below.

        async def om_interfaces_added(path, interface_props):
            meta = {}
            notify = {}
            async with self.watch_processing_lock:
                for name, props in interface_props.items():
                    if interface_name is None or name == interface_name:
                        mm = await self.cache.get_interface_if_new(name, self.bus, self.name, path)
                        if mm:
                            meta.update({ name: mm })
                        notify.update({ path: { name: {k: v['v'] for k, v in props.items()} }})
                self.send_message(meta=meta)
                self.send_message(notify=notify)

        def om_handler(message):
            member = message.get_member()
            if member == "InterfacesAdded":
                (path, interface_props) = message.get_body()
                logger.debug('interfaces added %s %s', path, interface_props)
                task = asyncio.create_task(om_interfaces_added(path, interface_props))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)
            elif member == "InterfacesRemoved":
                (path, interfaces) = message.get_body()
                logger.debug('interfaces removed %s %s', path, interfaces)
                notify = { path: { name: None for name in interfaces } }
                self.send_message(notify=notify)

        self.matches.append(self.bus.add_match(f"type='signal',sender='{self.name}',path='{path}',interface='org.freedesktop.DBus.ObjectManager'", om_handler))
        objects, = await self.bus.call_method_async(self.name, path, 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects')
        for p, ifaces in objects.items():
            for iface, props in ifaces.items():
                if interface_name is None or iface == interface_name:
                    mm = await self.cache.get_interface_if_new(iface, self.bus, self.name, p)
                    if mm:
                        meta.update({ iface: mm })
                        notify.update({ p: { iface: {k: v['v'] for k, v in props.items()} }})

    async def setup_path_watch(self, path, interface_name, recursive_props, meta, notify):
        # Watch a single object at "path"

        async def handler_async(message):
            async with self.watch_processing_lock:
                path = message.get_path()
                notify = message.get_body()
                logger.debug('NOTIFY: %s', notify)
                self.send_message(notify={path: notify})

        def handler(message):
            task = asyncio.create_task(handler_async(message))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

        this_meta = await self.cache.introspect_path(self.bus, self.name, path)
        if interface_name is not None:
            interface = this_meta.get(interface_name)
            this_meta = {interface_name: interface}
        meta.update(this_meta)
        path_keyword = "path_namespace" if recursive_props else "path"
        self.matches.append(self.bus.add_match(f"type='signal',sender='{self.name}',{path_keyword}='{path}',interface='org.freedesktop.DBus.Properties'", handler))
        for name, interface in meta.items():
            if name.startswith("org.freedesktop.DBus."):
                continue
            try:
                props, = await self.bus.call_method_async(self.name, path, 'org.freedesktop.DBus.Properties', 'GetAll', 's', name)
                notify.update({ path: { name: {k: v['v'] for k, v in props.items()} }})
            except BusError as error:
                pass

    async def do_watch(self, watch, message):
        path = watch.get('path')
        path_namespace = watch.get('path_namespace')
        cookie = message.get('id')
        interface_name = message.get('interface')

        path = path or path_namespace
        recursive = path == path_namespace

        if path is None or cookie is None:
            logger.debug('ignored incomplete watch request %s', message)
            self.send_message(error=['x.y.z', ['Not Implemented']], id=cookie)
            self.send_message(reply=[], id=cookie)
            return

        try:
            async with self.watch_processing_lock:
                meta = {}
                notify = {}
                await self.setup_path_watch(path, interface_name, recursive, meta, notify)
                if recursive:
                    await self.setup_objectmanager_watch(path, interface_name, meta, notify)
                self.send_message(meta=meta)
                self.send_message(notify=notify)
                self.send_message(reply=[], id=message['id'])
        except BusError as error:
            self.send_message(error=[error.code, [error.description]], id=cookie)

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

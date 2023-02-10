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

# Missing stuff compared to the C bridge that we should probably add:
#
# - connecting to given address instead of bus
# - some more ways to connect to the internal bus (like { bus: "none", address: "internal" })
# - removing matches
# - removing watches
# - emitting of signals
# - publishing of objects
# - failing more gracefully in some cases (during open, etc)
#
# Stuff we might or might not do:
#
# - using non-default service names
#
# Stuff we should probably not do:
#
# - emulation of ObjectManager via recursive introspection
# - automatic detection of ObjectManager below the given path_namespace
# - recursive scraping of properties for new object paths
#   (for path_namespace watches that don't hit an ObjectManager)

import asyncio
import errno
import json
import logging
import traceback
import xml.etree.ElementTree as ET

from systemd_ctypes import Bus, BusError, introspection

from ..channel import Channel, ChannelError

logger = logging.getLogger(__name__)

# The dbusjson3 payload
#
# This channel payload type translates JSON encoded messages on a
# Cockpit channel to D-Bus messages, in a mostly straightforward way.
# See doc/protocol.md for a description of the basics.
#
# However, dbusjson3 offers some advanced features as well that are
# meant to support the "magic" DBusProxy objects implemented by
# cockpit.js.  Those proxy objects "magically" expose all the methods
# and properties of a D-Bus interface without requiring any explicit
# binding code to be generated for a JavaScript client.  A dbusjson3
# channel does this by doing automatic introspection and property
# retrieval without much direction from the JavaScript client.
#
# The details of what exactly is done is not speficied very strictly,
# and the Python bridge will likely differ from the C bridge
# significantly. This will be informed by what existing code actually
# needs, and we might end up with a more concrete description of what
# a client can actually expect.
#
# Here is an example of a more complex scenario:
#
# - The client adds a "watch" for a path namespace.  There is a
#   ObjectManager at the given path and the bridge emits "meta" and
#   "notify" messages to describe all interfaces and objects reported
#   by that ObjectManager.
#
# - The client makes a method call that causes a new object with a new
#   interface to appear at the ObjectManager.  The bridge will send a
#   "meta" and "notify" message to describe this new object.
#
# - Since the InterfacesAdded signal was emitted before the method
#   reply, the bridge must send the "meta" and "notify" messages
#   before the method reply message.
#
# - However, in order to construct the "meta" message, the bridge must
#   perform a Introspect call, and consequently must delay sending the
#   method reply until that call has finished.
#
# The Python bridge implements this delaying of messages with
# coroutines and a fair mutex. Every message coming from D-Bus will
# wait on the mutex for its turn to send its message on the Cockpit
# channel, and will keep that mutex locked until it is done with
# sending.  Since the mutex is fair, everyone will nicely wait in line
# without messages getting re-ordered.
#
# The scenario above will play out like this:
#
# - While adding the initial "watch", the lock is held until the
#   "meta" and "notify" messages have been sent.
#
# - Later, when the InterfacesAdded signal comes in that has been
#   triggered by the method call, the mutex will be locked while the
#   necessary introspection is going on.
#
# - The method reply will likely come while the mutex is locked, and
#   the task for sending that reply on the Cockpit channel will enter
#   the wait queue of the mutex.
#
# - Once the introspection is done and the new "meta" and "notify"
#   messages have been sent, the mutex is unlocked, the method reply
#   task acquires it, and sends its message.


class InterfaceCache:
    def __init__(self):
        self.cache = {}
        self.old = set()  # Interfaces already returned by get_interface_if_new

    def inject(self, interfaces):
        self.cache.update(interfaces)

    async def introspect_path(self, bus, destination, object_path):
        xml, = await bus.call_method_async(destination, object_path, 'org.freedesktop.DBus.Introspectable', 'Introspect')

        et = ET.fromstring(xml)

        interfaces = {tag.attrib['name']: introspection.parse_interface(tag) for tag in et.findall('interface')}

        # Add all interfaces we found: we might use them later
        self.inject(interfaces)

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


def notify_update(notify, path, interface_name, props):
    notify.setdefault(path, {})[interface_name] = {k: v['v'] for k, v in props.items()}


class DBusChannel(Channel):
    payload = 'dbus-json3'

    tasks = None
    matches = None
    name = None
    bus = None
    owner = None

    # This needs to be a fair mutex so that outgoing messages don't
    # get re-ordered.  asyncio.Lock is fair.
    watch_processing_lock = asyncio.Lock()

    async def setup_name_owner_tracking(self):
        def send_owner(owner):
            # We must be careful not to send duplicate owner
            # notifications. cockpit.js relies on that.
            if self.owner != owner:
                self.owner = owner
                self.send_message(owner=owner)

        def handler(message):
            name, old, new = message.get_body()
            send_owner(owner=new if new != "" else None)
        self.add_signal_handler(handler,
                                sender='org.freedesktop.DBus',
                                path='/org/freedesktop/DBus',
                                interface='org.freedesktop.DBus',
                                member='NameOwnerChanged',
                                arg0=self.name)
        try:
            unique_name, = await self.bus.call_method_async("org.freedesktop.DBus",
                                                            "/org/freedesktop/DBus",
                                                            "org.freedesktop.DBus",
                                                            "GetNameOwner", "s", self.name)
        except BusError as error:
            if error.name == "org.freedesktop.DBus.Error.NameHasNoOwner":
                # Try to start it.  If it starts successfully, we will
                # get a NameOwnerChanged signal (which will set
                # self.owner) before StartServiceByName returns.
                try:
                    await self.bus.call_method_async("org.freedesktop.DBus",
                                                     "/org/freedesktop/DBus",
                                                     "org.freedesktop.DBus",
                                                     "StartServiceByName", "su", self.name, 0)
                except BusError as error:
                    logger.debug("Failed to start service '%s': %s", self.name, error.message)
                    self.send_message(owner=None)
            else:
                logger.debug("Failed to get owner of service '%s': %s", self.name, error.message)
        else:
            send_owner(unique_name)

    def do_open(self, options):
        self.cache = InterfaceCache()
        self.name = options.get('name')
        self.matches = []
        self.tasks = set()

        bus = options.get('bus')

        if bus == 'internal':
            logger.debug('get internal bus for %s', self.name)
            self.bus = self.router.internal_bus.client
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

        if self.name is not None:
            async def get_ready():
                async with self.watch_processing_lock:
                    await self.setup_name_owner_tracking()
                    if self.owner:
                        self.ready(unique_name=self.owner)
                    else:
                        self.close(problem="not-found")
            task = asyncio.create_task(get_ready())
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
        else:
            self.ready()

    def add_signal_handler(self, handler, **kwargs):
        r = dict(**kwargs)
        r['type'] = 'signal'
        if 'sender' not in r and self.name is not None:
            r['sender'] = self.name
        # HACK - https://github.com/bus1/dbus-broker/issues/309
        # path_namespace='/' in a rule does not work.
        if r.get('path_namespace') == "/":
            del r['path_namespace']

        def filter_owner(message):
            if self.owner is not None and self.owner == message.get_sender():
                handler(message)

        if self.name is not None and 'sender' in r and r['sender'] == self.name:
            func = filter_owner
        else:
            func = handler
        r_string = ','.join(f"{key}='{value}'" for key, value in r.items())
        self.matches.append(self.bus.add_match(r_string, func))

    def add_async_signal_handler(self, handler, **kwargs):
        def sync_handler(message):
            task = asyncio.create_task(handler(message))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
        self.add_signal_handler(sync_handler, **kwargs)

    async def do_call(self, message):
        path, iface, method, args = message['call']
        cookie = message.get('id')
        flags = message.get('flags')
        type = message.get('type')

        timeout = message.get('timeout')
        if timeout is not None:
            # sd_bus timeout is µs, cockpit API timeout is ms
            timeout *= 1000
        else:
            # sd_bus has no "indefinite" timeout, so use MAX_UINT64
            timeout = 2 ** 64 - 1

        # We have to figure out the signature of the call.  Either we got told it:
        signature = type

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
            except KeyError:
                self.send_message(error=["org.freedesktop.DBus.Error.UnknownMethod",
                                         [f"Introspection data for method {iface} {method} not available"]], id=cookie)
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
                self.send_message(reply=[reply], id=cookie,
                                  flags="<" if flags is not None else None,
                                  type=type)
        except BusError as error:
            # actually, should send the fields from the message body
            self.send_message(error=[error.name, [error.message]], id=cookie)
        except Exception:
            logger.exception("do_call(%s): generic exception", message)
            self.send_message(error=['python.error', [traceback.format_exc()]], id=cookie)

    async def do_add_match(self, message):
        add_match = message['add-match']
        logger.debug('adding match %s', add_match)

        async def match_hit(message):
            logger.debug('got match')
            async with self.watch_processing_lock:
                self.send_message(signal=[
                    message.get_path(),
                    message.get_interface(),
                    message.get_member(),
                    list(message.get_body())
                ])

        self.add_async_signal_handler(match_hit, **add_match)

    async def setup_objectmanager_watch(self, path, interface_name, meta, notify):
        # Watch the objects managed by the ObjectManager at "path".
        # Properties are not watched, that is done by setup_path_watch
        # below via recursive_props == True.

        async def handler(message):
            member = message.get_member()
            if member == "InterfacesAdded":
                (path, interface_props) = message.get_body()
                logger.debug('interfaces added %s %s', path, interface_props)
                meta = {}
                notify = {}
                async with self.watch_processing_lock:
                    for name, props in interface_props.items():
                        if interface_name is None or name == interface_name:
                            mm = await self.cache.get_interface_if_new(name, self.bus, self.name, path)
                            if mm:
                                meta.update({name: mm})
                            notify_update(notify, path, name, props)
                    self.send_message(meta=meta)
                    self.send_message(notify=notify)
            elif member == "InterfacesRemoved":
                (path, interfaces) = message.get_body()
                logger.debug('interfaces removed %s %s', path, interfaces)
                async with self.watch_processing_lock:
                    notify = {path: {name: None for name in interfaces}}
                    self.send_message(notify=notify)

        self.add_async_signal_handler(handler,
                                      path=path,
                                      interface="org.freedesktop.DBus.ObjectManager")
        objects, = await self.bus.call_method_async(self.name, path, 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects')
        for p, ifaces in objects.items():
            for iface, props in ifaces.items():
                if interface_name is None or iface == interface_name:
                    mm = await self.cache.get_interface_if_new(iface, self.bus, self.name, p)
                    if mm:
                        meta.update({iface: mm})
                    notify_update(notify, p, iface, props)

    async def setup_path_watch(self, path, interface_name, recursive_props, meta, notify):
        # Watch a single object at "path", but maybe also watch for
        # property changes for all objects below "path".

        async def handler(message):
            async with self.watch_processing_lock:
                path = message.get_path()
                name, props, invalids = message.get_body()
                logger.debug('NOTIFY: %s %s %s %s', path, name, props, invalids)
                for inv in invalids:
                    reply, = await self.bus.call_method_async(self.name, path,
                                                              'org.freedesktop.DBus.Properties', 'Get',
                                                              'ss', name, inv)
                    props[inv] = reply
                notify = {}
                notify_update(notify, path, name, props)
                self.send_message(notify=notify)

        this_meta = await self.cache.introspect_path(self.bus, self.name, path)
        if interface_name is not None:
            interface = this_meta.get(interface_name)
            this_meta = {interface_name: interface}
        meta.update(this_meta)
        if recursive_props:
            self.add_async_signal_handler(handler,
                                          interface="org.freedesktop.DBus.Properties",
                                          path_namespace=path)
        else:
            self.add_async_signal_handler(handler,
                                          interface="org.freedesktop.DBus.Properties",
                                          path=path)

        for name, interface in meta.items():
            if name.startswith("org.freedesktop.DBus."):
                continue
            try:
                props, = await self.bus.call_method_async(self.name, path, 'org.freedesktop.DBus.Properties', 'GetAll', 's', name)
                notify_update(notify, path, name, props)
            except BusError:
                pass

    async def do_watch(self, message):
        watch = message['watch']
        path = watch.get('path')
        path_namespace = watch.get('path_namespace')
        interface_name = watch.get('interface')
        cookie = message.get('id')

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
            logger.debug("do_watch(%s) caught D-Bus error: %s", message, error.message)
            self.send_message(error=[error.name, [error.message]], id=cookie)

    async def do_meta(self, message):
        self.cache.inject(message['meta'])

    def do_data(self, data):
        message = json.loads(data)
        logger.debug('receive dbus request %s %s', self.name, message)

        if 'call' in message:
            task = asyncio.create_task(self.do_call(message))
        elif 'add-match' in message:
            task = asyncio.create_task(self.do_add_match(message))
        elif 'watch' in message:
            task = asyncio.create_task(self.do_watch(message))
        elif 'meta' in message:
            task = asyncio.create_task(self.do_meta(message))
        else:
            logger.debug('ignored dbus request %s', message)
            return

        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    def do_close(self):
        self.close()

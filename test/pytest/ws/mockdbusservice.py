# Copyright (C) 2024 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later

import asyncio
import contextlib
import logging
import math
import os
import socket
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Iterator

from cockpit._vendor import systemd_ctypes
from cockpit._vendor.systemd_ctypes import Bus
from cockpit._vendor.systemd_ctypes.bus import Slot

logger = logging.getLogger(__name__)


# Parent node that provides introspection and ObjectManager for child objects
class OTreeNode(systemd_ctypes.bus.BaseObject):
    def __init__(
        self,
        path: str,
        bus: Bus,
        children: dict[str, "com_redhat_Cockpit_DBusTests_Frobber"],
    ) -> None:
        super().__init__()
        self._path = path
        self._bus = bus
        self._children = children  # name -> object
        self._dynamic_children: dict[str, "com_redhat_Cockpit_DBusTests_Frobber"] = {}
        self._dynamic_slots: dict[str, Slot] = {}

    def message_received(self, message: systemd_ctypes.bus.BusMessage) -> bool:
        iface = message.get_interface()
        member = message.get_member()

        if iface == "org.freedesktop.DBus.Introspectable" and member == "Introspect":
            nodes = "".join(f'<node name="{name}"/>' for name in self._children)
            xml = f"""
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
    "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.freedesktop.DBus.Introspectable">
    <method name="Introspect">
      <arg name="data" direction="out" type="s"/>
    </method>
  </interface>
  <interface name="org.freedesktop.DBus.ObjectManager">
    <method name="GetManagedObjects">
      <arg name="objects" direction="out" type="a{{oa{{sa{{sv}}}}}}"/>
    </method>
  </interface>
  {nodes}
</node>"""
            message.reply_method_return("s", xml)
            return True

        if (
            iface == "org.freedesktop.DBus.ObjectManager"
            and member == "GetManagedObjects"
        ):
            result = self._get_managed_objects()
            message.reply_method_return("a{oa{sa{sv}}}", result)
            return True

        return False

    def _get_managed_objects(
        self,
    ) -> dict[str, dict[str, dict[str, dict[str, object]]]]:
        """Return all managed objects with their interfaces and properties."""
        result: dict[str, dict[str, dict[str, dict[str, object]]]] = {}

        for name, obj in self._children.items():
            path = f"{self._path}/{name}"
            props = self._get_frobber_properties(obj)
            result[path] = {"com.redhat.Cockpit.DBusTests.Frobber": props}

        return result

    def _get_frobber_properties(
        self, obj: "com_redhat_Cockpit_DBusTests_Frobber"
    ) -> dict[str, dict[str, object]]:
        """Get properties of a Frobber object as {name: {'t': sig, 'v': value}}."""

        def v(sig: str, val: object) -> dict[str, object]:
            return {"t": sig, "v": val}

        return {
            "FinallyNormalName": v("s", obj.finally_normal_name),
            "ReadonlyProperty": v("s", obj.readonly_property),
            "aay": v("aay", obj.aay),
            "ag": v("ag", obj.ag),
            "ao": v("ao", obj.ao),
            "as": v("as", obj.as_),
            "ay": v("ay", obj.ay),
            "b": v("b", obj.b),
            "d": v("d", obj.d),
            "g": v("g", obj.g),
            "i": v("i", obj.i),
            "n": v("n", obj.n),
            "o": v("o", obj.o),
            "q": v("q", obj.q),
            "s": v("s", obj.s),
            "t": v("t", obj.t),
            "u": v("u", obj.u),
            "x": v("x", obj.x),
            "y": v("y", obj.y),
        }

    def add_dynamic_object(self, path: str) -> None:
        """Add a dynamic object and emit InterfacesAdded signal."""
        if path in self._dynamic_children:
            return

        obj = com_redhat_Cockpit_DBusTests_Frobber(self._bus, self)
        slot = self._bus.add_object(path, obj)
        self._dynamic_children[path] = obj
        self._dynamic_slots[path] = slot

        # Emit InterfacesAdded signal
        props = self._get_frobber_properties(obj)
        ifaces = {"com.redhat.Cockpit.DBusTests.Frobber": props}
        self._emit_signal("InterfacesAdded", "oa{sa{sv}}", path, ifaces)

    def remove_dynamic_object(self, path: str) -> None:
        """Remove a dynamic object and emit InterfacesRemoved signal."""
        slot = self._dynamic_slots.pop(path, None)
        if slot:
            slot.cancel()
            del self._dynamic_children[path]

            # Emit InterfacesRemoved signal
            ifaces = ["com.redhat.Cockpit.DBusTests.Frobber"]
            self._emit_signal("InterfacesRemoved", "oas", path, ifaces)

    def remove_all_dynamic_objects(self) -> None:
        """Remove all dynamic objects."""
        for path in list(self._dynamic_slots.keys()):
            self.remove_dynamic_object(path)

    def _emit_signal(self, name: str, signature: str, *args: object) -> None:
        """Emit a signal on org.freedesktop.DBus.ObjectManager."""
        msg = self._bus.message_new_signal(
            self._path, "org.freedesktop.DBus.ObjectManager", name
        )
        msg.append(signature, *args)
        msg.send()


# No introspection, manual handling of method calls
class borkety_Bork(systemd_ctypes.bus.BaseObject):
    def message_received(self, message: systemd_ctypes.bus.BusMessage) -> bool:
        signature = message.get_signature(True)  # noqa:FBT003
        body = message.get_body()
        logger.debug("got Bork message: %s %r", signature, body)

        if message.get_member() == "Echo":
            message.reply_method_return(signature, *body)
            return True

        return False


class com_redhat_Cockpit_DBusTests_Frobber(systemd_ctypes.bus.Object):
    def __init__(
        self, bus: Bus | None = None, object_manager: OTreeNode | None = None
    ) -> None:
        super().__init__()
        self._bus = bus
        self._object_manager = object_manager
        self._claimed_names: set[str] = set()

    def message_received(self, message: systemd_ctypes.bus.BusMessage) -> bool:
        if message.get_member() == "NeverReturn":
            return True  # handled, no reply - truly never returns
        return super().message_received(message)

    finally_normal_name = systemd_ctypes.bus.Interface.Property(
        "s", "There aint no place like home"
    )
    readonly_property = systemd_ctypes.bus.Interface.Property("s", "blah")
    aay = systemd_ctypes.bus.Interface.Property("aay", [], name="aay")
    ag = systemd_ctypes.bus.Interface.Property("ag", [], name="ag")
    ao = systemd_ctypes.bus.Interface.Property("ao", [], name="ao")
    as_ = systemd_ctypes.bus.Interface.Property("as", [], name="as")
    ay = systemd_ctypes.bus.Interface.Property("ay", b"ABCabc\0", name="ay")
    b = systemd_ctypes.bus.Interface.Property("b", value=False, name="b")
    d = systemd_ctypes.bus.Interface.Property("d", 43, name="d")
    g = systemd_ctypes.bus.Interface.Property("g", "", name="g")
    i = systemd_ctypes.bus.Interface.Property("i", 0, name="i")
    n = systemd_ctypes.bus.Interface.Property("n", 0, name="n")
    o = systemd_ctypes.bus.Interface.Property("o", "/", name="o")
    q = systemd_ctypes.bus.Interface.Property("q", 0, name="q")
    s = systemd_ctypes.bus.Interface.Property("s", "", name="s")
    t = systemd_ctypes.bus.Interface.Property("t", 0, name="t")
    u = systemd_ctypes.bus.Interface.Property("u", 0, name="u")
    x = systemd_ctypes.bus.Interface.Property("x", 0, name="x")
    y = systemd_ctypes.bus.Interface.Property("y", 42, name="y")

    test_signal = systemd_ctypes.bus.Interface.Signal("i", "as", "ao", "a{s(ii)}")

    @systemd_ctypes.bus.Interface.Method("", "i")
    def request_signal_emission(self, which_one: int) -> None:
        del which_one

        self.test_signal(
            43,
            ["foo", "frobber"],
            ["/foo", "/foo/bar"],
            {"first": (42, 42), "second": (43, 43)},
        )

    @systemd_ctypes.bus.Interface.Method("s", "s")
    def hello_world(self, greeting: str) -> str:
        return f"Word! You said `{greeting}'. I'm Skeleton, btw!"

    @systemd_ctypes.bus.Interface.Method(
        ["y", "b", "n", "q", "i", "u", "x", "t", "d", "s", "o", "g", "ay"],
        ["y", "b", "n", "q", "i", "u", "x", "t", "d", "s", "o", "g", "ay"],
    )
    def test_primitive_types(
        self,
        val_byte,
        val_boolean,
        val_int16,
        val_uint16,
        val_int32,
        val_uint32,
        val_int64,
        val_uint64,
        val_double,
        val_string,
        val_objpath,
        val_signature,
        val_bytestring,
    ):
        return [
            val_byte + 10,
            not val_boolean,
            100 + val_int16,
            1000 + val_uint16,
            10000 + val_int32,
            100000 + val_uint32,
            1000000 + val_int64,
            10000000 + val_uint64,
            val_double / math.pi,
            f"Word! You said `{val_string}'. Rock'n'roll!",
            f"/modified{val_objpath}",
            f"assgit{val_signature}",
            b"bytestring!\xff\0",
        ]

    @systemd_ctypes.bus.Interface.Method(
        ["s"], ["a{ss}", "a{s(ii)}", "(iss)", "as", "ao", "ag", "aay"]
    )
    def test_non_primitive_types(
        self,
        dict_s_to_s,
        dict_s_to_pairs,
        a_struct,
        array_of_strings,
        array_of_objpaths,
        array_of_signatures,
        array_of_bytestrings,
    ):
        return (
            f"{dict_s_to_s}{dict_s_to_pairs}{a_struct}"
            f"array_of_strings: [{', '.join(array_of_strings)}] "
            f"array_of_objpaths: [{', '.join(array_of_objpaths)}] "
            f"array_of_signatures: [signature {', '.join(f"'{sig}'" for sig in array_of_signatures)}] "
            f"array_of_bytestrings: [{', '.join(x[:-1].decode() for x in array_of_bytestrings)}] "
        )

    @systemd_ctypes.bus.Interface.Method("", "")
    def delete_all_objects(self) -> None:
        if self._object_manager:
            self._object_manager.remove_all_dynamic_objects()

    @systemd_ctypes.bus.Interface.Method("", "o")
    def create_object(self, path: str) -> None:
        if self._object_manager is None:
            raise RuntimeError("No object manager available for CreateObject")
        self._object_manager.add_dynamic_object(path)

    @systemd_ctypes.bus.Interface.Method("", "o")
    def delete_object(self, path: str) -> None:
        if self._object_manager:
            self._object_manager.remove_dynamic_object(path)

    @systemd_ctypes.bus.Interface.Method("", "")
    def add_alpha(self) -> None:
        # Emit InterfacesAdded signal for the Alpha interface (empty interface)
        if self._bus is None or self._object_manager is None:
            return
        # Alpha has no properties, so empty dict
        ifaces: dict[str, dict[str, dict[str, object]]] = {
            "com.redhat.Cockpit.DBusTests.Alpha": {}
        }
        self._object_manager._emit_signal(
            "InterfacesAdded", "oa{sa{sv}}", "/otree/frobber", ifaces
        )

    @systemd_ctypes.bus.Interface.Method("", "")
    def remove_alpha(self) -> None:
        # Emit InterfacesRemoved signal for the Alpha interface
        if self._bus is None or self._object_manager is None:
            return
        ifaces = ["com.redhat.Cockpit.DBusTests.Alpha"]
        self._object_manager._emit_signal(
            "InterfacesRemoved", "oas", "/otree/frobber", ifaces
        )

    @systemd_ctypes.bus.Interface.Method("", "")
    def request_property_mods(self) -> None:
        # Trigger a property change notification
        # Change FinallyNormalName to trigger a PropertiesChanged signal
        self.finally_normal_name = "modified"

    @systemd_ctypes.bus.Interface.Method("", "s")
    async def claim_other_name(self, name: str) -> None:
        if self._bus is None:
            raise RuntimeError("No bus available for ClaimOtherName")
        (result,) = await self._bus.call_method_async(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "RequestName",
            "su",
            name,
            0,
        )
        if result != 1:
            raise RuntimeError(f"Failed to claim name {name}: {result}")
        self._claimed_names.add(name)

    @systemd_ctypes.bus.Interface.Method("", "s")
    async def release_other_name(self, name: str) -> None:
        if self._bus is None:
            raise RuntimeError("No bus available for ReleaseOtherName")
        (result,) = await self._bus.call_method_async(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "ReleaseName",
            "s",
            name,
        )
        if result != 1:
            raise RuntimeError(f"Failed to release name {name}: {result}")
        self._claimed_names.discard(name)


@contextlib.contextmanager
def mock_service_export(bus: systemd_ctypes.Bus) -> Iterator[None]:
    # Create OTreeNode first with empty children dict
    # Only frobber is included in ObjectManager, not different
    children: dict[str, com_redhat_Cockpit_DBusTests_Frobber] = {}
    otree = OTreeNode("/otree", bus, children)

    # Create Frobbers with reference to OTreeNode
    frobber = com_redhat_Cockpit_DBusTests_Frobber(bus, otree)
    different = com_redhat_Cockpit_DBusTests_Frobber(bus, None)  # No object manager

    # Only frobber is in the ObjectManager
    children["frobber"] = frobber

    slots = [
        bus.add_object("/otree", otree),
        bus.add_object("/otree/frobber", frobber),
        bus.add_object("/otree/different", different),
        bus.add_object("/bork", borkety_Bork()),
    ]

    yield

    for slot in slots:
        slot.cancel()


@contextlib.asynccontextmanager
async def well_known_name(
    bus: systemd_ctypes.Bus, name: str, flags: int = 0
) -> AsyncIterator[None]:
    (result,) = await bus.call_method_async(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "RequestName",
        "su",
        name,
        flags,
    )
    if result != 1:
        raise RuntimeError(f"Cannot register name {name}: {result}")

    try:
        yield

    finally:
        (result,) = await bus.call_method_async(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "ReleaseName",
            "s",
            name,
        )
        if result != 1:
            raise RuntimeError(f"Cannot release name {name}: {result}")


@contextlib.asynccontextmanager
async def mock_dbus_service_on_user_bus() -> AsyncIterator[None]:
    user = systemd_ctypes.Bus.default_user()
    async with (
        well_known_name(user, "com.redhat.Cockpit.DBusTests.Test"),
        well_known_name(user, "com.redhat.Cockpit.DBusTests.Second"),
    ):
        with mock_service_export(user):
            yield


def export_mock_objects(bus: Bus) -> list[Slot]:
    """Export mock objects on a bus and return the slots (for cleanup)."""
    # Create OTreeNode first with empty children dict
    # Only frobber is included in ObjectManager, not different
    children: dict[str, com_redhat_Cockpit_DBusTests_Frobber] = {}
    otree = OTreeNode("/otree", bus, children)

    # Create Frobbers with reference to OTreeNode
    frobber = com_redhat_Cockpit_DBusTests_Frobber(bus, otree)
    different = com_redhat_Cockpit_DBusTests_Frobber(bus, None)  # No object manager

    # Only frobber is in the ObjectManager
    children["frobber"] = frobber

    return [
        bus.add_object("/otree", otree),
        bus.add_object("/otree/frobber", frobber),
        bus.add_object("/otree/different", different),
        bus.add_object("/bork", borkety_Bork()),
    ]


@contextlib.asynccontextmanager
async def direct_dbus_server() -> AsyncIterator[str]:
    """Run a direct peer-to-peer D-Bus server and yield its address."""
    tmpdir = tempfile.mkdtemp(prefix="cockpit-dbus-test-")
    socket_path = Path(tmpdir) / "bus.sock"

    # Create listening socket
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.setblocking(False)  # noqa: FBT003
    listener.bind(str(socket_path))
    listener.listen(5)

    connections: list[tuple[Bus, list[Slot]]] = []
    accept_task: asyncio.Task[None] | None = None

    async def accept_loop() -> None:
        loop = asyncio.get_running_loop()
        while True:
            try:
                conn, _ = await loop.sock_accept(listener)
                fd = conn.detach()  # Bus takes ownership
                bus = Bus.new(fd=fd, server=True)
                slots = export_mock_objects(bus)
                connections.append((bus, slots))
                logger.debug("direct_dbus_server: accepted connection, fd=%d", fd)
            except asyncio.CancelledError:
                break
            except OSError as e:
                logger.debug("direct_dbus_server: accept error: %s", e)
                break

    accept_task = asyncio.create_task(accept_loop())

    try:
        yield f"unix:path={socket_path}"
    finally:
        if accept_task:
            accept_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await accept_task

        for _bus, slots in connections:
            for slot in slots:
                slot.cancel()

        listener.close()
        socket_path.unlink(missing_ok=True)
        os.rmdir(tmpdir)


async def main():
    async with mock_dbus_service_on_user_bus():
        print("Mock service running.  Ctrl+C to exit.")
        await asyncio.sleep(2 << 30)  # "a long time."


if __name__ == "__main__":
    systemd_ctypes.run_async(main())

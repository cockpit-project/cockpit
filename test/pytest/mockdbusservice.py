import asyncio
import contextlib
import logging
import math
from collections.abc import AsyncIterator
from typing import Iterator

from cockpit._vendor import systemd_ctypes

logger = logging.getLogger(__name__)


# No introspection, manual handling of method calls
class borkety_Bork(systemd_ctypes.bus.BaseObject):
    def message_received(self, message: systemd_ctypes.bus.BusMessage) -> bool:
        signature = message.get_signature(True)  # noqa:FBT003
        body = message.get_body()
        logger.debug('got Bork message: %s %r', signature, body)

        if message.get_member() == 'Echo':
            message.reply_method_return(signature, *body)
            return True

        return False


class com_redhat_Cockpit_DBusTests_Frobber(systemd_ctypes.bus.Object):
    finally_normal_name = systemd_ctypes.bus.Interface.Property('s', 'There aint no place like home')
    readonly_property = systemd_ctypes.bus.Interface.Property('s', 'blah')
    aay = systemd_ctypes.bus.Interface.Property('aay', [], name='aay')
    ag = systemd_ctypes.bus.Interface.Property('ag', [], name='ag')
    ao = systemd_ctypes.bus.Interface.Property('ao', [], name='ao')
    as_ = systemd_ctypes.bus.Interface.Property('as', [], name='as')
    ay = systemd_ctypes.bus.Interface.Property('ay', b'ABCabc\0', name='ay')
    b = systemd_ctypes.bus.Interface.Property('b', value=False, name='b')
    d = systemd_ctypes.bus.Interface.Property('d', 43, name='d')
    g = systemd_ctypes.bus.Interface.Property('g', '', name='g')
    i = systemd_ctypes.bus.Interface.Property('i', 0, name='i')
    n = systemd_ctypes.bus.Interface.Property('n', 0, name='n')
    o = systemd_ctypes.bus.Interface.Property('o', '/', name='o')
    q = systemd_ctypes.bus.Interface.Property('q', 0, name='q')
    s = systemd_ctypes.bus.Interface.Property('s', '', name='s')
    t = systemd_ctypes.bus.Interface.Property('t', 0, name='t')
    u = systemd_ctypes.bus.Interface.Property('u', 0, name='u')
    x = systemd_ctypes.bus.Interface.Property('x', 0, name='x')
    y = systemd_ctypes.bus.Interface.Property('y', 42, name='y')

    test_signal = systemd_ctypes.bus.Interface.Signal('i', 'as', 'ao', 'a{s(ii)}')

    @systemd_ctypes.bus.Interface.Method('', 'i')
    def request_signal_emission(self, which_one: int) -> None:
        del which_one

        self.test_signal(
            43,
            ['foo', 'frobber'],
            ['/foo', '/foo/bar'],
            {'first': (42, 42), 'second': (43, 43)}
        )

    @systemd_ctypes.bus.Interface.Method('s', 's')
    def hello_world(self, greeting: str) -> str:
        return f"Word! You said `{greeting}'. I'm Skeleton, btw!"

    @systemd_ctypes.bus.Interface.Method('', '')
    async def never_return(self) -> None:
        await asyncio.sleep(1000000)

    @systemd_ctypes.bus.Interface.Method(
        ['y', 'b', 'n', 'q', 'i', 'u', 'x', 't', 'd', 's', 'o', 'g', 'ay'],
        ['y', 'b', 'n', 'q', 'i', 'u', 'x', 't', 'd', 's', 'o', 'g', 'ay']
    )
    def test_primitive_types(
        self,
        val_byte, val_boolean,
        val_int16, val_uint16, val_int32, val_uint32, val_int64, val_uint64,
        val_double,
        val_string, val_objpath, val_signature,
        val_bytestring
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
            b"bytestring!\xff\0"
        ]

    @systemd_ctypes.bus.Interface.Method(
        ['s'],
        ["a{ss}", "a{s(ii)}", "(iss)", "as", "ao", "ag", "aay"]
    )
    def test_non_primitive_types(
        self,
        dict_s_to_s,
        dict_s_to_pairs,
        a_struct,
        array_of_strings,
        array_of_objpaths,
        array_of_signatures,
        array_of_bytestrings
    ):
        return (
            f'{dict_s_to_s}{dict_s_to_pairs}{a_struct}'
            f'array_of_strings: [{", ".join(array_of_strings)}] '
            f'array_of_objpaths: [{", ".join(array_of_objpaths)}] '
            f'array_of_signatures: [signature {", ".join(f"'{sig}'" for sig in array_of_signatures)}] '
            f'array_of_bytestrings: [{", ".join(x[:-1].decode() for x in array_of_bytestrings)}] '
        )


@contextlib.contextmanager
def mock_service_export(bus: systemd_ctypes.Bus) -> Iterator[None]:
    slots = [
        bus.add_object('/otree/frobber', com_redhat_Cockpit_DBusTests_Frobber()),
        bus.add_object('/otree/different', com_redhat_Cockpit_DBusTests_Frobber()),
        bus.add_object('/bork', borkety_Bork())
    ]

    yield

    for slot in slots:
        slot.cancel()


@contextlib.asynccontextmanager
async def well_known_name(bus: systemd_ctypes.Bus, name: str, flags: int = 0) -> AsyncIterator[None]:
    result, = await bus.call_method_async(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', 'su', name, flags
    )
    if result != 1:
        raise RuntimeError(f'Cannot register name {name}: {result}')

    try:
        yield

    finally:
        result, = await bus.call_method_async(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ReleaseName', 's', name
        )
        if result != 1:
            raise RuntimeError(f'Cannot release name {name}: {result}')


@contextlib.asynccontextmanager
async def mock_dbus_service_on_user_bus() -> AsyncIterator[None]:
    user = systemd_ctypes.Bus.default_user()
    async with (
        well_known_name(user, 'com.redhat.Cockpit.DBusTests.Test'),
        well_known_name(user, 'com.redhat.Cockpit.DBusTests.Second'),
    ):
        with mock_service_export(user):
            yield


async def main():
    async with mock_dbus_service_on_user_bus():
        print('Mock service running.  Ctrl+C to exit.')
        await asyncio.sleep(2 << 30)  # "a long time."


if __name__ == '__main__':
    systemd_ctypes.run_async(main())

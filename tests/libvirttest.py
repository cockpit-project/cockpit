from enum import IntEnum
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib
import dbus
import os
import pytest
import subprocess
import sys
import time


root = os.environ.get('abs_top_builddir', os.path.dirname(os.path.dirname(__file__)))
exe = os.path.join(root, 'src', 'libvirt-dbus')

DBusGMainLoop(set_as_default=True)


def run():
    exit(pytest.main(sys.argv))


class BaseTestClass():
    """ Base test class for whole test suite
    """
    connect = None
    bus = None
    libvirt_dbus = None
    loop = False

    @pytest.fixture(autouse=True)
    def libvirt_dbus_setup(self, request):
        """Start libvirt-dbus for each test function
        """
        os.environ['LIBVIRT_DEBUG'] = '3'
        self.libvirt_dbus = subprocess.Popen([exe])
        self.bus = dbus.SessionBus()

        for i in range(10):
            if self.bus.name_has_owner('org.libvirt'):
                break
            time.sleep(0.1)
        else:
            raise TimeoutError('error starting libvirt-dbus')

        obj = self.bus.get_object('org.libvirt', '/org/libvirt/Test')
        self.connect = dbus.Interface(obj, 'org.libvirt.Connect')

    @pytest.fixture(autouse=True)
    def libvirt_dbus_teardown(self):
        """Terminate libvirt-dbus at the teardown of each test
        """
        yield
        self.libvirt_dbus.terminate()
        self.libvirt_dbus.wait(timeout=10)

    def main_loop(self):
        """Initializes the mainloop
        """
        assert getattr(self, 'loop', False) is False

        def timeout():
            self.loop.quit()
            del self.loop
            self.timeout = True

        self.timeout = False
        self.loop = GLib.MainLoop()
        GLib.timeout_add(2000, timeout)
        self.loop.run()
        if self.timeout:
            raise TimeoutError()

    def domain(self):
        path = self.connect.ListDomains(0)[0]
        obj = self.bus.get_object('org.libvirt', path)
        return obj, dbus.Interface(obj, 'org.libvirt.Domain')

    def test_network(self):
        """Fetch information for the test network from test driver

        Returns:
            (dbus.proxies.ProxyObject, dbus.proxies.ProxyObject):
            Test Network Object, Local proxy for the test Network Object.

        """
        path = self.connect.ListNetworks(0)[0]
        obj = self.bus.get_object('org.libvirt', path)
        return path, obj


class DomainEvent(IntEnum):
    DEFINED = 0
    UNDEFINED = 1
    STARTED = 2
    SUSPENDED = 3
    RESUMED = 4
    STOPPED = 5
    SHUTDOWN = 6
    PMSUSPENDED = 7
    CRASHED = 8


class NetworkEvent(IntEnum):
    DEFINED = 0
    UNDEFINED = 1
    STARTED = 2
    STOPPED = 3

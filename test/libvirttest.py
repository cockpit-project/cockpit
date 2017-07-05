#!/usr/bin/python3

from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib
import dbus
import os
import subprocess
import time
import unittest

root = os.path.dirname(os.path.dirname(__file__))
exe = os.path.join(root, 'src', 'libvirt-dbus')

DBusGMainLoop(set_as_default=True)

class TestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bus = subprocess.Popen(['dbus-daemon', '--session', '--print-address'],
            stdout=subprocess.PIPE, universal_newlines=True)
        os.environ['DBUS_SESSION_BUS_ADDRESS'] = cls.bus.stdout.readline().strip()

    @classmethod
    def tearDownClass(cls):
        cls.bus.terminate()
        cls.bus.wait(timeout=10)

    def setUp(self):
        os.environ['LIBVIRT_DEBUG'] = '3'

        self.daemon = subprocess.Popen([exe, '--connect', 'test:///default'])
        self.bus = dbus.SessionBus()

        for i in range(10):
            if self.bus.name_has_owner('org.libvirt'):
                break
            time.sleep(0.1)
        else:
            raise TimeoutError('error starting libvirt-dbus')

        obj = self.bus.get_object('org.libvirt', '/org/libvirt/Manager')
        self.manager = dbus.Interface(obj, 'org.libvirt.Manager')

    def tearDown(self):
        self.daemon.terminate()
        self.daemon.wait(timeout=10)

    def main_loop(self):
        self.assertFalse(getattr(self, 'loop', False))

        def timeout():
            self.loop.quit()
            del self.loop
            raise TimeoutError()

        self.loop = GLib.MainLoop()
        GLib.timeout_add(1000, timeout)
        self.loop.run()

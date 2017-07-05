#!/usr/bin/python3

import dbus
import libvirttest
import unittest

class TestDomain(libvirttest.TestCase):
    def domain(self):
        path = self.manager.ListDomains(0)[0]
        obj = self.bus.get_object('org.libvirt', path)
        return obj, dbus.Interface(obj, 'org.libvirt.Domain')

    def test_api(self):
        obj, domain = self.domain()

        props = obj.GetAll('org.libvirt.Domain', dbus_interface=dbus.PROPERTIES_IFACE)
        self.assertEqual(type(props['Name']), dbus.String)
        self.assertEqual(type(props['UUID']), dbus.String)
        self.assertEqual(type(props['Id']), dbus.UInt32)
        self.assertEqual(type(props['Vcpus']), dbus.UInt32)
        self.assertEqual(type(props['OSType']), dbus.String)
        self.assertEqual(type(props['Active']), dbus.Boolean)
        self.assertEqual(type(props['Persistent']), dbus.Boolean)
        self.assertEqual(type(props['State']), dbus.String)
        self.assertEqual(type(props['Autostart']), dbus.Boolean)

        # Call all methods except Reset and GetStats, because the test backend
        # doesn't support those

        xml = domain.GetXMLDesc(0)
        self.assertEqual(type(xml), dbus.String)

        domain.Reboot(0)
        domain.Shutdown()
        domain.Create()
        domain.Destroy()
        domain.Undefine()

    def test_shutdown(self):
        def domain_stopped(name, path):
            self.assertEqual(name, 'test')
            self.assertEqual(type(path), dbus.ObjectPath)
            self.loop.quit()

        self.manager.connect_to_signal('DomainStopped', domain_stopped)

        obj, domain = self.domain()
        domain.Shutdown()

        state = obj.Get('org.libvirt.Domain', 'State', dbus_interface=dbus.PROPERTIES_IFACE)
        self.assertEqual(state, 'shutoff')

        self.main_loop()

    def test_undefine(self):
        def domain_undefined(name, path):
            self.assertEqual(name, 'test')
            self.assertEqual(type(path), dbus.ObjectPath)
            self.loop.quit()

        self.manager.connect_to_signal('DomainUndefined', domain_undefined)

        _, domain = self.domain()
        domain.Shutdown()
        domain.Undefine()

        self.main_loop()

if __name__ == '__main__':
    unittest.main(verbosity=2)

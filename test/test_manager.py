#!/usr/bin/python3

import dbus
import libvirttest
import unittest

minimal_xml = '''
    <domain type="test">
      <name>foo</name>
      <memory>1024</memory>
      <os>
        <type>hvm</type>
      </os>
    </domain>
'''

class TestManager(libvirttest.TestCase):
    def test_list_domains(self):
        domains = self.manager.ListDomains(0)
        self.assertEqual(type(domains), dbus.Array)
        self.assertEqual(len(domains), 1)

        for path in domains:
            self.assertEqual(type(path), dbus.ObjectPath)
            domain = self.bus.get_object('org.libvirt', path)

            # ensure the path exists by calling Introspect on it
            domain.Introspect(dbus_interface=dbus.INTROSPECTABLE_IFACE)

    def test_create(self):
        def domain_started(name, path):
            self.assertEqual(name, 'foo')
            self.assertEqual(type(path), dbus.ObjectPath)
            self.loop.quit()

        self.manager.connect_to_signal('DomainStarted', domain_started)

        path = self.manager.CreateXML(minimal_xml, 0)
        self.assertEqual(type(path), dbus.ObjectPath)

        self.main_loop()

    def test_define(self):
        def domain_defined(name, path):
            self.assertEqual(name, 'foo')
            self.assertEqual(type(path), dbus.ObjectPath)
            self.loop.quit()

        self.manager.connect_to_signal('DomainDefined', domain_defined)

        path = self.manager.DefineXML(minimal_xml)
        self.assertEqual(type(path), dbus.ObjectPath)

        self.main_loop()

if __name__ == '__main__':
    unittest.main(verbosity=2)

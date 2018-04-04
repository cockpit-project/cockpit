#!/usr/bin/env python3

import dbus
import libvirttest
import pytest


class TestConnect(libvirttest.BaseTestClass):
    minimal_xml = '''
    <domain type="test">
      <name>foo</name>
      <memory>1024</memory>
      <os>
        <type>hvm</type>
      </os>
    </domain>
    '''

    def test_list_domains(self):
        domains = self.connect.ListDomains(0)
        assert isinstance(domains, dbus.Array)
        assert len(domains) == 1

        for path in domains:
            assert isinstance(path, dbus.ObjectPath)
            domain = self.bus.get_object('org.libvirt', path)

            # ensure the path exists by calling Introspect on it
            domain.Introspect(dbus_interface=dbus.INTROSPECTABLE_IFACE)

    def test_create(self):
        def domain_started(path, _event):
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_started, arg1='Started')

        path = self.connect.CreateXML(self.minimal_xml, 0)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    def test_define(self):
        def domain_defined(path, _event):
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_defined, arg1='Defined')

        path = self.connect.DefineXML(self.minimal_xml)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    @pytest.mark.parametrize("lookup_method_name,lookup_item", [
        ("DomainLookupByID", 'Id'),
        ("DomainLookupByName", 'Name'),
        ("DomainLookupByUUID", 'UUID'),
    ])
    def test_connect_domain_lookup_by_id(self, lookup_method_name, lookup_item):
        """Parameterized test for all DomainLookupBy* API calls of Connect interface
        """
        original_path = self.connect.ListDomains(0)[0]
        obj, _ = self.domain()
        props = obj.GetAll('org.libvirt.Domain', dbus_interface=dbus.PROPERTIES_IFACE)
        path = getattr(self.connect, lookup_method_name)(props[lookup_item])
        assert original_path == path

    @pytest.mark.parametrize("property_name,expected_type", [
        ("Version", dbus.UInt64),
    ])
    def test_connect_properties_return_type(self, property_name, expected_type):
        obj = self.bus.get_object('org.libvirt', '/org/libvirt/Test')
        props = obj.GetAll('org.libvirt.Connect', dbus_interface=dbus.PROPERTIES_IFACE)
        assert isinstance(props[property_name], expected_type)

    def test_list_networks(self):
        networks = self.connect.ListNetworks(0)
        assert isinstance(networks, dbus.Array)
        assert len(networks) == 1

        for path in networks:
            assert isinstance(path, dbus.ObjectPath)
            network = self.bus.get_object('org.libvirt', path)

            # ensure the path exists by calling Introspect on it
            network.Introspect(dbus_interface=dbus.INTROSPECTABLE_IFACE)

    @pytest.mark.parametrize("lookup_method_name,lookup_item", [
        ("NetworkLookupByName", 'Name'),
        ("NetworkLookupByUUID", 'UUID'),
    ])
    def test_connect_network_lookup_by_property(self, lookup_method_name, lookup_item):
        """Parameterized test for all NetworkLookupBy* API calls of Connect interface
        """
        original_path, obj = self.test_network()
        prop = obj.Get('org.libvirt.Network', lookup_item, dbus_interface=dbus.PROPERTIES_IFACE)
        path = getattr(self.connect, lookup_method_name)(prop)
        assert original_path == path


if __name__ == '__main__':
    libvirttest.run()

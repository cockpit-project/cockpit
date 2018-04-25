#!/usr/bin/env python3

import dbus
import libvirttest
import pytest


class TestConnect(libvirttest.BaseTestClass):
    minimal_domain_xml = '''
    <domain type="test">
      <name>foo</name>
      <memory>1024</memory>
      <os>
        <type>hvm</type>
      </os>
    </domain>
    '''

    minimal_network_xml = '''
    <network>
      <name>bar</name>
      <uuid>004b96e12d78c30f5aa5f03c87d21e69</uuid>
      <bridge name='brdefault'/>
      <forward dev='eth0'/>
      <ip address='192.168.122.1' netmask='255.255.255.0'>
        <dhcp>
          <range start='192.168.122.128' end='192.168.122.253'/>
        </dhcp>
      </ip>
    </network>
    '''

    def test_connect_domain_create_xml(self):
        def domain_started(path, _event):
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_started, arg1='Started')

        path = self.connect.DomainCreateXML(self.minimal_domain_xml, 0)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    def test_comnect_domain_define_xml(self):
        def domain_defined(path, _event):
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_defined, arg1='Defined')

        path = self.connect.DomainDefineXML(self.minimal_domain_xml)
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

    def test_connect_find_storage_pool_sources(self):
        storageType = "logical"
        sources = self.connect.FindStoragePoolSources(storageType, "", 0)
        assert isinstance(sources, dbus.String)

    def test_connect_list_domains(self):
        domains = self.connect.ListDomains(0)
        assert isinstance(domains, dbus.Array)
        assert len(domains) == 1

        for path in domains:
            assert isinstance(path, dbus.ObjectPath)
            domain = self.bus.get_object('org.libvirt', path)

            # ensure the path exists by calling Introspect on it
            domain.Introspect(dbus_interface=dbus.INTROSPECTABLE_IFACE)

    @pytest.mark.parametrize("property_name,expected_type", [
        ("Encrypted", dbus.Boolean),
        ("Hostname", dbus.String),
        ("LibVersion", dbus.UInt64),
        ("Secure", dbus.Boolean),
        ("Version", dbus.UInt64),
    ])
    def test_connect_properties_return_type(self, property_name, expected_type):
        obj = self.bus.get_object('org.libvirt', '/org/libvirt/Test')
        props = obj.GetAll('org.libvirt.Connect', dbus_interface=dbus.PROPERTIES_IFACE)
        assert isinstance(props[property_name], expected_type)

    def test_connect_get_sysinfo(self):
        sysinfo = self.connect.GetSysinfo(0)
        assert isinstance(sysinfo, dbus.String)

    def test_list_networks(self):
        networks = self.connect.ListNetworks(0)
        assert isinstance(networks, dbus.Array)
        assert len(networks) == 1

        for path in networks:
            assert isinstance(path, dbus.ObjectPath)
            network = self.bus.get_object('org.libvirt', path)

            # ensure the path exists by calling Introspect on it
            network.Introspect(dbus_interface=dbus.INTROSPECTABLE_IFACE)

    def test_connect_get_capabilities(self):
        assert isinstance(self.connect.GetCapabilities(), dbus.String)

    def test_connect_get_cpu_model_names(self):
        arch = "x86_64"
        assert isinstance(self.connect.GetCPUModelNames(arch, 0), dbus.Array)

    def test_connect_network_create_xml(self):
        def network_started(path, _event):
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('NetworkEvent', network_started, arg1='Started')

        path = self.connect.NetworkCreateXML(self.minimal_network_xml)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    def test_connect_network_define_xml(self):
        def network_defined(path, _event):
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('NetworkEvent', network_defined, arg1='Defined')

        path = self.connect.NetworkDefineXML(self.minimal_network_xml)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

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

    def test_connect_node_get_cpu_stats(self):
        stats = self.connect.NodeGetCPUStats(0, 0)
        assert isinstance(stats, dbus.Dictionary)


if __name__ == '__main__':
    libvirttest.run()

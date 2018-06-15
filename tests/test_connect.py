#!/usr/bin/env python3

import dbus
import libvirttest
import pytest
import xmldata


class TestConnect(libvirttest.BaseTestClass):
    def test_connect_domain_create_xml(self):
        def domain_started(path, event, detail):
            if event != libvirttest.DomainEvent.STARTED:
                return
            assert detail == libvirttest.DomainEventStartedDetailType.BOOTED
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_started)

        path = self.connect.DomainCreateXML(xmldata.minimal_domain_xml, 0)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    def test_comnect_domain_define_xml(self):
        def domain_defined(path, event, detail):
            if event != libvirttest.DomainEvent.DEFINED:
                return
            assert detail == libvirttest.DomainEventDefinedDetailType.ADDED
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_defined)

        path = self.connect.DomainDefineXML(xmldata.minimal_domain_xml)
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
        obj, _ = self.get_test_domain()
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

    def test_connect_list_storage_pools(self):
        storage_pools = self.connect.ListStoragePools(0)
        assert isinstance(storage_pools, dbus.Array)
        assert len(storage_pools) == 1

        for path in storage_pools:
            assert isinstance(path, dbus.ObjectPath)
            storage_pool = self.bus.get_object('org.libvirt', path)

            # ensure the path exists by calling Introspect on it
            storage_pool.Introspect(dbus_interface=dbus.INTROSPECTABLE_IFACE)

    def test_connect_network_create_xml(self):
        def network_started(path, event):
            if event != libvirttest.NetworkEvent.STARTED:
                return
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('NetworkEvent', network_started)

        path = self.connect.NetworkCreateXML(xmldata.minimal_network_xml)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    def test_connect_network_define_xml(self):
        def network_defined(path, event):
            if event != libvirttest.NetworkEvent.DEFINED:
                return
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('NetworkEvent', network_defined)

        path = self.connect.NetworkDefineXML(xmldata.minimal_network_xml)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    @pytest.mark.usefixtures("node_device_create")
    @pytest.mark.parametrize("lookup_method_name,lookup_item", [
        ("NodeDeviceLookupByName", 'Name'),
    ])
    def test_connect_node_device_lookup_by_property(self, lookup_method_name, lookup_item):
        """Parameterized test for all NodeDeviceLookupBy* API calls of Connect interface
        """
        original_path = self.node_device_create()
        obj = self.bus.get_object('org.libvirt', original_path)
        prop = obj.Get('org.libvirt.NodeDevice', lookup_item, dbus_interface=dbus.PROPERTIES_IFACE)
        path = getattr(self.connect, lookup_method_name)(prop)
        assert original_path == path

    @pytest.mark.parametrize("lookup_method_name,lookup_item", [
        ("NetworkLookupByName", 'Name'),
        ("NetworkLookupByUUID", 'UUID'),
    ])
    def test_connect_network_lookup_by_property(self, lookup_method_name, lookup_item):
        """Parameterized test for all NetworkLookupBy* API calls of Connect interface
        """
        original_path, obj = self.get_test_network()
        prop = obj.Get('org.libvirt.Network', lookup_item, dbus_interface=dbus.PROPERTIES_IFACE)
        path = getattr(self.connect, lookup_method_name)(prop)
        assert original_path == path

    def test_connect_node_device_create_xml(self):
        def node_device_created(path, event, _detail):
            if event != libvirttest.NodeDeviceEvent.CREATED:
                return
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('NodeDeviceEvent', node_device_created)

        path = self.connect.NodeDeviceCreateXML(xmldata.minimal_node_device_xml, 0)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    def test_connect_node_get_cpu_stats(self):
        stats = self.connect.NodeGetCPUStats(0, 0)
        assert isinstance(stats, dbus.Dictionary)

    def test_connect_node_get_free_memory(self):
        free_mem = self.connect.NodeGetFreeMemory()
        assert isinstance(free_mem, dbus.UInt64)

    def test_connect_node_get_cpumap(self):
        info = self.connect.NodeGetCPUMap(0)
        assert isinstance(info, dbus.Array)

    def test_connect_storage_pool_create_xml(self):
        def storage_pool_started(path, event, _detail):
            if event != libvirttest.StoragePoolEvent.STARTED:
                return
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('StoragePoolEvent', storage_pool_started)

        path = self.connect.StoragePoolCreateXML(
            xmldata.minimal_storage_pool_xml, 0)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    def test_connect_storage_pool_define_xml(self):
        def storage_pool_defined(path, event, _detail):
            if event != libvirttest.StoragePoolEvent.DEFINED:
                return
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('StoragePoolEvent', storage_pool_defined)

        path = self.connect.StoragePoolDefineXML(
            xmldata.minimal_storage_pool_xml, 0)
        assert isinstance(path, dbus.ObjectPath)

        self.main_loop()

    @pytest.mark.parametrize("lookup_method_name,lookup_item", [
        ("StoragePoolLookupByName", 'Name'),
        ("StoragePoolLookupByUUID", 'UUID'),
    ])
    def test_connect_storage_pool_lookup_by_property(self,
                                                     lookup_method_name,
                                                     lookup_item):
        """Parameterized test for all StoragePoolLookupBy* API calls of Connect interface
        """
        original_path, obj = self.get_test_storage_pool()
        prop = obj.Get('org.libvirt.StoragePool', lookup_item,
                       dbus_interface=dbus.PROPERTIES_IFACE)
        path = getattr(self.connect, lookup_method_name)(prop)
        assert original_path == path

    @pytest.mark.usefixtures("storage_volume_create")
    @pytest.mark.parametrize("lookup_method_name,lookup_item", [
        ("StorageVolLookupByKey", 'Key'),
        ("StorageVolLookupByPath", 'Path'),
    ])
    def test_connect_storage_vol_lookup_by_property(self,
                                                    lookup_method_name,
                                                    lookup_item):
        """Parameterized test for all StorageVolLookupBy* API calls of Connect interface
        """
        original_path, obj = self.get_test_storage_volume()
        prop = obj.Get('org.libvirt.StorageVol', lookup_item,
                       dbus_interface=dbus.PROPERTIES_IFACE)
        path = getattr(self.connect, lookup_method_name)(prop)
        assert original_path == path


if __name__ == '__main__':
    libvirttest.run()

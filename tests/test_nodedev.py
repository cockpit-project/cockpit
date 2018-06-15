#!/usr/bin/env python3

import dbus
import libvirttest
import pytest


@pytest.mark.usefixtures("node_device_create")
class TestNodeDevice(libvirttest.BaseTestClass):
    """ Tests for methods and properties of the NodeDevice interface
    """

    def test_node_device_destroy(self):
        def node_device_deleted(path, event, _detail):
            if event != libvirttest.NodeDeviceEvent.DELETED:
                return
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('NodeDeviceEvent', node_device_deleted)

        test_node_device_path = self.node_device_create()
        obj = self.bus.get_object('org.libvirt', test_node_device_path)
        interface_obj = dbus.Interface(obj, 'org.libvirt.NodeDevice')
        interface_obj.Destroy()

        self.main_loop()

    def test_node_device_get_xml_description(self):
        test_node_device_path = self.node_device_create()
        obj = self.bus.get_object('org.libvirt', test_node_device_path)
        interface_obj = dbus.Interface(obj, 'org.libvirt.NodeDevice')
        assert isinstance(interface_obj.GetXMLDesc(0), dbus.String)

    def test_node_device_list_caps(self):
        test_node_device_path = self.node_device_create()
        obj = self.bus.get_object('org.libvirt', test_node_device_path)
        interface_obj = dbus.Interface(obj, 'org.libvirt.NodeDevice')
        assert isinstance(interface_obj.ListCaps(), dbus.Array)

    def test_node_device_properties_type(self):
        """ Ensure correct return type for NodeDevice properties
        """
        test_node_device_path = self.node_device_create()
        obj = self.bus.get_object('org.libvirt', test_node_device_path)
        props = obj.GetAll('org.libvirt.NodeDevice', dbus_interface=dbus.PROPERTIES_IFACE)
        assert isinstance(props['Name'], dbus.String)
        assert isinstance(props['Parent'], dbus.String)


if __name__ == '__main__':
    libvirttest.run()

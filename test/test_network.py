#!/usr/bin/python3

import dbus
import libvirttest


class TestNetwork(libvirttest.BaseTestClass):
    """ Tests for methods and properties of the Network interface
    """
    def test_network_properties_type(self):
        """ Ensure correct return type for Network properties
        """
        _, obj = self.test_network()
        props = obj.GetAll('org.libvirt.Network', dbus_interface=dbus.PROPERTIES_IFACE)
        assert isinstance(props['Name'], dbus.String)


if __name__ == '__main__':
    libvirttest.run()

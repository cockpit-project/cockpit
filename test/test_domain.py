#!/usr/bin/python3

import dbus
import libvirttest


class TestDomain(libvirttest.BaseTestClass):
    def domain(self):
        path = self.connect.ListDomains(0)[0]
        obj = self.bus.get_object('org.libvirt', path)
        return obj, dbus.Interface(obj, 'org.libvirt.Domain')

    def test_api(self):
        obj, domain = self.domain()

        props = obj.GetAll('org.libvirt.Domain', dbus_interface=dbus.PROPERTIES_IFACE)
        assert isinstance(props['Name'], dbus.String)
        assert isinstance(props['UUID'], dbus.String)
        assert isinstance(props['Id'], dbus.UInt32)
        assert isinstance(props['OSType'], dbus.String)
        assert isinstance(props['Active'], dbus.Boolean)
        assert isinstance(props['Persistent'], dbus.Boolean)
        assert isinstance(props['State'], dbus.String)
        assert isinstance(props['Autostart'], dbus.Boolean)

        # Call all methods except Reset and GetStats, because the test backend
        # doesn't support those

        xml = domain.GetXMLDesc(0)
        assert isinstance(xml, dbus.String)
        vcpus = domain.GetVcpus(0)
        assert isinstance(vcpus, dbus.UInt32)

        domain.Reboot(0)
        domain.Shutdown(0)
        domain.Create(0)
        domain.Destroy()
        domain.Undefine(0)

    def test_shutdown(self):
        def domain_stopped(name, path):
            assert name == 'test'
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainStopped', domain_stopped)

        obj, domain = self.domain()
        domain.Shutdown(0)

        state = obj.Get('org.libvirt.Domain', 'State', dbus_interface=dbus.PROPERTIES_IFACE)
        assert state == 'shutoff'

        self.main_loop()

    def test_undefine(self):
        def domain_undefined(name, path):
            assert name == 'test'
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainUndefined', domain_undefined)

        _, domain = self.domain()
        domain.Shutdown(0)
        domain.Undefine(0)

        self.main_loop()


if __name__ == '__main__':
    libvirttest.run()

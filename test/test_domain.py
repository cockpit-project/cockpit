#!/usr/bin/python3

import dbus
import libvirttest

DBUS_EXCEPTION_MISSING_FUNCTION = 'this function is not supported by the connection driver'

class TestDomain(libvirttest.BaseTestClass):
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
        try:
            domain.Destroy(0)
        except dbus.exceptions.DBusException as e:
            if not any(DBUS_EXCEPTION_MISSING_FUNCTION in arg for arg in e.args):
                raise e
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

    def test_suspend(self):
        def domain_suspended(name, path):
            assert name == 'test'
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainSuspended', domain_suspended)

        obj, domain = self.domain()
        domain.Suspend()

        state = obj.Get('org.libvirt.Domain', 'State', dbus_interface=dbus.PROPERTIES_IFACE)
        assert state == 'paused'

        self.main_loop()

    def test_resume(self):
        def domain_resumed(name, path):
            assert name == 'test'
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainResumed', domain_resumed)

        obj, domain = self.domain()
        domain.Suspend()
        domain.Resume()

        state = obj.Get('org.libvirt.Domain', 'State', dbus_interface=dbus.PROPERTIES_IFACE)
        assert state == 'running'

        self.main_loop()

if __name__ == '__main__':
    libvirttest.run()

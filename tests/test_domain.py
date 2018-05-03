#!/usr/bin/env python3

import dbus
import libvirttest

DBUS_EXCEPTION_MISSING_FUNCTION = 'this function is not supported by the connection driver'

class TestDomain(libvirttest.BaseTestClass):
    def test_api(self):
        obj, domain = self.domain()

        props = obj.GetAll('org.libvirt.Domain', dbus_interface=dbus.PROPERTIES_IFACE)
        assert isinstance(props['Active'], dbus.Boolean)
        assert isinstance(props['Autostart'], dbus.Boolean)
        assert isinstance(props['Id'], dbus.UInt32)
        assert isinstance(props['Name'], dbus.String)
        assert isinstance(props['OSType'], dbus.String)
        assert isinstance(props['Persistent'], dbus.Boolean)
        assert any([isinstance(props['SchedulerType'], dbus.Struct),
                    isinstance(props['SchedulerType'][0], dbus.String),
                    isinstance(props['SchedulerType'][1], dbus.Int32)])
        assert isinstance(props['State'], dbus.UInt32)
        assert isinstance(props['Updated'], dbus.Boolean)
        assert isinstance(props['UUID'], dbus.String)

        # Call all methods except Reset and GetStats, because the test backend
        # doesn't support those

        xml = domain.GetXMLDesc(0)
        assert isinstance(xml, dbus.String)

        domain.Reboot(0)
        domain.Shutdown(0)
        domain.Create(0)
        try:
            domain.Destroy(0)
        except dbus.exceptions.DBusException as e:
            if not any(DBUS_EXCEPTION_MISSING_FUNCTION in arg for arg in e.args):
                raise e
        domain.Undefine(0)

    def test_domain_autostart(self):
        _, domain = self.domain()
        autostart_expected = True
        domain.Set('org.libvirt.Domain', 'Autostart', autostart_expected, dbus_interface=dbus.PROPERTIES_IFACE)
        autostart_current = domain.Get('org.libvirt.Domain', 'Autostart', dbus_interface=dbus.PROPERTIES_IFACE)
        assert autostart_current == dbus.Boolean(autostart_expected)

    def test_domain_managed_save(self):
        def domain_stopped(path, event, detail):
            if event != libvirttest.DomainEvent.STOPPED:
                return
            assert detail == libvirttest.DomainEventStoppedDetailType.SAVED
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_stopped)

        obj, domain = self.domain()
        domain.ManagedSave(0)
        assert domain.HasManagedSaveImage(0) == dbus.Boolean(True)
        state = obj.Get('org.libvirt.Domain', 'State', dbus_interface=dbus.PROPERTIES_IFACE)
        assert state == libvirttest.DomainState.SHUTOFF
        domain.ManagedSaveRemove(0)
        assert domain.HasManagedSaveImage(0) == dbus.Boolean(False)

        self.main_loop()

    def test_domain_metadata(self):
        metadata_description = 0
        obj, domain = self.domain()
        description_expected = "This is the Test domain"
        domain.SetMetadata(metadata_description,
                           description_expected, "", "", 0)
        assert description_expected == domain.GetMetadata(metadata_description, "", 0)

    def test_resume(self):
        def domain_resumed(path, event, detail):
            if event != libvirttest.DomainEvent.RESUMED:
                return
            assert detail == libvirttest.DomainEventResumedDetailType.UNPAUSED
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_resumed)

        obj, domain = self.domain()
        domain.Suspend()
        domain.Resume()

        state = obj.Get('org.libvirt.Domain', 'State', dbus_interface=dbus.PROPERTIES_IFACE)
        assert state == libvirttest.DomainState.RUNNING

        self.main_loop()

    def test_shutdown(self):
        def domain_stopped(path, event, detail):
            if event != libvirttest.DomainEvent.STOPPED:
                return
            assert detail == libvirttest.DomainEventStoppedDetailType.SHUTDOWN
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_stopped)

        obj, domain = self.domain()
        domain.Shutdown(0)

        state = obj.Get('org.libvirt.Domain', 'State', dbus_interface=dbus.PROPERTIES_IFACE)
        assert state == libvirttest.DomainState.SHUTOFF

        self.main_loop()

    def test_suspend(self):
        def domain_suspended(path, event, detail):
            if event != libvirttest.DomainEvent.SUSPENDED:
                return
            assert detail == libvirttest.DomainEventSuspendedDetailType.PAUSED
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_suspended)

        obj, domain = self.domain()
        domain.Suspend()

        state = obj.Get('org.libvirt.Domain', 'State', dbus_interface=dbus.PROPERTIES_IFACE)
        assert state == libvirttest.DomainState.PAUSED

        self.main_loop()

    def test_undefine(self):
        def domain_undefined(path, event, detail):
            if event != libvirttest.DomainEvent.UNDEFINED:
                return
            assert detail == libvirttest.DomainEventUndefinedDetailType.REMOVED
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('DomainEvent', domain_undefined)

        _, domain = self.domain()
        domain.Shutdown(0)
        domain.Undefine(0)

        self.main_loop()

    def test_domain_vcpus(self):
        obj, domain = self.domain()
        vcpus_expected = 2
        domain.SetVcpus(vcpus_expected, 0)
        assert domain.GetVcpus(0) == dbus.Int32(vcpus_expected)


if __name__ == '__main__':
    libvirttest.run()

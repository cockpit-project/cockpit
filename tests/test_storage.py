#!/usr/bin/env python3

import dbus
import libvirttest

class TestStoragePool(libvirttest.BaseTestClass):
    def test_storage_pool_build(self):
        _, test_storage_pool = self.test_storage_pool()
        interface_obj = dbus.Interface(test_storage_pool,
                                       'org.libvirt.StoragePool')
        interface_obj.Destroy()
        interface_obj.Build(libvirttest.StoragePoolBuildFlags.NEW)

    def test_storage_pool_create(self):
        def storage_pool_started(path, event, _detail):
            if event != libvirttest.StoragePoolEvent.STARTED:
                return
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('StoragePoolEvent', storage_pool_started)

        _, test_storage_pool = self.test_storage_pool()
        interface_obj = dbus.Interface(test_storage_pool,
                                       'org.libvirt.StoragePool')
        interface_obj.Destroy()
        interface_obj.Create(0)

        self.main_loop()

    def test_storage_pool_delete(self):
        _, test_storage_pool = self.test_storage_pool()
        interface_obj = dbus.Interface(test_storage_pool,
                                       'org.libvirt.StoragePool')
        interface_obj.Destroy()
        interface_obj.Delete(0)

    def test_storage_pool_destroy(self):
        def storage_pool_destroyed(path, event, _detail):
            if event != libvirttest.StoragePoolEvent.STOPPED:
                return
            assert isinstance(path, dbus.ObjectPath)
            self.loop.quit()

        self.connect.connect_to_signal('StoragePoolEvent',
                                       storage_pool_destroyed)

        _, test_storage_pool = self.test_storage_pool()
        interface_obj = dbus.Interface(test_storage_pool,
                                       'org.libvirt.StoragePool')
        interface_obj.Destroy()

        self.main_loop()

    def test_storage_pool_get_info(self):
        _, test_storage_pool = self.test_storage_pool()
        interface_obj = dbus.Interface(test_storage_pool,
                                       'org.libvirt.StoragePool')
        info = interface_obj.GetInfo()
        assert isinstance(info, dbus.Struct)

    def test_storage_pool_properties_type(self):
        _, obj = self.test_storage_pool()

        props = obj.GetAll('org.libvirt.StoragePool',
                           dbus_interface=dbus.PROPERTIES_IFACE)
        assert isinstance(props['Autostart'], dbus.Boolean)


if __name__ == '__main__':
    libvirttest.run()

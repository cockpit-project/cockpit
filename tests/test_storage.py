#!/usr/bin/env python3

import dbus
import libvirttest

class TestStoragePool(libvirttest.BaseTestClass):
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


if __name__ == '__main__':
    libvirttest.run()

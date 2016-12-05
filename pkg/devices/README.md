# Device Management in Cockpit
The 'Devices' plugin provides overview of devices and drivers deployed on the system.

Recently only the PCI bus is supported.

The user can list devices by Class, Driver or IOMMU Group, see available properties.
Device driver can be (un)bound.

Support for SCSI and USB will follow shortly.

Sysfs and lspci utility are used as source of data.

## Requirements
The plugin requires `pciutils` to be installed.

## Links
\[1\] [Feature Page](https://github.com/cockpit-project/cockpit/wiki/Feature:-Hardware-Devices)

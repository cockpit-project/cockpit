Cockpit Storage in Anaconda Mode
================================

Anaconda (the OS Installer) can open the Cockpit "storaged" page for
advanced setup of the target storage devices. When this is done,
storaged is in a special "Anaconda mode" and behaves significantly
different.

In essence, the storaged page restricts itself to working with the
target environment. It will hide the real root filesystem (on the USB
stick that the Live environment was booted from, say), but let the
user create a "fake" root filesystem on some block device.

Entering Anaconda mode
----------------------

The "storaged" page is put into Anaconda mode by storing a
"cockpit_anaconda" item in its `window.localStorage`.  The value
should be a JSON encoded object, the details of which are explained
below.

Since both Anaconda and the storaged page are served from the same
origin, Anaconda can just execute something like this:

```
    window.localStorage.setItem("cockpit_anaconda",
                                JSON.stringify({
                                    "mount_point_prefix": "/sysroot",
                                    "available_devices": [ "/dev/sda" ]
                                }));
    window.open("/cockpit/@localhost/storage/index.html", "storage-tab");
```

Ignoring storage devices
------------------------

Anaconda needs to tell Cockpit which devices can be used to install
the OS on. This is done with the "available_devices" entry, which is
an array of strings.

```
{
  "available_devices": [ "/dev/sda" ]
}
```

This list should only contain entries for top-level block devices. It
should not contain things like partitions, device mapper devices, or
mdraid devices.

Mount point prefix
------------------

Cockpit can be put into a kind of "chroot" environment by giving it a
mount point prefix like so:

```
{
  "mount_point_prefix": "/sysroot"
}
```

This works at the UI level: filesystems that have mount points outside
of "/sysroot" are hidden from the user, and when letting the user work
with mount points below "/sysroot", the "/sysroot" prefix is omitted
in the UI. So when the user says to create a filesystem on "/var",
they are actually creating one on "/sysroot/var".

However, Cockpit (via UDisks2) will still write the new mount point
configuration into the real /etc/fstab (_not_
/sysroot/etc/fstab). This is done for the convenience of Cockpit, and
Anaconda is not expected to read it.

If and how Cockpit communicates back to Anaconda is still open.

BIOS or EFI
-----------

Anaconda needs to tell Cockpit whether a BIOS or a EFI system is being
installed. This controls which kind of special partitions can be
created easily.

This is done by setting the "efi" flag to true or false:

```
{
  "efi": true
}
```

Default filesystem type
-----------------------

Cockpit tries to be smart about which filesystem type to select by
default when formatting something.  In normal operation, it will fall
back to the type of the filesystem mounted as "/". When in Anaconda
mode, there might not be anything assigned to "/" yet, and in this
case, Cockpit will use the type from "default_fsys_type".

```
{
  "default_fsys_type": "xfs"
}
```

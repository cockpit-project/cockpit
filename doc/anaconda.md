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
"cockpit_anaconda" item in its `window.sessionStorage`.  The value
should be a JSON encoded object, the details of which are explained
below.

Ignoring storage devices
------------------------

Anaconda needs to tell Cockpit which devices can be used to install
the OS on. This is done with the "available_devices" entry, which is
an array of strings.

```json
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

```json
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

BIOS or EFI
-----------

Anaconda needs to tell Cockpit whether a BIOS or a EFI system is being
installed. This controls which kind of special partitions can be
created easily.

This is done by setting the "efi" flag to true or false:

```json
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

```json
{
  "default_fsys_type": "xfs"
}
```

Exported information
--------------------

Cockpit maintains some information in the session storage that can be
used by Anaconda to learn things that it doesn't get from blivet. This
is mostly information from fstab.

The "cockpit_mount_points" entry in local storage will have a JSON
encoded object, for example:

```json
{
  "/dev/sda": {
    "type": "filesystem",
    "dir": "/"
  },
  "/dev/sdb": {
    "type": "swap"
  },
  "/dev/sdc": {
    "type": "crypto",
    "content": {
      "type": "filesystem",
      "subvolumes": {
        "home": { "dir": "/home" }
      }
    }
  }
}
```

The keys are pathnames of device nodes in /dev.

Each value is an object with a "type" field. The type determines which
other fields might be present, and what they mean.  The following
types might appear:

 - "filesystem"

 A filesystem with an entry in fstab. A filesystem without subvolumes
 has a "dir" field that is its mount point. A filesystem with
 subvolumes has a "subvolumes" field that is a map from subvolume
 names to mount points.

 There might also be both a "dir" and a "subvolumes" field. The "dir"
 field then has the mount point for the default subvolume of the
 filesystem. This is hopefully rare.

 - "swap"

 A swap device. No other fields are present.

 - "crypto"

 An encrypted device. It has a "content" field with a value that is
 structured like a value for "cockpit_mount_points", i.e., a object
 with a "type" field and maybe a "dir" field if "type" is
 "filesystem". This might also be present when the crypto device is
 closed.

 It might also have a "cleartext_device" field if the encrpyted device
 is currently open.

Cockpit does some magic (via the "x-parent" options in fstab and
crypttab) to produce information also for locked LUKS devices, and
inactive logical volumes.

Cockpit also remembers and exports encryption passphrases in session
storage, in the "cockpit_passphrases" entry. This is a map from device
names to cleartext passphrases. This is only done when Cockpit runs in
a "secure context", see
https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts

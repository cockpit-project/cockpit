#! /usr/bin/python3

# btrfs-tool  --  Query and monitor btrfs filesystems
#
# This program monitors all btrfs filesystems and reports their
# subvolumes and other things.
#
# It can do that continuously, or as a one shot operation.  The tool
# mounts btrfs filesystems as necessary to retrieve the requested
# information, but does it in a polite way: they are mounted once and
# then left mounted until that is no longer needed. Typically, you
# might see some mounts when a Cockpit session starts, and the
# corresponding unmounts when it ends.
#
# This tool can be run multiple times concurrently with itself, and it
# wont get confused.

import ctypes
import json
import os
import re
import signal
import subprocess
import sys
import time


def debug(msg):
    # subprocess.check_call(["logger", msg])
    # sys.stderr.write(msg + "\n")
    pass


TMP_MP_DIR = "/run/cockpit/btrfs"


def list_filesystems():
    output = json.loads(subprocess.check_output(["lsblk", "--json", "--paths", "--list", "--noheadings",
                                                 "--output", "NAME,FSTYPE,UUID,MOUNTPOINTS"]))
    filesystems = {}
    for b in output['blockdevices']:
        if b['fstype'] == "btrfs":
            uuid = b['uuid']
            mps = list(filter(lambda x: x is not None, b['mountpoints']))
            real_mps = list(filter(lambda x: not x.startswith(TMP_MP_DIR), mps))
            has_tmp_mp = len(real_mps) < len(mps)
            if uuid not in filesystems:
                filesystems[uuid] = {
                    'uuid': uuid,
                    'devices': [b['name']],
                    'mountpoints': real_mps,
                    'has_tmp_mountpoint': has_tmp_mp
                }
            else:
                filesystems[uuid]['devices'] += [b['name']]
                filesystems[uuid]['mountpoints'] += real_mps
                filesystems[uuid]['has_tmp_mountpoint'] = filesystems[uuid]['has_tmp_mountpoint'] or has_tmp_mp
    return filesystems


def get_tmp_mountpoint_path(uuid):
    return os.path.join(TMP_MP_DIR, uuid)


mount_errors = {}


def add_tmp_mountpoint(fs):
    global mount_errors
    uuid = fs['uuid']
    if uuid in mount_errors:
        return None
    path = get_tmp_mountpoint_path(uuid)
    try:
        debug(f"MOUNTING {path}")
        os.makedirs(path, exist_ok=True)
        subprocess.check_call(["mount", fs['devices'][0], path])
        return path
    except Exception as err:
        sys.stderr.write(f"Failed to mount {path}: {err}\n")
        mount_errors[uuid] = str(err)
        return None


def remove_tmp_mountpoint(uuid):
    path = get_tmp_mountpoint_path(uuid)
    try:
        debug(f"UNMOUNTING {path}")
        subprocess.check_call(["umount", path])
    except Exception as err:
        sys.stderr.write(f"Failed to unmount {path}: {err}\n")


def get_mount_point(fs, opt_mount):
    if len(fs['mountpoints']) > 0:
        if fs['has_tmp_mountpoint']:
            remove_tmp_mountpoint(fs['uuid'])
        return fs['mountpoints'][0]
    elif fs['has_tmp_mountpoint']:
        return get_tmp_mountpoint_path(fs['uuid'])
    elif opt_mount:
        return add_tmp_mountpoint(fs)
    else:
        return None


def get_subvolume_info(mp):
    lines = subprocess.check_output(["btrfs", "subvolume", "list", "-apuq", mp]).splitlines()
    subvols = []
    for line in lines:
        match = re.match(rb"ID (\d+).*parent (\d+).*parent_uuid (.*)uuid (.*) path (<FS_TREE>/)?(.*)", line)
        if match:
            pathname = match[6].decode(errors='replace')
            # Ignore podman btrfs subvolumes, they are an implementation detail.
            if "containers/storage/btrfs/subvolumes" not in pathname:
                subvols += [
                    {
                        'pathname': pathname,
                        'id': int(match[1]),
                        'parent': int(match[2]),
                        'uuid': match[4].decode(),
                        'parent_uuid': None if match[3][0] == ord("-") else match[3].decode().strip()
                    }
                ]
    return subvols


def get_default_subvolume(mp):
    output = subprocess.check_output(["btrfs", "subvolume", "get-default", mp])
    match = re.match(rb"ID (\d+).*", output)
    if match:
        return int(match[1])
    else:
        return None


def get_usages(uuid):
    output = subprocess.check_output(["btrfs", "filesystem", "show", "--raw", uuid])
    usages = {}
    for line in output.splitlines():
        match = re.match(rb".*used\s+(\d+)\s+path\s+([\w/]+).*", line)
        if match:
            usages[match[2].decode()] = int(match[1])
    return usages


def poll(opt_mount):
    global mount_errors
    debug(f"POLL mount {opt_mount}")
    filesystems = list_filesystems()
    info = {}
    for fs in filesystems.values():
        mp = get_mount_point(fs, opt_mount)
        try:
            data = {'usages': get_usages(fs['uuid'])}
            if mp:
                data['subvolumes'] = get_subvolume_info(mp)
                data['default_subvolume'] = get_default_subvolume(mp)
            elif fs['uuid'] in mount_errors:
                data['error'] = {'error': mount_errors[fs['uuid']]}
            info[fs['uuid']] = data
        except Exception as err:
            info[fs['uuid']] = {'error': str(err)}

    return info


def cmd_monitor(opt_mount):
    old_infos = poll(opt_mount)
    sys.stdout.write(json.dumps(old_infos) + "\n")
    sys.stdout.flush()
    while True:
        time.sleep(5.0)
        new_infos = poll(opt_mount)
        if new_infos != old_infos:
            sys.stdout.write(json.dumps(new_infos) + "\n")
            sys.stdout.flush()
            old_infos = new_infos


def cmd_poll(opt_mount):
    infos = poll(opt_mount)
    sys.stdout.write(json.dumps(infos) + "\n")
    sys.stdout.flush()


def unshare_mounts():
    # The os.unshare function is available since Python 3.12, but we
    # still need to support older Pythons.
    if "unshare" in os.__dict__:
        os.unshare(os.CLONE_NEWNS)
    else:
        libc = ctypes.CDLL(None)
        libc.unshare.argtypes = [ctypes.c_int]
        get_errno_loc = libc.__errno_location
        get_errno_loc.restype = ctypes.POINTER(ctypes.c_int)
        ret = libc.unshare(2**17)
        if ret != 0:
            errno = get_errno_loc()[0]
            raise OSError(errno, os.strerror(errno))
    subprocess.check_call(["mount", "--make-rslave", "/"])


def cmd_do(uuid, cmd):
    debug(f"DO {uuid} {cmd}")
    filesystems = list_filesystems()
    for fs in filesystems.values():
        if fs['uuid'] == uuid:
            path = TMP_MP_DIR
            dev = fs['devices'][0]
            os.makedirs(path, mode=0o700, exist_ok=True)
            subprocess.check_call(["mount", dev, path])
            subprocess.check_call(cmd, cwd=path)


def cmd(args):
    unshare_mounts()
    if len(args) > 1:
        if args[1] == "poll":
            cmd_poll(len(args) > 2)
        elif args[1] == "monitor":
            cmd_monitor(len(args) > 2)
        elif args[1] == "do":
            cmd_do(args[2], args[3:])


def main(args):
    signal.signal(signal.SIGTERM, lambda _signo, _stack: sys.exit(0))
    try:
        cmd(args)
    except Exception as err:
        sys.stderr.write(str(err) + "\n")
        sys.exit(1)


main(sys.argv)

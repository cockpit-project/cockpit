#! /usr/bin/python3

# btrfs-tool  --  Query and monitor btrfs filesystems
#
# This program monitors all btrfs filesystems and reports their
# subvolumes and other things.
#
# It can do that continously, or as a one shot operation.  The tool
# mounts btrfs filesystems as necessary to retrieve the requested
# information, but does it in a polite way: they are mounted once and
# then left mounted until that is no longer needed. Typically, you
# might see some mounts when a Cockpit session starts, and the
# corresponding unmounts when it ends.
#
# This tool can be run multiple times concurrently with itself, and it
# wont get confused.

import contextlib
import fcntl
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


TMP_MP_DIR = "/var/lib/cockpit/btrfs"


def read_all(fd):
    data = b""
    while True:
        part = os.read(fd, 4096)
        if len(part) == 0:
            return data
        data += part


@contextlib.contextmanager
def mount_database():
    path = TMP_MP_DIR + "/db"
    os.makedirs(TMP_MP_DIR, mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT)
    fcntl.flock(fd, fcntl.LOCK_EX)
    data = read_all(fd)
    blob = {}
    try:
        if len(data) > 0:
            blob = json.loads(data)
    except Exception as err:
        sys.stderr.write(f"Failed to read {path} as JSON: {err}\n")
    try:
        yield blob
        data = json.dumps(blob).encode() + b"\n"
        os.lseek(fd, 0, os.SEEK_SET)
        os.truncate(fd, 0)
        os.write(fd, data)
    finally:
        os.close(fd)


# There is contextlib.chdir in Python 3.11, which we should use once
# it is available everywhere.
#
@contextlib.contextmanager
def context_chdir(path):
    old_cwd = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old_cwd)


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


tmp_mountpoints = set()


def add_tmp_mountpoint(db, fs, dev, opt_repair):
    global tmp_mountpoints
    uuid = fs['uuid']
    if uuid not in tmp_mountpoints:
        debug(f"ADDING {uuid}")
        tmp_mountpoints.add(uuid)
        if uuid in db and db[uuid] > 0:
            db[uuid] += 1
        else:
            db[uuid] = 1
        if not fs['has_tmp_mountpoint'] and (db[uuid] == 1 or opt_repair):
            path = TMP_MP_DIR + "/" + uuid
            debug(f"MOUNTING {path}")
            os.makedirs(path, exist_ok=True)
            subprocess.check_call(["mount", dev, path])


def remove_tmp_mountpoint(db, uuid):
    global tmp_mountpoints
    if uuid in tmp_mountpoints:
        debug(f"REMOVING {uuid}")
        tmp_mountpoints.remove(uuid)
        if db[uuid] == 1:
            path = TMP_MP_DIR + "/" + uuid
            try:
                debug(f"UNMOUNTING {path}")
                subprocess.check_call(["umount", path])
                subprocess.check_call(["rmdir", path])
            except Exception as err:
                sys.stderr.write(f"Failed to unmount {path}: {err}\n")
            del db[uuid]
        else:
            db[uuid] -= 1


def remove_all_tmp_mountpoints():
    with mount_database() as db:
        for mp in set(tmp_mountpoints):
            remove_tmp_mountpoint(db, mp)


def force_mount_point(db, fs, opt_repair):
    add_tmp_mountpoint(db, fs, fs['devices'][0], opt_repair)
    return TMP_MP_DIR + "/" + fs['uuid']


def get_mount_point(db, fs, opt_mount, opt_repair):
    if len(fs['mountpoints']) > 0:
        remove_tmp_mountpoint(db, fs['uuid'])
        return fs['mountpoints'][0]
    elif opt_mount:
        return force_mount_point(db, fs, opt_repair)
    else:
        return None


def get_subvolume_info(mp):
    lines = subprocess.check_output(["btrfs", "subvolume", "list", "-apuq", mp]).splitlines()
    subvols = []
    for line in lines:
        match = re.match(b"ID (\\d+).*parent (\\d+).*parent_uuid (.*)uuid (.*) path (<FS_TREE>/)?(.*)", line)
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
    match = re.match(b"ID (\\d+).*", output)
    if match:
        return int(match[1])
    else:
        return None


def get_usages(uuid):
    output = subprocess.check_output(["btrfs", "filesystem", "show", "--raw", uuid])
    usages = {}
    for line in output.splitlines():
        match = re.match(b".*used\\s+(\\d+)\\s+path\\s+([\\w/]+).*", line)
        if match:
            usages[match[2].decode()] = int(match[1])
    return usages


def poll(opt_mount, opt_repair):
    debug(f"POLL mount {opt_mount} repair {opt_repair}")
    with mount_database() as db:
        filesystems = list_filesystems()
        info = {}
        for fs in filesystems.values():
            mp = get_mount_point(db, fs, opt_mount, opt_repair)
            if mp:
                try:
                    info[fs['uuid']] = {
                        'subvolumes': get_subvolume_info(mp),
                        'default_subvolume': get_default_subvolume(mp),
                        'usages': get_usages(fs['uuid']),
                    }
                except Exception as err:
                    info[fs['uuid']] = {'error': str(err)}
    return info


def cmd_monitor(opt_mount):
    old_infos = poll(opt_mount, opt_repair=False)
    sys.stdout.write(json.dumps(old_infos) + "\n")
    sys.stdout.flush()
    while True:
        time.sleep(5.0)
        new_infos = poll(opt_mount, opt_repair=False)
        if new_infos != old_infos:
            sys.stdout.write(json.dumps(new_infos) + "\n")
            sys.stdout.flush()
            old_infos = new_infos


def cmd_poll(opt_mount):
    infos = poll(opt_mount, opt_repair=True)
    sys.stdout.write(json.dumps(infos) + "\n")
    sys.stdout.flush()


def cmd_do(uuid, cmd):
    debug(f"DO {uuid} {cmd}")
    with mount_database() as db:
        filesystems = list_filesystems()
        for fs in filesystems.values():
            if fs['uuid'] == uuid:
                mp = force_mount_point(db, fs, opt_repair=True)
                with context_chdir(mp):
                    subprocess.check_call(cmd)


def cmd(args):
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
    finally:
        remove_all_tmp_mountpoints()


main(sys.argv)

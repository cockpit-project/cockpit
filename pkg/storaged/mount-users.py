#! /usr/bin/python3

import json
import os
import pwd
import signal
import subprocess
import sys
import time

# mount-users   --  Find and terminate processes that keep a mount busy


def fuser(mount_point):

    import dbus
    bus = dbus.SystemBus()
    systemd_manager = dbus.Interface(bus.get_object('org.freedesktop.systemd1', '/org/freedesktop/systemd1'),
                                     dbus_interface='org.freedesktop.systemd1.Manager')

    results = {}

    def get_cmdline(pid):
        with open(f"/proc/{pid}/cmdline") as f:
            return " ".join(f.read().split("\0"))

    def get_stat(pid):
        with open(f"/proc/{pid}/stat") as f:
            stat = f.read()
        # Field two is everything between the first "(" and the last ")", the rest is space separated.
        comm_start = stat.index("(") + 1
        comm_end = stat.rindex(")")
        return ([stat[0:comm_start - 1].strip(), stat[comm_start:comm_end],
                 *list(filter(lambda f: f != '', stat[comm_end + 1:-1].split(' ')))])

    def get_loginuser(pid):
        uid = os.stat("/proc/%s" % pid).st_uid
        try:
            return pwd.getpwuid(uid).pw_name
        except OSError:
            return uid

    def check(path, pid):
        t = os.readlink(path)
        if t == mount_point or t.startswith(mount_point + "/"):
            unit = systemd_manager.GetUnitByPID(int(pid))
            if unit not in results:
                unit_obj = bus.get_object('org.freedesktop.systemd1', unit)
                unit_id = unit_obj.Get("org.freedesktop.systemd1.Unit", "Id",
                                       dbus_interface="org.freedesktop.DBus.Properties")
                if unit_id.endswith(".scope"):
                    stat = get_stat(pid)
                    start = int(stat[21]) / os.sysconf('SC_CLK_TCK')
                    results[pid] = {"pid": int(pid),
                                    "cmd": get_cmdline(pid),
                                    "comm": stat[1],
                                    "user": get_loginuser(pid),
                                    "since": time.clock_gettime(time.CLOCK_MONOTONIC) - start}
                else:
                    desc = unit_obj.Get("org.freedesktop.systemd1.Unit", "Description",
                                        dbus_interface="org.freedesktop.DBus.Properties")
                    timestamp = unit_obj.Get("org.freedesktop.systemd1.Unit", "ActiveEnterTimestamp",
                                             dbus_interface="org.freedesktop.DBus.Properties")
                    results[unit] = {"unit": unit_id,
                                     "cmd": get_cmdline(pid),
                                     "desc": desc,
                                     "user": get_loginuser(pid),
                                     "since": time.time() - timestamp / 1e6}
            return True
        return False

    def checkdir(path, pid):
        for f in os.listdir(path):
            if check(os.path.join(path, f), pid):
                return True
        return False

    my_pid = os.getpid()

    for p in os.listdir("/proc/"):
        if not p.isdigit():
            continue
        if int(p) == my_pid:
            continue
        proc = "/proc/%s/" % p
        try:
            if check(proc + "exe", p):
                continue
            if check(proc + "root", p):
                continue
            if check(proc + "cwd", p):
                continue
            if checkdir(proc + "fd", p):
                continue
            if checkdir(proc + "map_files", p):
                continue
        except OSError:
            pass

    return list(results.values())


def users(mount_point):
    data = fuser(mount_point)
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()


def stop_pids(pids):
    def sendsig(pid, sig):
        try:
            os.kill(pid, sig)
            return True
        except Exception:
            return False

    def sendsigs(pids, sig):
        for p in pids:
            sendsig(p, sig)

    def pollpids(pids, count, interval):
        while count > 0:
            i = 0
            while i < len(pids):
                if not sendsig(pids[i], 0):
                    pids.pop(i)
                else:
                    i += 1
            if len(pids) == 0:
                break
            count -= 1
            time.sleep(interval)

    sendsigs(pids, signal.SIGTERM)
    sendsigs(pids, signal.SIGHUP)
    pollpids(pids, 10, 0.1)
    pollpids(pids, 19, 1)
    sendsigs(pids, signal.SIGKILL)
    pollpids(pids, 10, 0.1)


def stop_units(units):
    if len(units) > 0:
        subprocess.check_call(['systemctl', 'stop', *units])


def stop(users):
    stop_pids([u["pid"] for u in users if "pid" in u])
    stop_units([u["unit"] for u in users if "unit" in u])


def dispatch(argv):
    if argv[1] == "users":
        users(argv[2])
    elif argv[1] == "stop":
        stop(json.loads(argv[2]))


try:
    dispatch(sys.argv)
except subprocess.CalledProcessError as e:
    sys.exit(e.returncode)
except Exception as e:
    sys.stderr.write(str(e) + "\n")
    sys.exit(1)

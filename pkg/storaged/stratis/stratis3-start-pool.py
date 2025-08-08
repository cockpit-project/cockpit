import sys

import dbus

uuid = sys.argv[1]
slot = sys.argv[2]
fd = sys.argv[3]

if slot == "-":
    slot_arg = [False, [False, 0]]
elif slot == "any":
    slot_arg = [True, [False, 0]]
else:
    slot_arg = [True, [True, int(slot)]]

if fd == "-":
    fd_arg = [False, 0]
else:
    fd_arg = [True, int(fd)]

reply = dbus.SystemBus().call_blocking('org.storage.stratis3', '/org/storage/stratis3',
                                       'org.storage.stratis3.Manager.r8', 'StartPool',
                                       'ss(b(bu))(bh)',
                                       [uuid, 'uuid', slot_arg, fd_arg])
if reply[1] != 0:
    sys.stderr.write(reply[2] + '\n')
    sys.exit(1)

import sys

import dbus

uuid = sys.argv[1]
slot = sys.argv[2]
file_descriptor = sys.argv[3]

if slot == "-":
    slot_arg = [False, [False, 0]]
elif slot == "any":
    slot_arg = [True, [False, 0]]
else:
    slot_arg = [True, [True, int(slot)]]

if file_descriptor == "-":
    file_descriptor_arg = [False, 0]
else:
    file_descriptor_arg = [True, int(file_descriptor)]

reply = dbus.SystemBus().call_blocking('org.storage.stratis3', '/org/storage/stratis3',
                                       'org.storage.stratis3.Manager.r8', 'StartPool',
                                       'ss(b(bu))(bh)',
                                       [uuid, 'uuid', slot_arg, file_descriptor_arg])
if reply[1] != 0:
    sys.stderr.write(reply[2] + '\n')
    sys.exit(1)

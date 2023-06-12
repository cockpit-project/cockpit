import sys

import dbus

reply = dbus.SystemBus().call_blocking('org.storage.stratis2', '/org/storage/stratis2',
                                       'org.storage.stratis2.Manager.r1', 'SetKey',
                                       'shb', [sys.argv[1], 0, False])
if reply[1] != 0:
    sys.stderr.write(reply[2] + '\n')
    sys.exit(1)

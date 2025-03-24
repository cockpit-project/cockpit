import sys

import dbus

reply = dbus.SystemBus().call_blocking('org.storage.stratis3', '/org/storage/stratis3',
                                       'org.storage.stratis3.Manager.r8', 'StartPool',
                                       'ss(b(bu))(bh)',
                                       [sys.argv[1], 'uuid', [True, [False, 0]], [sys.argv[2] == "passphrase", 0]])
if reply[1] != 0:
    sys.stderr.write(reply[2] + '\n')
    sys.exit(1)

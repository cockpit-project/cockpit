from cockpit.internal_endpoints import cockpit_User
from cockpit.misc.print import Printer

# D-Bus properties
user = cockpit_User()
user.full
user.groups
user.home
user.id
user.shell

# getattr()
Printer.dbus_call
Printer.fsinfo
Printer.help
Printer.packages_reload
Printer.wait

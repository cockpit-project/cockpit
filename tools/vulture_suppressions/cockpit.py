from cockpit.internal_endpoints import cockpit_User
from cockpit.misc.print import Printer
from cockpit.polkit import CommunicationProcess

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

# TYPE_CHECKING types used in stringified annotations
CommunicationProcess

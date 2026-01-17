from cockpit.internal_endpoints import cockpit_User
from cockpit.misc.print import Printer
from cockpit.superuser import SuperuserRoutingRule

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

# Task references kept to prevent garbage collection
SuperuserRoutingRule.polkit_registration_task
SuperuserRoutingRule._peer_done_task

# Used via contextlib.AsyncExitStack, conditionally defined in polyfills.py for Python < 3.7
_.enter_async_context  # type: ignore[name-defined]  # noqa: F821

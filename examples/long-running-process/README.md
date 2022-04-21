## Launch and reattach to a long-running process

Cockpit pages should never spawn long-running precious processes, as a Cockpit
session is not reliably connected for a long time:  Network interfaces go down
or  roam, TCP timeouts happen, browsers crash, tabs get closed accidentally,
batteries drain, people close/suspend their laptops, and so on.

Most services that Cockpit talks to manage their own runtime state and jobs,
such as udisks, libvirt, or podman. But this is not the case for e.g. running
Ansible playbooks or installer scripts. These should be wrapped into a
transient service unit, so that systemd takes over the role of the job manager.

This example demonstrates how to do that. It runs an arbitary shell command in
a transient cockpit-longrunning.service, shows the live log output, and
reattaches to it on page load. I.e. you can start the process, log out, log
back in, and the service is recognized as "already running" with the complete
output.

For your own use case, the most important design question is the choice of the
service name, especially if the page can manage more than one process (such as
launching parallel playbooks with different environment variables). It must
contain exactly all the identifying properties in the name, so that it is
predictable.

If your page does manage multiple processes in parallel, it needs to enumerate
running units with [ListUnits()](https://www.freedesktop.org/wiki/Software/systemd/dbus/).
This example page only manages one at a time, and thus just uses a `GetUnit()` call
with a known name.

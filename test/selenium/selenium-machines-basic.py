import os
import re
from avocado import skipIf
from testlib_avocado.timeoutlib import wait
from testlib_avocado.timeoutlib import TimeoutError
from testlib_avocado.seleniumlib import clickable, invisible, text_in
from testlib_avocado.machineslib import MachinesLib


class MachinesBasicTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def testForceRestartVm(self):
        name = "staticvm"
        args = self.create_vm(name, wait=True)

        def force_reboot_operation():
            self.click(self.wait_css('#vm-{}-reboot-caret'.format(name), cond=clickable))
            self.click(self.wait_css('#vm-{}-forceReboot'.format(name), cond=clickable))
            wait(lambda: re.search("login:.*Initializing cgroup",
                                   self.machine.execute("sudo cat {0}".format(args.get('logfile')))))

        # Retry when running in edge
        # because the first operations will not take effect in some edge browser
        # The error will be throw if timeout at the second time
        try:
            force_reboot_operation()
        except TimeoutError:
            force_reboot_operation()

        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')

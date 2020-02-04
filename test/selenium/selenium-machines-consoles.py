import os
from avocado import skipIf
from selenium.webdriver.support.select import Select
from testlib_avocado.timeoutlib import wait
from testlib_avocado.seleniumlib import clickable, present, text_in
from testlib_avocado.machineslib import MachinesLib


class MachinesConsolesTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def testInlineConsole(self):
        name = "staticvm"
        args = self.create_vm(name, graphics='vnc')

        self.click(self.wait_css('#vm-{}-consoles'.format(name), cond=clickable))
        # HACK: cond=text_in does not work with <select> in Edge
        s = Select(self.wait_id('console-type-select'))
        wait(lambda: s.first_selected_option.text == 'Graphics Console (VNC)')
        self.wait_css('.toolbar-pf-results canvas')

        # Test ctrl+alt+del
        self.wait_vm_complete_start(args)
        self.click(self.wait_css('#console-send-shortcut', cond=clickable))
        self.click(self.wait_css('#console-send-shortcut + ul li:nth-of-type(1) > a', cond=clickable))
        wait(lambda: "reboot: machine restart" in self.machine.execute(
            "sudo cat {0}".format(args.get('logfile'))), delay=3)

    @skipIf(os.environ.get("BROWSER") == 'edge',
            "A confirmation window which can't be closed automatically popped up when closing Edge browser")
    def testExternalConsole(self):
        name = "staticvm"
        self.create_vm(name)

        self.click(self.wait_css('#vm-{}-consoles'.format(name), cond=clickable))
        self.wait_id('console-type-select', cond=text_in, text_='Graphics Console in Desktop Viewer')
        # Launch remote viewer
        self.click(self.wait_css('#vm-{}-consoles-launch'.format(name), cond=clickable))
        self.wait_css('#dynamically-generated-file', cond=present)
        # Check more info link
        self.click(self.wait_css('.machines-desktop-viewer-block .link-button', cond=clickable))
        # Check manual connection info
        self.wait_css("#vm-{}-consoles-manual-address".format(name), cond=text_in, text_="127.0.0.1")
        self.wait_css("#vm-{}-consoles-manual-port-spice".format(name), cond=text_in, text_="5900")

    @skipIf(os.environ.get("BROWSER") == 'edge',
            "A confirmation window which can't be closed automatically popped up when closing Edge browser")
    def testSerialConsole(self):
        name = "staticvm"
        self.create_vm(name, graphics='vnc', ptyconsole=True)

        # Open serial console
        self.click(self.wait_css('#vm-{}-consoles'.format(name), cond=clickable))
        self.select_by_text(self.wait_id('console-type-select'), 'Serial Console')
        self.wait_css(".xterm-accessibility-tree")

        # Disconnect
        self.click(self.wait_css("#{}-serialconsole-disconnect".format(name), cond=clickable))
        self.wait_text("Disconnected from serial console. Click the Connect button.")

        # Reconnect
        self.click(self.wait_css("#{}-serialconsole-connect".format(name), cond=clickable))
        self.wait_css(".xterm-accessibility-tree")

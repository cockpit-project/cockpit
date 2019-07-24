import os
from avocado import skipIf
from selenium.webdriver.support.select import Select
from testlib_avocado.timeoutlib import wait
from testlib_avocado.seleniumlib import clickable, present, invisible, text_in
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
        vv_file_attr = ("data:application/x-virt-viewer,%5Bvirt-viewer%5D%0Atype%3Dspice"
                        "%0Ahost%3D127.0.0.1%0Aport%3D5900%0Adelete-this-file%3D1%0Afullscreen%3D0%0A")
        self.wait_css('a[href="{}"]'.format(vv_file_attr), cond=present)
        # Check more info link
        self.click(self.wait_css('.machines-desktop-viewer-block a[href="#"]', cond=clickable))
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
        self.wait_css('div.terminal canvas.xterm-text-layer')
        # Disconnect
        self.click(self.wait_css("#{}-serialconsole-disconnect".format(name), cond=clickable))
        self.wait_css('div.terminal canvas.xterm-text-layer', cond=invisible)
        self.wait_css('div.blank-slate-pf')
        self.wait_css('p.blank-slate-pf-info', cond=text_in,
                      text_='Disconnected from serial console. Click the Reconnect button.')
        # Reconnect
        self.click(self.wait_css('div.console-terminal-pf button', cond=clickable))
        self.wait_css('div.terminal canvas.xterm-text-layer')
        # Disconnect again and reconnect using reconnect button
        self.click(self.wait_css("#{}-serialconsole-disconnect".format(name), cond=clickable))
        self.wait_css('div.terminal canvas.xterm-text-layer', cond=invisible)
        self.click(self.wait_css('#{}-serialconsole-reconnect'.format(name), cond=clickable))
        self.wait_css('div.terminal canvas.xterm-text-layer')

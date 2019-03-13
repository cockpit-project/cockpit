from testlib_avocado.machineslib import MachinesLib
from testlib_avocado.seleniumlib import clickable, visible


class MachinesNonrootTestSuite(MachinesLib):
    '''
    :avocado: enable
    :avocado: tags=machines_nonroot
    '''

    def testNoneRootOperationWithVm(self):
        self.create_vm()


        self.machine.execute(
            'useradd auto && echo "auto" | passwd --stdin auto')

        self.mainframe()
        self.click(self.wait_css('#navbar-dropdown', cond=clickable))
        self.click(self.wait_css('#go-logout', cond=clickable))

        self.login('auto', 'auto')
        self.click(self.wait_link('Virtual Machines', cond=clickable))
        self.wait_frame("machines")

        self.assertEqual(
            self.wait_css('#virtual-machines-listing tr td', cond=visible).text,
            'No VM is running or defined on this host')
        self.assertEqual(
            self.wait_css('#app div:nth-child(1) .card-pf-aggregate-status-count').text,
            '0')
        self.assertEqual(
            self.wait_css('#app div:nth-child(2) .card-pf-aggregate-status-count').text,
            '0')

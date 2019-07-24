from selenium.webdriver.support.select import Select
from testlib_avocado.seleniumlib import clickable, invisible, visible, text_in
from testlib_avocado.machineslib import MachinesLib
from testlib_avocado.timeoutlib import wait


class MachinesOverviewTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def vcpuConfigureAndCheck(self, vmstate, maxnum, count, sockets, cores, threads):
        # create a vm on host
        name = "staticvm"
        args = self.create_vm(name, state=vmstate)

        # open vcpu configure window
        self.click(self.wait_css('#vm-{}-vcpus-count'.format(name), cond=clickable))
        self.wait_xpath("//input[@id='machines-vcpu-count-field' and @value='1']")
        self.wait_xpath("//input[@id='machines-vcpu-max-field' and @value='1']")

        # set vcpu params
        self.send_keys(self.wait_css('#machines-vcpu-max-field'), maxnum, ctrla=True)
        self.send_keys(self.wait_css('#machines-vcpu-count-field'), count, ctrla=True)
        self.select_by_text(self.wait_id('socketsSelect'), sockets)
        self.select_by_text(self.wait_id('coresSelect'), cores)
        self.select_by_text(self.wait_id('threadsSelect'), threads)
        if vmstate == 'running':
            cond = visible
        else:
            cond = invisible
        self.wait_css('#machines-vcpu-modal-dialog span.idle-message', cond=cond)

        # apply settings
        self.click(self.wait_css('#machines-vcpu-modal-dialog-apply', cond=clickable))
        self.wait_css('#machines-vcpu-modal-dialog', cond=invisible)
        if vmstate == 'running':
            tmpcount = '1'
        else:
            tmpcount = count
        self.wait_css('#vm-{}-vcpus-count'.format(name), cond=text_in, text_=tmpcount)

        # if configure vcpu while vm is running, needs to shut down vm to let configuration take effect.
        if vmstate == 'running':
            # shut down may not work if the VM is not completely started
            self.wait_vm_complete_start(args)
            self.click(self.wait_css('#vm-{}-off'.format(name), cond=clickable))
            self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='shut off')
            self.wait_css('#vm-{}-vcpus-count'.format(name), cond=text_in, text_=count)

        # run vm to see if the configurations are persisted
        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')
        self.wait_css('#vm-{}-vcpus-count'.format(name), cond=text_in, text_=count)
        self.click(self.wait_css('#vm-{}-vcpus-count'.format(name), cond=clickable))
        self.wait_xpath("//input[@id='machines-vcpu-count-field' and @value={}]".format(count))
        self.wait_xpath("//input[@id='machines-vcpu-max-field' and @value={}]".format(maxnum))
        # HACK: cond=text_in does not work with <select> in Edge
        socketsSelect = Select(self.wait_id('socketsSelect'))
        coresSelect = Select(self.wait_id('coresSelect'))
        threadsSelect = Select(self.wait_id('threadsSelect'))
        wait(lambda: socketsSelect.first_selected_option.text == sockets)
        wait(lambda: coresSelect.first_selected_option.text == cores)
        wait(lambda: threadsSelect.first_selected_option.text == threads)

        # check cpu topology in dumpxml
        cmd = "sudo virsh dumpxml {} | tee /tmp/staticvm.xml | " \
            "xmllint --xpath '/domain/cpu/topology[@sockets=\'{}\'][@cores=\'{}\'][@threads=\'{}\']' -" \
            .format(name, sockets, cores, threads)
        self.machine.execute(cmd)

    def testVcpuConfig0(self):
        self.vcpuConfigureAndCheck('shut off', '8', '4', '2', '2', '2')

    def testVcpuConfig1(self):
        self.vcpuConfigureAndCheck('running', '16', '8', '2', '4', '2')

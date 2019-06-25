import os
from time import sleep
from .timeoutlib import wait
from .seleniumlib import SeleniumTest, clickable, text_in, invisible


SPICE_XML = """
    <video>
      <model type='vga' heads='1' primary='yes'/>
      <alias name='video0'/>
    </video>
    <graphics type='spice' port='5900' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
      <image compression='off'/>
    </graphics>
"""

VNC_XML = """
    <video>
      <model type='vga' heads='1' primary='yes'/>
      <alias name='video0'/>
    </video>
    <graphics type='vnc' port='5900' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
    </graphics>
"""

CONSOLE_XML = """
    <console type='file'>
      <target type='serial' port='0'/>
      <source path='{log}'/>
    </console>
"""

PTYCONSOLE_XML = """
    <serial type='pty'>
      <source path='/dev/pts/3'/>
      <target port='0'/>
      <alias name='serial0'/>
    </serial>
    <console type='pty' tty='/dev/pts/3'>
      <source path='/dev/pts/3'/>
      <target type='serial' port='0'/>
      <alias name='serial0'/>
    </console>
"""

DOMAIN_XML = """
<domain type='qemu'>
  <name>{name}</name>
  <vcpu>1</vcpu>
  <os>
    <type>hvm</type>
    <boot dev='hd'/>
    <boot dev='network'/>
  </os>
  <memory unit='MiB'>256</memory>
  <currentMemory unit='MiB'>256</currentMemory>
  <features>
    <acpi/>
  </features>
  <cpu mode='host-model'>
    <model fallback='forbid'/>
  </cpu>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='{image}'/>
      <target dev='hda' bus='ide'/>
    </disk>
    <controller type='scsi' model='virtio-scsi' index='0' id='hot'/>
    <interface type='network'>
      <source network='default' bridge='virbr0'/>
      <target dev='vnet0'/>
    </interface>
    {console}
    {graphics}
  </devices>
</domain>
"""

SYS_POOL_PATH = "/var/lib/libvirt/images"
SYS_LOG_PATH = "/var/log/libvirt"


class MachinesLib(SeleniumTest):
    """
    :avocado: disable
    """

    def create_vm(self, name, graphics='spice', ptyconsole=False, state='running', wait=False):
        self.virshvm = name

        img = "{}/cirros.qcow2".format(SYS_POOL_PATH)
        pool_name = "default"
        pool_path = os.path.dirname(img)
        self.machine.execute("test -f {}".format(img))
        self.machine.execute(
            "sudo virsh pool-list --all | grep {pool} || sudo virsh pool-create-as {pool} --type dir --target {path} && sudo virsh pool-refresh {pool}".format(pool=pool_name, path=pool_path))

        args = {
            "name": name,
            "poolName": pool_name,
            "poolPath": pool_path,
            "image": img,
            "logfile": None,
            "console": "",
            "graphics": ""
        }

        if ptyconsole:
            args["console"] = PTYCONSOLE_XML
        else:
            self.machine.execute("sudo chmod 777 {}".format(SYS_LOG_PATH))
            args["logfile"] = "{}/console-{}.log".format(SYS_LOG_PATH, name)
            args["console"] = CONSOLE_XML.format(log=args["logfile"])

        if graphics == 'spice':
            cxml = SPICE_XML
        elif graphics == 'vnc':
            cxml = VNC_XML
        else:
            cxml = ""
        args["graphics"] = cxml

        xml = DOMAIN_XML.format(**args)
        self.machine.execute('sudo echo \"{}\" > /tmp/xml && sudo virsh define /tmp/xml'.format(xml))
        if state == 'running':
            self.machine.execute('sudo virsh start {}'.format(name))
            if wait:
                self.wait_vm_complete_start(args)
        elif state == 'shut off':
            pass

        self.wait_css('#vm-{}-row'.format(name), cond=text_in, text_=name)
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_=state)
        self.click(self.wait_css("tbody tr[data-row-id='vm-{}'] th".format(name), cond=clickable))

        return args

    def wait_vm_complete_start(self, vmargs):
        log_file = vmargs.get('logfile')
        if log_file is not None:
            wait(
                lambda: "login as 'cirros' user." in self.machine.execute("sudo cat {0}".format(log_file)),
                delay=3)
        else:
            sleep(10)

    def destroy_vm(self, name, connection='system'):
        if name not in self.machine.execute("{}virsh list --all".format('' if connection == 'session' else 'sudo ')):
            return

        vmstate = self.machine.execute("{}virsh domstate {}".format('' if connection == 'session' else 'sudo ', name)).split('\n')[0]
        if vmstate == 'running':
            self.machine.execute('{}virsh destroy {}'.format('' if connection == 'session' else 'sudo ', name))
        self.machine.execute('{}virsh undefine {}'.format('' if connection == 'session' else 'sudo ', name))

    def setUp(self):
        super().setUp()

        self.virshvm = None
        self.storage_pool = {}
        self.vm_stop_list = []

        self.login()
        self.click(self.wait_link('Virtual Machines', cond=clickable))
        self.wait_frame("machines")

    def tearDown(self):
        super().tearDown()
        if self.virshvm:
            self.destroy_vm(self.virshvm)

        if self.vm_stop_list:
            for vm in self.vm_stop_list:
                self.destroy_vm(vm, connection='session')

        # clean the disk,if they are existing
        for key, value in self.storage_pool.items():
            while len(value) != 0 and value != 'disk':
                self.machine.execute('sudo virsh vol-delete {disk} {pool}'.format(disk=value.pop(), pool=key))
        while len(self.storage_pool) != 0:
            item = self.storage_pool.popitem()
            if item[1] == 'disk':
                self.machine.execute('sudo virsh vol-delete {} default'.format(item[0]))
            else:
                self.machine.execute('sudo virsh pool-destroy {}'.format(item[0]))
                self.machine.execute('sudo rm -rf /home/{}'.format(item[0]))

    def wait_dialog_disappear(self):
        # loop for the dialog disappear and it will break after trying with 40 times
        count = 0
        while self.wait_css('#app').get_attribute('aria-hidden'):
            if count == self.default_try:
                break
            count += 1

    def create_vm_by_ui(self,
                        connection='system',
                        name='default',
                        source_type='file',
                        source='/var/lib/libvirt/images/staticvm.qcow2',
                        os_vender='unspecified',
                        os=None,
                        mem=1,
                        mem_unit='G',
                        storage=10,
                        storage_unit='G',
                        immediately_start=False):
        self.click(self.wait_css('#create-new-vm', cond=clickable))
        self.wait_css('#create-vm-dialog')

        if connection == 'session':
            self.select_by_text(self.wait_css('#connection'), 'QEMU/KVM User connection')

        self.send_keys(self.wait_css('#vm-name'), name)

        self.select_by_value(self.wait_css('#source-type'), source_type)

        # If this option is pxe, do the same thing for the file, it will be add
        # in next cases
        filename = source.rsplit("/", 1)[-1]
        if source_type == 'file' or source_type == 'pxe':
            self.send_keys(self.wait_css('#source-file > div > input'), source, ctrla=True)
            # click on filename link if appear dialog window
            element = self.wait_link(filename, fatal=False, overridetry=3, cond=clickable)
            if element:
                self.click(element)
        elif source_type == 'url':
            self.send_keys(self.wait_css('#source-url'), source)
        elif source_type == 'disk_image':
            self.send_keys(self.wait_css('#source-disk > div > input'), source, ctrla=True)
            # click on filename link if appear dialog window
            element = self.wait_link(filename, fatal=False, overridetry=3, cond=clickable)
            if element:
                self.click(element)

        if os is not None:
            self.send_keys(self.wait_css("label:contains('Operating System') + div > div > div > input"), os)

        if mem_unit == 'M':
            self.select_by_text(self.wait_css('#memory-size-unit-select'), 'MiB')

        self.send_keys(self.wait_css('#memory-size'), mem, clear=False, ctrla=True)

        if source_type != 'disk_image':
            if storage_unit == 'M':
                self.select_by_text(self.wait_css('#storage-size-unit-select'), 'MiB')
            self.send_keys(self.wait_css('#storage-size'), storage, clear=False, ctrla=True)

        if immediately_start:
            self.check_box(self.wait_css('#start-vm'))

        self.click(self.wait_css('#create-vm-dialog .modal-footer .btn.btn-primary', cond=clickable))

        self.wait_dialog_disappear()
        self.wait_css('#create-vm-dialog', cond=invisible)
        self.wait_css('#vm-{}-row'.format(name))

    def create_storage_by_ui(self,
                             connection='system',
                             name='storage',
                             type='dir',
                             target_path='',
                             host='',
                             source_path='',
                             start_up=True):
        self.click(self.wait_text('Storage Pools', cond=clickable))
        self.wait_css('#storage-pools-listing')
        self.click(self.wait_css('#create-storage-pool', cond=clickable))

        if connection == 'session':
            self.select_by_value(self.wait_css('#storage-pool-dialog-connection'), 'session')

        self.send_keys(self.wait_css('#storage-pool-dialog-name'), name)

        if type != 'dir':
            self.select_by_value(self.wait_css('#storage-pool-dialog-type'), type)

        self.send_keys(self.wait_css('#storage-pool-dialog-target > div > input'), target_path, ctrla=True)
        sleep(1)

        if type != 'dir':
            self.send_keys(self.wait_css('#storage-pool-dialog-host'), host)
            self.send_keys(self.wait_css('#storage-pool-dialog-source'), source_path)

        self.check_box(self.wait_css('#storage-pool-dialog-autostart', cond=clickable), start_up)

        self.click(self.wait_css('#create-storage-pool-dialog button.btn.btn-primary', cond=clickable))

        self.wait_dialog_disappear()
        pool_name = 'pool-{}-{}'.format(name, connection)
        self.wait_css('#' + pool_name + '-name')

        return pool_name

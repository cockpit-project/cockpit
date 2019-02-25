import os
from time import sleep
from .timeoutlib import wait
from .seleniumlib import SeleniumTest, clickable, text_in

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

    def destroy_vm(self, name):
        if name not in self.machine.execute("sudo virsh list --all"):
            return

        vmstate = self.machine.execute("sudo virsh domstate {}".format(name)).split('\n')[0]
        if vmstate == 'running':
            self.machine.execute('sudo virsh destroy {}'.format(name))
        self.machine.execute('sudo virsh undefine {}'.format(name))

    def setUp(self):
        super().setUp()
        self.virshvm = None
        self.login()
        self.click(self.wait_link('Virtual Machines', cond=clickable))
        self.wait_frame("machines")

    def tearDown(self):
        super().tearDown()
        if self.virshvm:
            self.destroy_vm(self.virshvm)

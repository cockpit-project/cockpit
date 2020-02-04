import re
import os
import secrets
from time import sleep
from .timeoutlib import wait
from .seleniumlib import SeleniumTest, clickable, text_in, invisible
from .exceptions import SeleniumElementFailure
from selenium.webdriver.common.keys import Keys


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
  <memory unit='MiB'>64</memory>
  <currentMemory unit='MiB'>64</currentMemory>
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

STORAGE_XML = """
<pool type='dir'>
  <name>{}</name>
  <target>
    <path>{}</path>
  </target>
</pool>
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

        # clean some storage resource
        while len(self.storage_pool) != 0:
            item = self.storage_pool.popitem()
            if item[0] == 'disk':
                self.machine.execute('sudo virsh vol-delete {} {}'.format(item[1][0], item[1][1]))
            elif item[0] == 'pool':
                self.machine.execute(
                    'sudo virsh pool-destroy {} && sudo virsh pool-undefine {}'.format(item[1], item[1]))

    def wait_dialog_disappear(self):
        # loop for the dialog disappear and it will break after trying with 40 times
        count = 0
        while self.wait_css('#app').get_attribute('aria-hidden'):
            count += 1
            if count == self.default_try:
                break

    def create_vm_by_ui(self,
                        connection='system',
                        name='default',
                        source_type='file',
                        source='/var/lib/libvirt/images/cirros.qcow2',
                        operating_system='CirrOS 0.4.0',
                        mem=1,
                        mem_unit='G',
                        storage=10,
                        storage_unit='G',
                        immediately_start=False):
        if source_type == 'disk_image':
            self.click(self.wait_css('#import-vm-disk', cond=clickable))
        else:
            self.click(self.wait_css('#create-new-vm', cond=clickable))
        self.wait_css('#create-vm-dialog')

        if connection == 'session':
            self.click(self.wait_css("#connection label:last-of-type", cond=clickable))

        self.send_keys(self.wait_css('#vm-name'), name)

        if source_type != 'disk_image':
            self.select_by_value(self.wait_css('#source-type'), source_type)

        filename = source.rsplit("/", 1)[-1]
        if source_type in ['file', 'disk_image', 'pxe']:
            self.send_keys(self.wait_css('label[for=source-file] + div input[type=text]'), source, ctrla=True)
            # click on filename link if appear dialog window
            element = self.wait_link(filename, fatal=False, overridetry=3, cond=clickable)
            if element:
                self.click(element)
        elif source_type == 'url':
            self.send_keys(self.wait_css('#source-url'), source)
        elif source_type == 'pxe':
            item = self.wait_css('#network-select')
            source_list = item.find_elements_by_tag_name('option')
            for sl in source_list:
                if re.match('^(.*)' + source + '(.*)$', sl.text):
                    self.select_by_text(item, sl.text)
                    break

        self.send_keys(self.wait_css("label[for=os-select] + div > div > div > input"), operating_system, clear=False)
        self.send_keys(self.wait_css("label[for=os-select] + div > div > div > input"),
                       Keys.ARROW_DOWN + Keys.ENTER,
                       clear=False)

        if mem_unit == 'M':
            self.select_by_text(self.wait_css('#memory-size-unit-select'), 'MiB')

        self.send_keys(self.wait_css('#memory-size'), mem, clear=False, ctrla=True)

        if source_type != 'disk_image':
            if storage_unit == 'M':
                self.select_by_text(self.wait_css('#storage-size-unit-select'), 'MiB')
            self.send_keys(self.wait_css('#storage-size'), storage, clear=False, ctrla=True)

        self.check_box(self.wait_css('#start-vm'), immediately_start)

        self.click(self.wait_css('#create-vm-dialog .modal-footer .btn.btn-primary', cond=clickable))

        self.wait_dialog_disappear()
        self.wait_css('#create-vm-dialog', cond=invisible)
        # Record the reason of the failed
        if not self.wait_css('#app > div > section > div > div',
                             cond=invisible,
                             overridetry=10,
                             fatal=False):
            self.click(self.wait_text("show more"))
            raise SeleniumElementFailure(self.wait_css('#app > div > section > div > div > p').text)
        self.wait_css('#vm-{}-row'.format(name))

    def create_storage(self, name, path, active=False):
        pool_xml = STORAGE_XML.format(name, path)
        cmd = 'sudo su -c "echo \\"{}\\" > {}" && sudo virsh pool-define {} '

        self.machine.execute(cmd.format(pool_xml, '/tmp/pool', '/tmp/pool'))
        if active:
            self.machine.execute('sudo virsh pool-start {}'.format(name))

        return 'pool-{}-{}'.format(name, 'system')

    def create_storage_by_ui(self,
                             connection='system',
                             name='storage',
                             storage_type='dir',
                             target_path='',
                             host='',
                             source_path='',
                             initiator='',
                             parted='',
                             start_up=True):
        self.click(self.wait_css('#create-storage-pool', cond=clickable))
        self.wait_css('#create-storage-pool-dialog')

        if connection == 'session':
            self.select_by_value(self.wait_css('#storage-pool-dialog-connection'), 'session')

        self.send_keys(self.wait_css('#storage-pool-dialog-name'), name)

        if storage_type != 'dir':
            self.select_by_value(self.wait_css('#storage-pool-dialog-type'), storage_type)

        if storage_type != 'iscsi-direct':
            self.send_keys(self.wait_css('label[for=storage-pool-dialog-target] + div input[type=text]'), target_path, ctrla=True)
            element = self.wait_link(target_path.rsplit('/', 1)[-1], fatal=False, overridetry=3, cond=clickable)
            if element:
                self.click(element)

        if storage_type == 'disk':
            self.send_keys(self.wait_css('label[for=storage-pool-dialog-source] + div input[type=text]'), source_path)
            self.click(self.wait_link(source_path.rsplit('/', 1)[-1], fatal=False, overridetry=3, cond=clickable))
            self.select_by_value(self.wait_css('#storage-pool-dialog-source-format', cond=clickable), parted)

        if storage_type in ['netfs', 'iscsi', 'iscsi-direct']:
            self.send_keys(self.wait_css('#storage-pool-dialog-host'), host)
            self.send_keys(self.wait_css('#storage-pool-dialog-source'), source_path)

        if storage_type == 'iscsi-direct':
            self.send_keys(self.wait_css('#storage-pool-dialog-initiator'), initiator)

        self.check_box(self.wait_css('#storage-pool-dialog-autostart', cond=clickable), start_up)

        self.click(self.wait_css('#create-storage-pool-dialog button.btn.btn-primary', cond=clickable))

        self.wait_dialog_disappear()
        el_id_prefix = 'pool-{}-{}'.format(name, connection)
        self.wait_css('#' + el_id_prefix + '-name')

        return el_id_prefix

    def non_root_user_operations(self,
                                 user_group=None,
                                 operations=False,
                                 vm_args=None,
                                 privilege=False):
        if operations and not vm_args:
            self.error("vm-args should not be empty")

        if not user_group:
            user_name = 'test_non_' + MachinesLib.random_string()
            self.machine.execute(
                'sudo useradd {} && echo "{}" | sudo passwd --stdin {}'.format(user_name, user_name, user_name))
        else:
            user_name = 'test_' + user_group + '_' + MachinesLib.random_string()
            self.machine.execute(
                'sudo useradd -G {} {} && echo "{}" | sudo passwd --stdin {}'.format(user_group, user_name, user_name, user_name))

        self.mainframe()
        self.click(self.wait_css('#navbar-dropdown', cond=clickable))
        self.click(self.wait_css('#go-logout', cond=clickable))

        self.login(user_name, user_name, authorized=privilege)
        self.click(self.wait_link('Virtual Machines', cond=clickable))
        self.wait_frame("machines")

        # if operations is set false, just do some checks
        if not operations:
            self.assertEqual(
                self.wait_css('#virtual-machines-listing tr td').text,
                'No VM is running or defined on this host')
            self.assertEqual(
                self.wait_css('#app div:nth-child(1) .card-pf-aggregate-status-count').text,
                '0')
            self.assertEqual(
                self.wait_css('#app div:nth-child(2) .card-pf-aggregate-status-count').text,
                '0')
        # if operations is set true, do some VM operations
        else:
            vm_name = vm_args['name']
            log_file = vm_args['logfile']

            # After re-login, extend the vm-row is needed
            self.click(self.wait_css(
                "tbody tr[data-row-id='vm-{}'] th".format(vm_name),
                cond=clickable))

            self.check_vm_info(vm_name)
            self.check_vm_pause_and_resume(vm_name)
            self.check_vm_reboot(vm_name, log_file)
            self.check_vm_force_reboot(vm_name, log_file)
            self.check_send_NMI_to_vm(vm_name, log_file)
            self.check_vm_off(vm_name, log_file)
            self.check_vm_run(vm_name)
            self.check_vm_force_off(vm_name)

    def check_vm_info(self, vm_name):
        self.wait_css('#vm-{}-row'.format(vm_name))

        self.wait_css('#vm-{}-memory-count'.format(vm_name), cond=text_in, text_='64 MiB')
        self.wait_css('#vm-{}-vcpus-count'.format(vm_name), cond=text_in, text_='1')
        self.wait_css('#vm-{}-cpu-model'.format(vm_name), cond=text_in, text_='custom')
        self.wait_css('#vm-{}-emulated-machine'.format(vm_name), cond=text_in, text_='pc')
        self.wait_css('#vm-{}-boot-order'.format(vm_name), cond=text_in, text_='disk,network')

    def check_vm_pause_and_resume(self, vm_name):
        self.wait_css('#vm-{}-row'.format(vm_name))

        self.click(self.wait_css('#vm-{}-pause'.format(vm_name), cond=clickable))
        self.wait_css('#vm-{}-pause'.format(vm_name), cond=invisible)
        self.assertEqual(self.wait_css('#vm-{}-state'.format(vm_name)).text, 'paused')

        self.click(self.wait_css('#vm-{}-resume'.format(vm_name), cond=clickable))
        self.wait_css('#vm-{}-resume'.format(vm_name), cond=invisible)
        self.assertEqual(self.wait_css('#vm-{}-state'.format(vm_name)).text, 'running')

    def check_vm_reboot(self, vm_name, log_file):
        self.wait_css('#vm-{}-row'.format(vm_name))

        wait(lambda: 'cirros login:' in self.machine.execute(
            "sudo tail -n 1 {}".format(log_file)) or re.search(
            'cirros login:.*NMI received',
            self.machine.execute("sudo tail -n 3 {}".format(log_file))), delay=5)

        self.click(self.wait_css('#vm-{}-reboot'.format(vm_name), cond=clickable))
        wait(lambda: "reboot: Power down" in self.machine.execute("sudo cat {}".format(log_file)))

    def check_vm_force_reboot(self, vm_name, log_file):
        self.wait_css('#vm-{}-row'.format(vm_name))

        self.machine.execute('sudo sh -c "echo > {}"'.format(log_file))

        self.click(self.wait_css('#vm-{}-reboot-caret'.format(vm_name), cond=clickable))
        self.click(self.wait_css('#vm-{}-forceReboot'.format(vm_name), cond=clickable))
        wait(lambda: 'Initializing cgroup subsys cpuset' in self.machine.execute('sudo cat {}'.format(log_file)))

    def check_vm_force_off(self, vm_name):
        self.wait_css('#vm-{}-row'.format(vm_name))

        self.click(self.wait_css('#vm-{}-off-caret'.format(vm_name), cond=clickable))
        self.click(self.wait_css('#vm-{}-forceOff'.format(vm_name), cond=clickable))
        self.wait_css('#vm-{}-off'.format(vm_name), cond=invisible)
        self.wait_css('#vm-{}-run'.format(vm_name))

    def check_send_NMI_to_vm(self, vm_name, log_file):
        self.wait_css('#vm-{}-row'.format(vm_name))

        wait(lambda: 'cirros login:' in self.machine.execute(
            "sudo tail -n 1 {}".format(log_file)) or re.search(
            'cirros login:.*NMI received',
            self.machine.execute("sudo tail -n 3 {}".format(log_file))))

        self.click(self.wait_css('#vm-{}-off-caret'.format(vm_name), cond=clickable))
        self.click(self.wait_css('#vm-{}-sendNMI'.format(vm_name), cond=clickable))
        wait(lambda: "NMI received" in self.machine.execute("sudo cat {}".format(log_file)))

    def check_vm_off(self, vm_name, log_file):
        self.wait_css('#vm-{}-row'.format(vm_name))

        wait(lambda: 'cirros login:' in self.machine.execute(
            "sudo tail -n 1 {}".format(log_file)) or re.search(
            'cirros login:.*NMI received',
            self.machine.execute("sudo tail -n 3 {}".format(log_file))))

        self.click(self.wait_css('#vm-{}-off'.format(vm_name), cond=clickable))
        self.wait_css('#vm-{}-off'.format(vm_name), cond=invisible)
        self.wait_css('#vm-{}-run'.format(vm_name))

    def check_vm_run(self, vm_name):
        self.wait_css('#vm-{}-row'.format(vm_name))

        self.click(self.wait_css('#vm-{}-run'.format(vm_name), cond=clickable))
        self.wait_css('#vm-{}-run'.format(vm_name), cond=invisible)
        self.wait_css('#vm-{}-off'.format(vm_name))

    def prepare_disk(self, pool_name):
        pool_a = pool_name + '_' + MachinesLib.random_string()
        pool_b = pool_name + '_' + MachinesLib.random_string()

        pool = {pool_a: [], pool_b: []}
        pool[pool_a].append(pool_a + '_disk1')
        pool[pool_a].append(pool_a + '_disk2')
        pool[pool_b].append(pool_b + '_disk1')
        pool[pool_b].append(pool_b + '_disk2')

        self.machine.execute('sudo mkdir /home/{}'.format(pool_a))
        self.machine.execute('sudo setfacl -m u:qemu:rx /home/{}'.format(pool_a))
        self.machine.execute('sudo virsh pool-create-as {} --type dir --target /home/{}'.format(pool_a, pool_a))
        self.machine.execute('sudo mkdir /home/{}'.format(pool_b))
        self.machine.execute('sudo setfacl -m u:qemu:rx /home/{}'.format(pool_b))
        self.machine.execute('sudo virsh pool-create-as {} --type dir --target /home/{}'.format(pool_b, pool_b))

        self.machine.execute('sudo virsh vol-create-as {} {} --capacity 1G --format qcow2'.format(pool_a, pool[pool_a][0]))
        self.machine.execute('sudo virsh vol-create-as {} {} --capacity 1G --format qcow2'.format(pool_a, pool[pool_a][1]))
        self.machine.execute('sudo virsh vol-create-as {} {} --capacity 1G --format qcow2'.format(pool_b, pool[pool_b][0]))
        self.machine.execute('sudo virsh vol-create-as {} {} --capacity 1G --format qcow2'.format(pool_b, pool[pool_b][1]))

        return pool, pool_a, pool_b

    def get_pdd_format_list(self):
        self.click(self.wait_css('#card-pf-storage-pools > h2 > button',
                                 cond=clickable))
        self.wait_css('#storage-pools-listing')
        self.click(self.wait_css('#create-storage-pool', cond=clickable))
        self.select_by_value(self.wait_css('#storage-pool-dialog-type'), 'disk')
        option_list = self.wait_css('#storage-pool-dialog-source-format').find_elements_by_tag_name('option')

        parts = []
        for option in option_list:
            parts.append(option.text)

        return parts

    @staticmethod
    def random_string(length=5):
        if length <= 0:
            raise Exception('The length should be greater than 0')
        return secrets.token_hex(length)

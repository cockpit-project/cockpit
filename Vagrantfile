# vi: set ft=ruby :
#
# See HACKING.md for how to use this Vagrantfile.
#

Vagrant.configure(2) do |config|

    config.vm.box = "fedora-23-cloud-base"
    config.vm.synced_folder ".", "/vagrant", disabled: true
    config.vm.synced_folder ".", "/cockpit", type: "rsync", rsync__exclude: ['/src/', '/test/', '/node_modules/', '/doc/', '/examples/', '/containers/', '/build/', '/x86_64/' ]
    config.vm.network "private_network", ip: "192.168.50.10"
    config.vm.network "forwarded_port", guest: 9090, host: 9090
    config.vm.hostname = "cockpit-devel"
    config.vm.post_up_message = "You can now access Cockpit at http://localhost:9090 (login as 'admin' with password 'foobar')"

    config.vm.provider "libvirt" do |libvirt, override|
        override.vm.box_url = "https://download.fedoraproject.org/pub/fedora/linux/releases/23/Cloud/x86_64/Images/Fedora-Cloud-Base-Vagrant-23-20151030.x86_64.vagrant-libvirt.box"
        libvirt.memory = 1024
    end

    config.vm.provider "virtualbox" do |virtualbox, override|
        override.vm.box_url = "https://download.fedoraproject.org/pub/fedora/linux/releases/23/Cloud/x86_64/Images/Fedora-Cloud-Base-Vagrant-23-20151030.x86_64.vagrant-virtualbox.box"
        virtualbox.memory = 1024
    end

    config.vm.provision "shell", inline: <<-SHELL
        set -eu

        echo foobar | passwd --stdin root
        getent passwd admin >/dev/null || useradd -u 1000 -c Administrator -G wheel admin
        echo foobar | passwd --stdin admin

        usermod -a -G wheel vagrant
        chfn -f Vagrant vagrant

        mkdir -p /root/.local/share /home/admin/.local/share /usr/local/share
        ln -snf /cockpit/pkg /usr/local/share/cockpit
        ln -snf /cockpit/pkg /root/.local/share/cockpit
        ln -snf /cockpit/pkg /home/admin/.local/share/cockpit

        dnf copr enable -y @cockpit/cockpit-preview
        dnf install -y docker kubernetes atomic subscription-manager etcd pcp realmd \
		NetworkManager storaged storaged-lvm2 git yum-utils tuned
        dnf install -y cockpit-*
        debuginfo-install -y cockpit cockpit-pcp

        systemctl enable cockpit.socket
        systemctl start cockpit.socket

        mkdir -p /etc/systemd/system/cockpit.service.d
        printf "[Service]\nExecStartPre=/cockpit/tools/git-version-check\n" > \
            /etc/systemd/system/cockpit.service.d/version.conf

        printf "[WebService]\nAllowUnencrypted=true\n" > /etc/cockpit/cockpit.conf

        systemctl daemon-reload
    SHELL
end

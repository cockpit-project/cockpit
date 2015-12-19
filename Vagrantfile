# vi: set ft=ruby :

Vagrant.configure(2) do |config|

    config.vm.box = "rarguello/fedora-22"
    config.vm.synced_folder ".", "/vagrant", disabled: true
    config.vm.synced_folder ".", "/cockpit", type: "nfs", nfs_udp: false
    config.vm.network "forwarded_port", guest: 9090, host: 9090
    config.vm.hostname = "cockpit-devel"

    config.vm.provider "libvirt" do |libvirt, override|
        libvirt.memory = 1024
    end

    config.vm.provision "shell", inline: <<-SHELL
        set -eu

        echo foobar | passwd --stdin root
        getent passwd admin >/dev/null || useradd -u 1000 -c Administrator -G wheel admin
        echo foobar | passwd --stdin admin

        mkdir -p /root/.local/share /home/admin/.local/share /usr/local/share
        ln -snf /cockpit/pkg /usr/local/share/cockpit
        ln -snf /cockpit/pkg /root/.local/share/cockpit
        ln -snf /cockpit/pkg /home/admin/.local/share/cockpit

        dnf copr enable -y @cockpit/cockpit-preview
        dnf update -y docker
        dnf install -y kubernetes atomic subscription-manager etcd pcp realmd NetworkManager \
                storaged storaged-lvm2 git yum-utils
        dnf install -y cockpit cockpit-pcp
	debuginfo-install -y cockpit cockpit-pcp

        systemctl enable cockpit.socket
        systemctl start cockpit.socket

	mkdir -p /etc/systemd/system/cockpit.service.d
	printf "[Service]\nExecStartPre=/cockpit/tools/git-version-check\n" > \
		/etc/systemd/system/cockpit.service.d/version.conf

	systemctl daemon-reload
    SHELL
end

FROM fedora:28

ARG VERSION
ARG INSTALLER
ARG OFFLINE

ADD . /container

RUN echo -e '[group_cockpit-cockpit-preview]\nname=Copr repo for cockpit-preview owned by @cockpit\nbaseurl=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/fedora-$releasever-$basearch/\ntype=rpm-md\ngpgcheck=1\ngpgkey=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/pubkey.gpg\nrepo_gpgcheck=0\nenabled=1\nenabled_metadata=1' > /etc/yum.repos.d/cockpit.repo


RUN /container/install.sh

CMD ["/container/run.sh"]

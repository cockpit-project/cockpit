FROM fedora:28
LABEL maintainer="cockpit-devel@lists.fedorahosted.org"

ARG VERSION

ADD . /container

RUN echo -e '[group_cockpit-cockpit-preview]\nname=Copr repo for cockpit-preview owned by @cockpit\nbaseurl=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/fedora-$releasever-$basearch/\ntype=rpm-md\ngpgcheck=1\ngpgkey=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/pubkey.gpg\nrepo_gpgcheck=0\nenabled=1\nenabled_metadata=1' > /etc/yum.repos.d/cockpit.repo

# Again see above ... we do our branching in shell script
RUN /container/install-package.sh && /container/prep-container.sh

LABEL INSTALL="/usr/bin/docker run --rm --privileged -v /:/host IMAGE /container/atomic-install"
LABEL UNINSTALL="/usr/bin/docker run --rm --privileged -v /:/host IMAGE /container/atomic-uninstall"
LABEL RUN="/usr/bin/docker run -d --privileged --pid=host -v /:/host IMAGE /container/atomic-run --local-ssh"

# Look ma, no EXPOSE

CMD ["/container/atomic-run"]

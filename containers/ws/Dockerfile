FROM fedora:24
MAINTAINER "Stef Walter" <stefw@redhat.com>

ARG RELEASE
ARG VERSION
ARG COCKPIT_RPM_URL=https://kojipkgs.fedoraproject.org/packages/cockpit

ADD . /container

# Again see above ... we do our branching in shell script
RUN /container/install-package.sh

# Make the container think it's the host OS version
RUN rm -f /etc/os-release /usr/lib/os-release && ln -sv /host/etc/os-release /etc/os-release && ln -sv /host/usr/lib/os-release /usr/lib/os-release

LABEL INSTALL /usr/bin/docker run -ti --rm --privileged -v /:/host IMAGE /container/atomic-install
LABEL UNINSTALL /usr/bin/docker run -ti --rm --privileged -v /:/host IMAGE /container/atomic-uninstall
LABEL RUN /usr/bin/docker run -d --privileged --pid=host -v /:/host IMAGE /container/atomic-run --local-ssh

# Look ma, no EXPOSE

CMD ["/container/atomic-run"]

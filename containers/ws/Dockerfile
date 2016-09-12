FROM fedora:24
MAINTAINER "Stef Walter" <stefw@redhat.com>

RUN dnf -y update
RUN dnf install sed

ARG RELEASE
ARG VERSION

# If there are rpm files in the current directory we'll install those,
# otherwise use cockpit-preview repo. The Dockerfile is a hack around
# Dockerfile lack of support for branches
ADD rpms/*.rpm /tmp/

# Again see above ... we do our branching in shell script
RUN cd /tmp && ( ls *.rpm > /dev/null 2> /dev/null && dnf -y install cockpit-ws*.rpm || dnf -y install sed https://kojipkgs.fedoraproject.org/packages/cockpit/$VERSION/$RELEASE.fc23/x86_64/cockpit-ws-$VERSION-$RELEASE.fc24.x86_64.rpm ) && dnf clean all

# And the stuff that starts the container
RUN mkdir -p /container && ln -s /host/proc/1 /container/target-namespace
ADD atomic-install /container/atomic-install
ADD atomic-uninstall /container/atomic-uninstall
ADD atomic-run /container/atomic-run
RUN chmod -v +x /container/atomic-install
RUN chmod -v +x /container/atomic-uninstall
RUN chmod -v +x /container/atomic-run

# Make the container think it's the host OS version
RUN rm -f /etc/os-release /usr/lib/os-release && ln -sv /host/etc/os-release /etc/os-release && ln -sv /host/usr/lib/os-release /usr/lib/os-release

LABEL INSTALL /usr/bin/docker run -ti --rm --privileged -v /:/host IMAGE /container/atomic-install
LABEL UNINSTALL /usr/bin/docker run -ti --rm --privileged -v /:/host IMAGE /container/atomic-uninstall
LABEL RUN /usr/bin/docker run -d --privileged --pid=host -v /:/host IMAGE /container/atomic-run --local-ssh

# Look ma, no EXPOSE

CMD ["/container/atomic-run"]

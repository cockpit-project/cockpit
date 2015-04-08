FROM fedora:21
MAINTAINER "Stef Walter" <stefw@redhat.com>

RUN yum -y update && yum install -y sed && yum clean all

# A repo where we can find recent Cockpit builds for Fedora
ADD cockpit-preview.repo /etc/yum.repos.d/

# If there are rpm files in the current directory we'll install those,
# otherwise use cockpit-preview repo. The Dockerfile is a hack around
# Dockerfile lack of support for branches
ADD cockpit-ws-*.rpm Dockerfile /tmp/

# Again see above ... we do our branching in shell script
RUN cd /tmp && \
  ( ls *.rpm > /dev/null 2> /dev/null && yum -y install *.rpm || \
        yum -y --enablerepo=cockpit-preview install cockpit-ws ) && \
  yum clean all && rm -f /tmp/*.rpm

# And the stuff that starts the container
RUN mkdir -p /container && ln -s /host/proc/1 /container/target-namespace
ADD atomic-* /container/
RUN chmod -v +x /container/atomic-*

LABEL INSTALL /usr/bin/docker run -ti --rm --privileged -v /:/host IMAGE /container/atomic-install
LABEL UNINSTALL /usr/bin/docker run -ti --rm --privileged -v /:/host IMAGE /cockpit/atomic-uninstall
LABEL RUN /usr/bin/docker run -d --privileged --pid=host -v /:/host IMAGE /container/atomic-run --local-ssh

# Look ma, no EXPOSE

CMD ["/container/atomic-run"]

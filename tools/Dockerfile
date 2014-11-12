FROM fedora:21
MAINTAINER "Stef Walter" <stefw@redhat.com>

RUN yum -y update && yum clean all

# A repo where we can find recent Cockpit builds for F21
ADD cockpit-preview.repo /etc/yum.repos.d/

# If there are rpm files in the current directory we'll install those,
# otherwise use cockpit-preview repo. The Dockerfile is a hack around
# Dockerfile lack of support for branches
ADD *.rpm Dockerfile /tmp/

# Again see above ... we do our branching in shell script
RUN cd /tmp && ( ls *.rpm > /dev/null 2> /dev/null && yum -y install cockpit*.rpm || yum -y --enablerepo=cockpit-preview install cockpit ) && yum clean all && rm -f /tmp/cockpit*.rpm

# And the stuff that starts the container
RUN mkdir -p /container
ADD cockpit-container-bridge /container/cockpit-bridge
ADD cockpit-container-daemon /container/cockpitd
ADD cockpit-container-run /container/cockpit-run

# Look ma, no EXPOSE

CMD ["/container/cockpit-run"]

FROM fedora:21
MAINTAINER "Stef Walter" <stefw@redhat.com>

RUN yum -y update && yum clean all

COPY cockpit-wip-1.fc21.x86_64.rpm cockpit-assets-wip-1.fc21.noarch.rpm cockpit-doc-wip-1.fc21.x86_64.rpm cockpit-debuginfo-wip-1.fc21.x86_64.rpm cockpit-selinux-policy-wip-1.fc21.noarch.rpm /tmp/

RUN cd /tmp && yum -y install cockpit*.rpm && yum clean all && rm /tmp/cockpit*.rpm && mkdir -p /container

ADD cockpit-container-bridge /container/cockpit-bridge
ADD cockpit-container-daemon /container/cockpitd
ADD cockpit-container-run /container/cockpit-run

CMD ["/container/cockpit-run"]

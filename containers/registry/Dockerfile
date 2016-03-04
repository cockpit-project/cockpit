FROM fedora:23

ARG RELEASE=1
ARG VERSION=0.96
ARG COCKPIT_RPM_URL
ARG INSTALLER
ARG OFFLINE

ADD . /container
RUN /container/install.sh

CMD ["/usr/libexec/cockpit-kube-launch"]

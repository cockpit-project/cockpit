FROM fedora:24

ARG RELEASE
ARG VERSION
ARG COCKPIT_RPM_URL
ARG INSTALLER
ARG OFFLINE
ARG USE_REPO

ADD . /container
RUN /container/install.sh

CMD ["/usr/libexec/cockpit-kube-launch"]

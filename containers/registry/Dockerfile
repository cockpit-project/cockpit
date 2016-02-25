FROM cockpit/base

ARG RELEASE
ARG VERSION
ARG COCKPIT_RPM_URL
ARG INSTALLER

ADD . /container
RUN /container/install.sh

CMD ["/usr/libexec/cockpit-kube-launch"]

FROM cockpit/base

ENV VERSION 0.90
ENV RELEASE 1

ADD . /container
RUN /container/install.sh

CMD ["/container/cockpit-kube-launch"]

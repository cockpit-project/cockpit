FROM registry.fedoraproject.org/fedora:40 AS builder
LABEL maintainer="cockpit-devel@lists.fedorahosted.org"
LABEL VERSION=main

ARG VERSION
ADD . /container

RUN /container/install.sh

FROM scratch
COPY --from=builder /build /

ADD . /container

LABEL INSTALL="docker run --rm --privileged -v /:/host -e IMAGE=\${IMAGE} \${IMAGE} /container/label-install \${IMAGE}"
LABEL UNINSTALL="docker run --rm --privileged -v /:/host -e IMAGE=\${IMAGE} \${IMAGE} /container/label-uninstall"
LABEL RUN="docker run -d --name \${NAME} --privileged --pid=host -v /:/host -e NAME=\${NAME} -e IMAGE=\${IMAGE} \${IMAGE} /container/label-run"

CMD ["/container/label-run"]

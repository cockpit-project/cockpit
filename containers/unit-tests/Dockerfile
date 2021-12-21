ARG debian_arch=amd64
FROM docker.io/${debian_arch}/debian:testing

ARG personality=linux64
ENV personality=${personality}

COPY setup.sh /
RUN ${personality} /setup.sh ${personality} && rm -rf /setup.sh

# 'builder' user created in setup.sh
USER builder
WORKDIR /home/builder

ENV LANG=C.UTF-8

VOLUME /source

COPY entrypoint /
ENTRYPOINT ["/entrypoint"]

# for filtering from our 'exec' script
LABEL org.cockpit-project.container=unit-tests

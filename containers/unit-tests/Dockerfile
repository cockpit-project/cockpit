ARG debian_arch=amd64
FROM ${debian_arch}/debian:stable

ARG personality=linux64
COPY setup.sh /
RUN ${personality} /setup.sh ${personality} && rm -rf /setup.sh

# HACK: Working around Node.js screwing around with stdio
ENV NODE_PATH /usr/bin/node
COPY turd-polish /usr/local/bin/node

# 'builder' user created in setup.sh
USER builder
ENV LANG=C.UTF-8

VOLUME /source
ENTRYPOINT ["/entrypoint"]
CMD ["/source/containers/unit-tests/run.sh"]

# for filtering from our 'exec' script
LABEL org.cockpit-project.container=unit-tests

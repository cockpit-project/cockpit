FROM ubuntu:16.04

ARG arch=amd64

# dependencies which must be installed for the target architecture
# we must do cross-builds on i386 as phantomjs is not available for i386
ARG _crossdeps="libglib2.0-dev libgudev-1.0-dev libjson-glib-dev libkeyutils-dev liblvm2-dev libnm-glib-dev \
    libpam0g-dev libpcp3-dev libpcp-import1-dev libpcp-pmda3-dev libpolkit-agent-1-dev libpolkit-gobject-1-dev \
    libssh-dev libsystemd-dev libkrb5-dev libgnutls28-dev \
    glib-networking glib-networking-dbg libc6-dbg libglib2.0-0-dbg pkg-config"

# HACK: Avoid libssh security update, it breaks keyboard-interactive (https://bugs.debian.org/913870)
RUN dpkg --add-architecture ${arch} && echo ${arch} > /arch && apt-get update && \
    apt-get install -y --no-install-recommends build-essential gcc-multilib clang python3 \
      autoconf automake gdb gtk-doc-tools intltool libjavascript-minifier-xs-perl libjson-perl valgrind \
      xmlto xsltproc npm nodejs-legacy git libfontconfig1 dbus ssh curl chromium-browser appstream-util \
      $(for p in ${_crossdeps}; do echo $p:${arch}; done) && \
    apt-get install -y --allow-downgrades libssh-dev:${arch}=0.6.3-4.3 libssh-4:${arch}=0.6.3-4.3 && \
    echo 'deb http://archive.ubuntu.com/ubuntu bionic universe' > /etc/apt/sources.list.d/stable.list && \
    apt-get update && \
    apt-get install -y pyflakes pyflakes3 python3-pep8 && \
    apt-get clean

# use latest npm/node
# add system user to avoid same UIDs as host's source volume
RUN npm install -g n && n stable && \
    adduser --system --gecos "Builder" builder

# HACK: Working around Node.js screwing around with stdio
ENV NODE_PATH /usr/local/bin/nodejs
RUN mv /usr/local/bin/node /usr/local/bin/nodejs
ADD turd-polish /usr/local/bin/node

USER builder
ENV LANG=C.UTF-8

VOLUME /source
CMD ["/source/containers/unit-tests/run.sh"]

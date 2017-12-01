FROM ubuntu:16.04

ARG arch=amd64

# dependencies which must be installed for the target architecture
# we must do cross-builds on i386 as phantomjs is not available for i386
ARG _crossdeps="libglib2.0-dev libgudev-1.0-dev libjson-glib-dev libkeyutils-dev liblvm2-dev libnm-glib-dev \
    libpam0g-dev libpcp3-dev libpcp-import1-dev libpcp-pmda3-dev libpolkit-agent-1-dev libpolkit-gobject-1-dev \
    libssh-dev libsystemd-dev libkrb5-dev \
    glib-networking glib-networking-dbg libc6-dbg libglib2.0-0-dbg pkg-config"

RUN dpkg --add-architecture ${arch} && echo ${arch} > /arch && apt-get update && \
    apt-get install -y --no-install-recommends build-essential gcc-multilib clang python3 \
      autoconf automake gdb gtk-doc-tools intltool libjavascript-minifier-xs-perl libjson-perl valgrind \
      xmlto xsltproc pyflakes npm nodejs-legacy git libfontconfig1 dbus ssh curl \
      $(for p in ${_crossdeps}; do echo $p:${arch}; done) && \
    apt-get clean

# use latest npm/node
# add system user to avoid same UIDs as host's source volume
RUN npm install -g n && n stable && \
    adduser --system --gecos "Builder" builder

USER builder
ADD run.sh /
CMD ["/run.sh"]

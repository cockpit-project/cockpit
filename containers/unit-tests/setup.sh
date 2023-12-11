#!/bin/sh -ex

dependencies="\
    appstream-util \
    autoconf \
    automake \
    build-essential \
    clang \
    curl \
    dbus \
    firefox-esr \
    flake8 \
    gcc-multilib \
    gdb \
    git \
    glib-networking \
    glib-networking-dbgsym\
    gtk-doc-tools \
    gettext \
    libc6-dbg \
    libfontconfig1 \
    libglib2.0-0-dbgsym \
    libglib2.0-dev \
    libgnutls28-dev \
    libjavascript-minifier-xs-perl \
    libjson-glib-dev \
    libjson-perl \
    libkrb5-dev \
    libpam0g-dev \
    libpcp-import1-dev \
    libpcp-pmda3-dev \
    libpcp3-dev \
    libpolkit-agent-1-dev \
    libpolkit-gobject-1-dev \
    libssh-4-dbgsym \
    libssh-dev \
    libsystemd-dev \
    mypy \
    npm \
    nodejs \
    pkg-config \
    python3 \
    python3-mypy \
    python3-pip \
    python3-pytest-asyncio \
    python3-pytest-cov \
    python3-pytest-timeout \
    ssh \
    strace \
    valgrind \
    vulture \
    xmlto \
    xsltproc \
"

echo "deb http://deb.debian.org/debian-debug/ testing-debug main" > /etc/apt/sources.list.d/ddebs.list
echo "deb http://deb.debian.org/debian-debug/ testing-proposed-updates-debug main" >> /etc/apt/sources.list.d/ddebs.list
apt-get update
apt-get install -y --no-install-recommends eatmydata
DEBIAN_FRONTEND=noninteractive eatmydata apt-get install -y --no-install-recommends ${dependencies}

# https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1057968
echo "deb http://deb.debian.org/debian unstable main" > /etc/apt/sources.list.d/unstable.list
apt-get update
apt-get install -y --no-install-recommends python3-flake8
rm /etc/apt/sources.list.d/unstable.list

adduser --gecos "Builder" builder

if [ "$(uname -m)" = "x86_64" ] ; then
    # See https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1030835
    pip install --break-system-packages ruff
fi

# minimize image
# useful command: dpkg-query --show -f '${package} ${installed-size}\n' | sort -k2n
dpkg -P --force-depends libgl1-mesa-dri libglx-mesa0 perl

rm -rf /var/cache/apt /var/lib/apt /var/log/* /usr/share/doc/ /usr/share/man/ /usr/share/help /usr/share/info

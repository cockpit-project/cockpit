#
# This file is maintained at the following location:
# https://github.com/cockpit-project/cockpit/blob/master/tools/cockpit.spec
#
# If you are editing this file in another location, changes will likely
# be clobbered the next time an automated release is done.
#
# Check first cockpit-devel@lists.fedorahosted.org
#
# Globals that may be defined elsewhere
#  * Version 122
#  * wip 1
#

# earliest base that the subpackages work on
%define required_base 122

%if 0%{?centos}
%define rhel 0
%endif

%define _hardened_build 1

%define libssh_version 0.7.1
%if 0%{?fedora} > 0 && 0%{?fedora} < 22
%define libssh_version 0.6.0
%endif

Name:           cockpit
Summary:        A user interface for Linux servers

License:        LGPLv2+
URL:            http://cockpit-project.org/

Version:        0
%if %{defined wip}
Release:        1.%{wip}%{?dist}
Source0:        cockpit-%{version}.tar.gz
%else
Release:        1%{?dist}
Source0:        https://github.com/cockpit-project/cockpit/releases/download/%{version}/cockpit-%{version}.tar.xz
%endif

BuildRequires: pkgconfig(gio-unix-2.0)
BuildRequires: pkgconfig(json-glib-1.0)
BuildRequires: pkgconfig(polkit-agent-1) >= 0.105
BuildRequires: pam-devel

BuildRequires: autoconf automake
BuildRequires: intltool
BuildRequires: libssh-devel >= %{libssh_version}
BuildRequires: openssl-devel
BuildRequires: zlib-devel
BuildRequires: krb5-devel
BuildRequires: libxslt-devel
BuildRequires: docbook-style-xsl
BuildRequires: keyutils-libs-devel
BuildRequires: glib-networking
BuildRequires: sed
BuildRequires: git

BuildRequires: glib2-devel >= 2.37.4
BuildRequires: systemd-devel
BuildRequires: polkit
BuildRequires: pcp-libs-devel
BuildRequires: krb5-server
BuildRequires: gdb

# For documentation
BuildRequires: xmlto

# This is the "cockpit" metapackage. It should only
# Require, Suggest or Recommend other cockpit-xxx subpackages

Requires: %{name}-bridge = %{version}-%{release}
Requires: %{name}-ws = %{version}-%{release}
Requires: %{name}-shell = %{version}-%{release}

# Optional components (for f24 we use soft deps)
%if 0%{?fedora} >= 24 || 0%{?rhel} >= 8
Recommends: %{name}-networkmanager = %{version}-%{release}
Recommends: %{name}-storaged = %{version}-%{release}
%ifarch x86_64 %{arm} aarch64 ppc64le
Recommends: %{name}-docker = %{version}-%{release}
%endif
Suggests: %{name}-pcp = %{version}-%{release}
Suggests: %{name}-kubernetes = %{version}-%{release}
Suggests: %{name}-selinux = %{version}-%{release}

# Older releases need to have strict requirements
%else
Requires: %{name}-networkmanager = %{version}-%{release}
Requires: %{name}-storaged = %{version}-%{release}
%ifarch x86_64 armv7hl
Requires: %{name}-docker = %{version}-%{release}
%endif

%endif


%description
Cockpit runs in a browser and can manage your network of GNU/Linux
machines.

%package bridge
Summary: Cockpit bridge server-side component
Obsoletes: %{name}-daemon < 0.48-2
Requires: polkit

%description bridge
The Cockpit bridge component installed server side and runs commands on the
system on behalf of the web based user interface.

%package doc
Summary: Cockpit deployment and developer guide

%description doc
The Cockpit Deployment and Developer Guide shows sysadmins how to
deploy Cockpit on their machines as well as helps developers who want to
embed or extend Cockpit.

%package pcp
Summary: Cockpit PCP integration
Requires: %{name}-bridge = %{version}-%{release}
Requires: pcp

%description pcp
Cockpit support for reading PCP metrics and loading PCP archives.

%package ws
Summary: Cockpit Web Service
Requires: glib-networking
Requires: openssl
Requires: glib2 >= 2.37.4
Requires: libssh >= %{libssh_version}
Obsoletes: cockpit-selinux-policy <= 0.83
Requires(post): systemd
Requires(preun): systemd
Requires(postun): systemd

%description ws
The Cockpit Web Service listens on the network, and authenticates users.

%prep
%setup -q

# Apply patches using git
git init
git config user.email "unused@example.com" && git config user.name "Unused"
git config core.autocrlf false && git config core.safecrlf false && git config gc.auto 0
git add -f . && git commit -a -q -m "Base"
echo "" | git am --whitespace=nowarn %{patches}
rm -rf .git

%build
exec 2>&1
%configure --disable-silent-rules --with-cockpit-user=cockpit-ws --with-branding=auto --with-selinux-config-type=etc_t %{?rhel:--without-storaged-iscsi-sessions}
make -j4 %{?extra_flags} all

%check
exec 2>&1
make -j4 check

%install
make install DESTDIR=%{buildroot}
%if %{defined wip} || 0%{?rhel}
make install-test-assets DESTDIR=%{buildroot}
%else
rm -rf %{buildroot}/%{_datadir}/%{name}/playground
%endif
mkdir -p $RPM_BUILD_ROOT%{_sysconfdir}/pam.d
install -p -m 644 tools/cockpit.pam $RPM_BUILD_ROOT%{_sysconfdir}/pam.d/cockpit
rm -f %{buildroot}/%{_libdir}/cockpit/*.so
install -p -m 644 AUTHORS COPYING README.md %{buildroot}%{_docdir}/%{name}/

# On RHEL we don't yet show options for changing language
%if 0%{?rhel}
echo '{ "linguas": null, "machine-limit": 5 }' > %{buildroot}%{_datadir}/%{name}/shell/override.json
%endif

# Build the package lists for resource packages
echo '%dir %{_datadir}/%{name}/base1' > base.list
find %{buildroot}%{_datadir}/%{name}/base1 -type f >> base.list

echo '%dir %{_datadir}/%{name}/dashboard' >> shell.list
find %{buildroot}%{_datadir}/%{name}/dashboard -type f >> shell.list

echo '%dir %{_datadir}/%{name}/realmd' >> shell.list
find %{buildroot}%{_datadir}/%{name}/realmd -type f >> shell.list

echo '%dir %{_datadir}/%{name}/tuned' >> shell.list
find %{buildroot}%{_datadir}/%{name}/tuned -type f >> shell.list

echo '%dir %{_datadir}/%{name}/shell' >> shell.list
find %{buildroot}%{_datadir}/%{name}/shell -type f >> shell.list

echo '%dir %{_datadir}/%{name}/systemd' >> shell.list
find %{buildroot}%{_datadir}/%{name}/systemd -type f >> shell.list

echo '%dir %{_datadir}/%{name}/users' >> shell.list
find %{buildroot}%{_datadir}/%{name}/users -type f >> shell.list

echo '%dir %{_datadir}/%{name}/sosreport' > sosreport.list
find %{buildroot}%{_datadir}/%{name}/sosreport -type f >> sosreport.list

echo '%dir %{_datadir}/%{name}/subscriptions' > subscriptions.list
find %{buildroot}%{_datadir}/%{name}/subscriptions -type f >> subscriptions.list

echo '%dir %{_datadir}/%{name}/storaged' > storaged.list
find %{buildroot}%{_datadir}/%{name}/storaged -type f >> storaged.list

echo '%dir %{_datadir}/%{name}/networkmanager' > networkmanager.list
find %{buildroot}%{_datadir}/%{name}/networkmanager -type f >> networkmanager.list

echo '%dir %{_datadir}/%{name}/ostree' > ostree.list
find %{buildroot}%{_datadir}/%{name}/ostree -type f >> ostree.list

echo '%dir %{_datadir}/%{name}/machines' > machines.list
find %{buildroot}%{_datadir}/%{name}/machines -type f >> machines.list

# on CentOS systems we don't have the required setroubleshoot-server packages
%if 0%{?centos}
rm -rf %{buildroot}%{_datadir}/%{name}/selinux
%else
echo '%dir %{_datadir}/%{name}/selinux' > selinux.list
find %{buildroot}%{_datadir}/%{name}/selinux -type f >> selinux.list
%endif

%ifarch x86_64 %{arm} aarch64 ppc64le
echo '%dir %{_datadir}/%{name}/docker' > docker.list
find %{buildroot}%{_datadir}/%{name}/docker -type f >> docker.list
%else
rm -rf %{buildroot}/%{_datadir}/%{name}/docker
touch docker.list
%endif

%ifarch x86_64 ppc64le
%if %{defined wip}
%else
rm %{buildroot}/%{_datadir}/%{name}/kubernetes/override.json
%endif
echo '%dir %{_datadir}/%{name}/kubernetes' > kubernetes.list
find %{buildroot}%{_datadir}/%{name}/kubernetes -type f >> kubernetes.list
%else
rm -rf %{buildroot}/%{_datadir}/%{name}/kubernetes
touch kubernetes.list
%endif

sed -i "s|%{buildroot}||" *.list

# Build the package lists for debug package, and move debug files to installed locations
find %{buildroot}/usr/src/debug%{_datadir}/%{name} -type f -o -type l > debug.partial
sed -i "s|%{buildroot}/usr/src/debug||" debug.partial
sed -n 's/\.map\(\.gz\)\?$/\0/p' *.list >> debug.partial
sed -i '/\.map\(\.gz\)\?$/d' *.list
tar -C %{buildroot}/usr/src/debug -cf - . | tar -C %{buildroot} -xf -
rm -rf %{buildroot}/usr/src/debug

# On RHEL subscriptions, networkmanager, selinux, and sosreport are part of the shell package
%if 0%{?rhel}
cat subscriptions.list sosreport.list networkmanager.list selinux.list >> shell.list
%endif

%find_lang %{name}

# dwz has trouble with the go binaries
# https://fedoraproject.org/wiki/PackagingDrafts/Go
%global _dwz_low_mem_die_limit 0

%define find_debug_info %{_rpmconfigdir}/find-debuginfo.sh %{?_missing_build_ids_terminate_build:--strict-build-id} %{?_include_minidebuginfo:-m} %{?_find_debuginfo_dwz_opts} %{?_find_debuginfo_opts} "%{_builddir}/%{?buildsubdir}"

# Redefine how debug info is built to slip in our extra debug files
%define __debug_install_post   \
   %{find_debug_info} \
   cat debug.partial >> %{_builddir}/%{?buildsubdir}/debugfiles.list \
%{nil}

%files
%{_docdir}/%{name}/AUTHORS
%{_docdir}/%{name}/COPYING
%{_docdir}/%{name}/README.md
%dir %{_datadir}/%{name}
%{_datadir}/appdata/cockpit.appdata.xml
%{_datadir}/applications/cockpit.desktop
%{_datadir}/pixmaps/cockpit.png
%doc %{_mandir}/man1/cockpit.1.gz

%files bridge -f base.list
%{_datadir}/%{name}/base1/bundle.min.js.gz
%doc %{_mandir}/man1/cockpit-bridge.1.gz
%{_bindir}/cockpit-bridge
%attr(4755, -, -) %{_libexecdir}/cockpit-polkit
%{_libdir}/security/pam_reauthorize.so

%files doc
%exclude %{_docdir}/%{name}/AUTHORS
%exclude %{_docdir}/%{name}/COPYING
%exclude %{_docdir}/%{name}/README.md
%{_docdir}/%{name}

%files pcp
%{_libexecdir}/cockpit-pcp
%{_localstatedir}/lib/pcp/config/pmlogconf/tools/cockpit

%post pcp
# HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1185764
# We can't use "systemctl reload-or-try-restart" since systemctl might
# be out of sync with reality.
/usr/share/pcp/lib/pmlogger condrestart

%files ws -f %{name}.lang
%doc %{_mandir}/man5/cockpit.conf.5.gz
%doc %{_mandir}/man8/cockpit-ws.8.gz
%doc %{_mandir}/man8/remotectl.8.gz
%doc %{_mandir}/man8/pam_ssh_add.8.gz
%config(noreplace) %{_sysconfdir}/%{name}
%config(noreplace) %{_sysconfdir}/pam.d/cockpit
%{_unitdir}/cockpit.service
%{_unitdir}/cockpit.socket
%{_prefix}/lib/firewalld/services/cockpit.xml
%{_sbindir}/remotectl
%{_libdir}/security/pam_ssh_add.so
%{_libexecdir}/cockpit-ws
%{_libexecdir}/cockpit-stub
%{_libexecdir}/cockpit-ssh
%attr(4750, root, cockpit-ws) %{_libexecdir}/cockpit-session
%attr(775, -, wheel) %{_localstatedir}/lib/%{name}
%{_datadir}/%{name}/static
%{_datadir}/%{name}/branding

%pre ws
getent group cockpit-ws >/dev/null || groupadd -r cockpit-ws
getent passwd cockpit-ws >/dev/null || useradd -r -g cockpit-ws -d / -s /sbin/nologin -c "User for cockpit-ws" cockpit-ws

%post ws
%systemd_post cockpit.socket
# firewalld only partially picks up changes to its services files without this
test -f %{_bindir}/firewall-cmd && firewall-cmd --reload --quiet || true
# HACK: Until policy changes make it downstream
# https://bugzilla.redhat.com/show_bug.cgi?id=1381331
test -f %{_bindir}/chcon && chcon -t cockpit_ws_exec_t %{_libexecdir}/cockpit-ssh
%preun ws
%systemd_preun cockpit.socket

%postun ws
%systemd_postun_with_restart cockpit.socket
%systemd_postun_with_restart cockpit.service

%package shell
Summary: Cockpit Shell user interface package
Requires: %{name}-bridge = %{version}-%{release}
Requires: shadow-utils
Requires: grep
Requires: libpwquality
Requires: /usr/bin/date
%if 0%{?rhel}
Provides: %{name}-subscriptions = %{version}-%{release}
Requires: subscription-manager >= 1.13
Provides: %{name}-networkmanager = %{version}-%{release}
Requires: NetworkManager
# Optional components (only when soft deps are supported)
%if 0%{?fedora} >= 24 || 0%{?rhel} >= 8
Recommends: NetworkManager-team
%endif
%endif
Provides: %{name}-assets
Obsoletes: %{name}-assets < 0.32
BuildArch: noarch

%description shell
This package contains the Cockpit shell UI assets.

%files shell -f shell.list

%package storaged
Summary: Cockpit user interface for storage, using Storaged
# Lock bridge dependency due to --with-storaged-iscsi-sessions
# which uses new less stable /manifests.js request path.
%if 0%{?rhel}
Requires: %{name}-bridge >= %{version}-%{release}
%endif
Requires: %{name}-shell >= %{required_base}
Requires: storaged >= 2.1.1
%if 0%{?fedora} >= 24 || 0%{?rhel} >= 8
Recommends: storaged-lvm2 >= 2.1.1
Recommends: storaged-iscsi >= 2.1.1
Recommends: device-mapper-multipath
%else
Requires: storaged-lvm2 >= 2.1.1
Requires: storaged-iscsi >= 2.1.1
Requires: device-mapper-multipath
%endif
BuildArch: noarch

%description storaged
The Cockpit component for managing storage.  This package uses Storaged.

%files storaged -f storaged.list

%package ostree
Summary: Cockpit user interface for rpm-ostree
# Requires: Uses new translations functionality
Requires: %{name}-bridge > 124
Requires: %{name}-shell > 124
%if 0%{?fedora} > 0 && 0%{?fedora} < 24
Requires: rpm-ostree >= 2015.10-1
%else
Requires: /usr/libexec/rpm-ostreed
%endif

%description ostree
The Cockpit components for managing software updates for ostree based systems.

%files ostree -f ostree.list

%package machines
Summary: Cockpit user interface for virtual machines
Requires: %{name}-bridge >= %{required_base}
Requires: %{name}-shell >= %{required_base}
Requires: libvirt
Requires: libvirt-client

%description machines
The Cockpit components for managing virtual machines.

%files machines -f machines.list

# Conditionally built packages below

%if 0%{?rhel} == 0

%package sosreport
Summary: Cockpit user interface for diagnostic reports
Requires: %{name}-bridge >= %{required_base}
Requires: %{name}-shell >= %{required_base}
Requires: sos
BuildArch: noarch

%description sosreport
The Cockpit component for creating diagnostic reports with the
sosreport tool.

%files sosreport -f sosreport.list

%package subscriptions
Summary: Cockpit subscription user interface package
Requires: %{name}-bridge >= %{required_base}
Requires: %{name}-shell >= %{required_base}
Requires: subscription-manager >= 1.13
BuildArch: noarch

%description subscriptions
This package contains the Cockpit user interface integration with local
subscription management.

%files subscriptions -f subscriptions.list

%package networkmanager
Summary: Cockpit user interface for networking, using NetworkManager
Requires: %{name}-bridge >= %{required_base}
Requires: %{name}-shell >= %{required_base}
Requires: NetworkManager
# Optional components (only when soft deps are supported)
%if 0%{?fedora} >= 24 || 0%{?rhel} >= 8
Recommends: NetworkManager-team
%endif
BuildArch: noarch

%description networkmanager
The Cockpit component for managing networking.  This package uses NetworkManager.

%files networkmanager -f networkmanager.list

%endif

%if 0%{?rhel}%{?centos} == 0

%package selinux
Summary: Cockpit SELinux package
Requires: %{name}-bridge >= %{required_base}
Requires: %{name}-shell >= %{required_base}
Requires: setroubleshoot-server >= 3.3.3
BuildArch: noarch

%description selinux
This package contains the Cockpit user interface integration with the
utility setroubleshoot to diagnose and resolve SELinux issues.

%files selinux -f selinux.list

%endif

%ifarch x86_64 %{arm} aarch64 ppc64le

%package docker
Summary: Cockpit user interface for Docker containers
Requires: %{name}-bridge >= %{required_base}
Requires: %{name}-shell >= %{required_base}
Requires: docker >= 1.3.0
Requires: python

%description docker
The Cockpit components for interacting with Docker and user interface.
This package is not yet complete.

%files docker -f docker.list

%endif

%ifarch x86_64 ppc64le

%package kubernetes
Summary: Cockpit user interface for Kubernetes cluster
Requires: /usr/bin/kubectl
# Requires: Needs newer localization support
Requires: %{name}-bridge > 124
Requires: %{name}-shell > 124
BuildRequires: golang-bin
BuildRequires: golang-src

%description kubernetes
The Cockpit components for visualizing and configuring a Kubernetes
cluster. Installed on the Kubernetes master. This package is not yet complete.

%files kubernetes -f kubernetes.list
%{_libexecdir}/cockpit-kube-auth
%{_libexecdir}/cockpit-kube-launch

%endif

# we only build test assets on rhel or if we're building from a specific commit
%if %{defined wip} || 0%{?rhel}

%package test-assets
Summary: Additional stuff for testing Cockpit
Requires: %{name}-bridge >= %{required_base}
Requires: %{name}-shell >= %{required_base}
Requires: openssh-clients

%description test-assets
This package contains programs and other files for testing Cockpit, and
pulls in some necessary packages via dependencies.

%files test-assets
%{_datadir}/%{name}/playground
%{_datadir}/cockpit-test-assets

%endif

# The changelog is automatically generated and merged
%changelog

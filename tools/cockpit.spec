# Globals that might be defined elsewhere
#  * gitcommit xxxx
#  * selinux 1

%define branding default

# Our SELinux policy gets built in tests and f21 and lower
%if %{defined gitcommit}
%define extra_flags CFLAGS='-O2 -Wall -Werror -fPIC'
%define selinux 1
%endif
%if 0%{?fedora} > 0 && 0%{?fedora} <= 21
%define selinux 1
%endif
%if 0%{?fedora} > 0 && 0%{?fedora} <= 23
%define branding fedora
%endif
%if 0%{?rhel}
%define selinux 1
%endif

Name:           cockpit
%if %{defined gitcommit}
Version:        %{gitcommit}
%else
Version:        0.49
%endif
Release:        1%{?dist}
Summary:        A user interface for Linux servers

License:        LGPLv2+
URL:            http://cockpit-project.org/

%if %{defined gitcommit}
Source0:        cockpit-%{version}.tar.gz
%else
Source0:        https://github.com/cockpit-project/cockpit/releases/download/%{version}/cockpit-%{version}.tar.bz2
%endif
Source1:        cockpit.pam

BuildRequires: pkgconfig(gio-unix-2.0)
BuildRequires: pkgconfig(json-glib-1.0)
BuildRequires: pkgconfig(libsystemd-daemon)
BuildRequires: pkgconfig(polkit-agent-1) >= 0.105
BuildRequires: pam-devel

BuildRequires: autoconf automake
BuildRequires: intltool
BuildRequires: libssh-devel >= 0.6.0
BuildRequires: openssl-devel
BuildRequires: zlib-devel
BuildRequires: krb5-devel
BuildRequires: libxslt-devel
BuildRequires: docbook-style-xsl
BuildRequires: keyutils-libs-devel
BuildRequires: dbus-devel
BuildRequires: glib-networking
BuildRequires: sed

BuildRequires: glib2-devel >= 2.37.4
BuildRequires: systemd
BuildRequires: polkit
BuildRequires: pcp-libs-devel

%if %{defined gitcommit}
BuildRequires: npm
BuildRequires: nodejs
%endif

# For selinux
%if %{defined selinux}
BuildRequires: selinux-policy-devel
BuildRequires: checkpolicy
BuildRequires: /usr/share/selinux/devel/policyhelp
BuildRequires: sed
%endif

# For documentation
BuildRequires: xmlto

Requires: %{name}-bridge = %{version}-%{release}
Requires: %{name}-ws = %{version}-%{release}
Requires: %{name}-shell = %{version}-%{release}
%ifarch x86_64 armv7hl
Requires: %{name}-docker = %{version}-%{release}
%endif
%if 0%{?rhel} && 0%{?centos} == 0
Requires: %{name}-subscriptions = %{version}-%{release}
%endif
%if %{defined selinux}
Requires: %{name}-selinux-policy = %{version}-%{release}
%endif
Provides: %{name}-daemon
Obsoletes: %{name}-daemon < 0.48

%description
Cockpit runs in a browser and can manage your network of GNU/Linux
machines.

%package bridge
Summary: Cockpit bridge server-side component

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

%package shell
Summary: Cockpit Shell user interface package
Requires: %{name}-bridge = %{version}-%{release}
Requires: NetworkManager
Requires: shadow-utils
Requires: grep
Requires: /usr/bin/date
Requires: udisks2 >= 2.1.0
Requires: mdadm
Requires: lvm2
Requires: realmd
Requires: storaged
Provides: %{name}-assets
Obsoletes: %{name}-assets < 0.32
BuildArch: noarch

%description shell
This package contains the Cockpit shell UI assets.

%package subscriptions
Summary: Cockpit subscription user interface package
Requires: subscription-manager >= 1.13
BuildArch: noarch

%description subscriptions
This package contains the Cockpit user interface integration with local
subscription management.

%package ws
Summary: Cockpit Web Service
Requires: glib-networking

Requires: glib2 >= 2.37.4
Requires(post): systemd
Requires(preun): systemd
Requires(postun): systemd

%description ws
The Cockpit Web Service listens on the network, and authenticates users.

%prep
%setup -q
%if 0%{?fedora} == 20
	sed -i s/unconfined_service_t/unconfined_t/g src/ws/test-server.service.in
%endif

%build
%if %{defined gitcommit}
env NOCONFIGURE=1 ./autogen.sh
%endif
%configure --disable-static --disable-silent-rules --with-cockpit-user=cockpit-ws --with-branding=%{branding}
make -j1 %{?extra_flags} all
%if %{defined selinux}
make selinux
%endif

%check
# The check doesnt run on koji as it requires network
# make check

%install
make install DESTDIR=%{buildroot} DBGDIR=/debug
%if %{defined gitcommit}
make install-test-assets DESTDIR=%{buildroot}
mkdir -p %{buildroot}/%{_datadir}/polkit-1/rules.d
cp src/bridge/polkit-workarounds.rules %{buildroot}/%{_datadir}/polkit-1/rules.d
%else
rm -rf %{buildroot}/%{_datadir}/%{name}/playground
%endif
mkdir -p $RPM_BUILD_ROOT%{_sysconfdir}/pam.d
install -p -m 644 %{SOURCE1} $RPM_BUILD_ROOT%{_sysconfdir}/pam.d/cockpit
rm -f %{buildroot}/%{_libdir}/cockpit/*.so
install -p -m 644 AUTHORS COPYING README.md %{buildroot}%{_docdir}/%{name}/
%if %{defined selinux}
install -d %{buildroot}%{_datadir}/selinux/targeted
install -p -m 644 cockpit.pp %{buildroot}%{_datadir}/selinux/targeted/
%endif

# Build the package lists for resource packages
find %{buildroot}%{_datadir}/%{name}/base1 %{buildroot}%{_datadir}/%{name}/legacy %{buildroot}%{_datadir}/%{name}/shell %{buildroot}%{_datadir}/%{name}/system %{buildroot}%{_datadir}/%{name}/domain -type f > shell.list
find %{buildroot}%{_datadir}/%{name}/subscriptions -type f > subscriptions.list

%ifnarch x86_64 armv7hl
rm -rf %{buildroot}/%{_datadir}/%{name}/docker
%endif # x86_64 armv7hl

%ifnarch x86_64
rm -rf %{buildroot}/%{_datadir}/%{name}/kubernetes
%endif #x86_64

%ifarch x86_64 armv7hl
find %{buildroot}%{_datadir}/%{name}/docker -type f > docker.list
%ifarch x86_64
find %{buildroot}%{_datadir}/%{name}/kubernetes -type f > kubernetes.list
%endif # x86_64
%endif # x86_64 armv7hl

sed -i "s|%{buildroot}||" *.list

# Build the package lists for debug package
find %{buildroot}/debug%{_datadir}/%{name} -type f -o -type l > debug.list
sed -i "s|%{buildroot}/debug||" debug.list

# Move the debug files into place mixed in with the other files
tar -C %{buildroot}/debug -cf - . | tar -C %{buildroot} -xf -
rm -rf %{buildroot}/debug

# Redefine how debug info is built to slip in our extra debug files
%define __debug_install_post   \
   %{_rpmconfigdir}/find-debuginfo.sh %{?_missing_build_ids_terminate_build:--strict-build-id} %{?_include_minidebuginfo:-m} %{?_find_debuginfo_dwz_opts} %{?_find_debuginfo_opts} "%{_builddir}/%{?buildsubdir}" \
   cat debug.list >> %{_builddir}/%{?buildsubdir}/debugfiles.list \
%{nil}

%files
%{_docdir}/%{name}/AUTHORS
%{_docdir}/%{name}/COPYING
%{_docdir}/%{name}/README.md
%dir %{_datadir}/%{name}
%{_datadir}/appdata
%{_datadir}/applications
%{_datadir}/pixmaps

%files bridge
%doc %{_mandir}/man1/cockpit-bridge.1.gz
%{_bindir}/cockpit-bridge
%attr(4755, -, -) %{_libexecdir}/cockpit-polkit
%{_libexecdir}/cockpit-wrapper
%{_libdir}/security/pam_reauthorize.so
%{_datadir}/dbus-1/services/com.redhat.Cockpit.service

%files doc
%exclude %{_docdir}/%{name}/AUTHORS
%exclude %{_docdir}/%{name}/COPYING
%exclude %{_docdir}/%{name}/README.md
%{_docdir}/%{name}

%files pcp
%{_libexecdir}/cockpit-pcp

%post pcp
# HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1185749
( cd /var/lib/pcp/pmns && ./Rebuild -du )

%files shell -f shell.list
%dir %{_datadir}/%{name}/base1
%dir %{_datadir}/%{name}/base1/fonts
%dir %{_datadir}/%{name}/base1/images
%dir %{_datadir}/%{name}/legacy
%dir %{_datadir}/%{name}/shell
%dir %{_datadir}/%{name}/shell/images
%dir %{_datadir}/%{name}/system

%files subscriptions -f subscriptions.list
%dir %{_datadir}/%{name}/subscriptions

%files ws
%doc %{_mandir}/man5/cockpit.conf.5.gz
%doc %{_mandir}/man8/cockpit-ws.8.gz
%config(noreplace) %{_sysconfdir}/%{name}
%config(noreplace) %{_sysconfdir}/pam.d/cockpit
%{_unitdir}/cockpit.service
%{_unitdir}/cockpit.socket
%{_prefix}/lib/firewalld/services/cockpit.xml
%{_sbindir}/remotectl
%{_libexecdir}/cockpit-ws
%attr(4750, root, cockpit-ws) %{_libexecdir}/cockpit-session
%attr(775, -, wheel) %{_sharedstatedir}/%{name}
%{_datadir}/%{name}/static

%pre ws
getent group cockpit-ws >/dev/null || groupadd -r cockpit-ws
getent passwd cockpit-ws >/dev/null || useradd -r -g cockpit-ws -d / -s /sbin/nologin -c "User for cockpit-ws" cockpit-ws

%post ws
%systemd_post cockpit.socket
# firewalld only partially picks up changes to its services files without this
test -f %{_bindir}/firewall-cmd && firewall-cmd --reload --quiet || true

%preun ws
%systemd_preun cockpit.socket

%postun ws
%systemd_postun_with_restart cockpit.socket

# Conditionally built packages below

%ifarch x86_64 armv7hl

%package docker
Summary: Cockpit user interface for Docker containers
Requires: docker

%description docker
The Cockpit components for interacting with Docker and user interface.
This package is not yet complete.

%files docker -f docker.list
%dir %{_datadir}/%{name}/docker

%ifarch x86_64
%package kubernetes
Summary: Cockpit user interface for Kubernetes cluster
Requires: kubernetes

%description kubernetes
The Cockpit components for visualizing and configuring a Kubernetes
cluster. Installed on the Kubernetes master. This package is not yet complete.

%files kubernetes -f kubernetes.list
%dir %{_datadir}/%{name}/kubernetes
%endif # x86_64
%endif # x86_64 armv7hl

%if %{defined gitcommit}

%package test-assets
Summary: Additional stuff for testing Cockpit
Requires: openssh-clients

%description test-assets
This package contains programs and other files for testing Cockpit, and
pulls in some necessary packages via dependencies.

%files test-assets
%{_datadir}/%{name}/playground
%{_datadir}/cockpit-test-assets
%{_datadir}/polkit-1/rules.d
/usr/lib/systemd/system/cockpit-testing.service
/usr/lib/systemd/system/cockpit-testing.socket
/usr/lib/systemd/system/test-server.service
/usr/lib/systemd/system/test-server.socket

%endif

%if %{defined selinux}

%package selinux-policy
Summary: SELinux policy for Cockpit testing
Requires: %{name} = %{version}-%{release}
Requires: selinux-policy
Requires: selinux-policy-targeted
Requires(post): /usr/sbin/semodule, /sbin/restorecon, /sbin/fixfiles
Requires(postun): /usr/sbin/semodule, /sbin/restorecon, /sbin/fixfiles
BuildArch: noarch

%description selinux-policy
SELinux policy for Cockpit testing.

%files selinux-policy
%defattr(-,root,root,0755)
%{_datadir}/selinux/targeted/cockpit.pp

%post selinux-policy
/usr/sbin/semodule -s targeted -i %{_datadir}/selinux/targeted/cockpit.pp &> /dev/null || :
/sbin/fixfiles -R cockpit restore || :
/sbin/fixfiles -R cockpit-test-assets restore || :
/sbin/restorecon -R %{_sharedstatedir}/%{name} || :

%postun selinux-policy
if [ $1 -eq 0 ] ; then
  /usr/sbin/semodule -s targeted -r cockpit &> /dev/null || :
  /sbin/fixfiles -R cockpit-selinux-policy restore || :
  [ -d %{_sharedstatedir}/%{name} ]  && \
    /sbin/restorecon -R %{_sharedstatedir}/%{name} &> /dev/null || :
fi

%endif

%changelog
* Wed Apr 01 2015 Peter <petervo@redhat.com> - 0.49-1
- Update to 0.49 release.
- cockpitd was renamed to cockpit-wrapper the cockpit-daemon
  package was removed and is now installed with the
  cockpit-bridge package.

* Mon Mar 30 2015 Peter <petervo@redhat.com> - 0.48-1
- Update to 0.48 release

* Mon Mar 30 2015 Stephen Gallagher <sgallagh@redhat.com> 0.47-2
- Don't attempt to build cockpit-kubernetes on armv7hl

* Fri Mar 27 2015 Peter <petervo@redhat.com> - 0.47-1
- Update to 0.47 release, build docker on armvrhl

* Thu Mar 26 2015 Stef Walter <stefw@redhat.com> - 0.46-1
- Update to 0.46 release

* Mon Mar 23 2015 Stef Walter <stefw@redhat.com> - 0.45-1
- Update to 0.45 release

* Sat Mar 21 2015 Stef Walter <stefw@redhat.com> - 0.44-3
- Add back debuginfo files to the right place

* Fri Mar 20 2015 Stef Walter <stefw@redhat.com> - 0.44-2
- Disable separate debuginfo for now: build failure

* Fri Mar 20 2015 Stef Walter <stefw@redhat.com> - 0.44-1
- Update to 0.44 release

* Thu Mar 19 2015 Stef Walter <stefw@redhat.com> - 0.43-2
- Don't break EPEL or CentOS builds due to missing branding

* Wed Mar 18 2015 Stef Walter <stefw@redhat.com> - 0.43-1
- Update to 0.43 release

* Tue Mar 17 2015 Stef Walter <stefw@redhat.com> - 0.42-2
- Fix obseleting cockpit-assets

* Sat Mar 14 2015 Stef Walter <stefw@redhat.com> - 0.42-1
- Update to 0.42 release

* Wed Mar 04 2015 Stef Walter <stefw@redhat.com> - 0.41-1
- Update to 0.41 release

* Thu Feb 26 2015 Stef Walter <stefw@redhat.com> - 0.40-1
- Update to 0.40 release

* Thu Feb 19 2015 Stef Walter <stefw@redhat.com> - 0.39-1
- Update to 0.39 release

* Wed Jan 28 2015 Stef Walter <stefw@redhat.com> - 0.38-1
- Update to 0.38 release

* Thu Jan 22 2015 Stef Walter <stefw@redhat.com> - 0.37-1
- Update to 0.37 release

* Mon Jan 12 2015 Stef Walter <stefw@redhat.com> - 0.36-1
- Update to 0.36 release

* Mon Dec 15 2014 Stef Walter <stefw@redhat.com> - 0.35-1
- Update to 0.35 release

* Thu Dec 11 2014 Stef Walter <stefw@redhat.com> - 0.34-1
- Update to 0.34 release

* Fri Dec 05 2014 Stef Walter <stefw@redhat.com> - 0.33-3
- Only depend on docker stuff on x86_64

* Fri Dec 05 2014 Stef Walter <stefw@redhat.com> - 0.33-2
- Only build docker stuff on x86_64

* Wed Dec 03 2014 Stef Walter <stefw@redhat.com> - 0.33-1
- Update to 0.33 release

* Mon Nov 24 2014 Stef Walter <stefw@redhat.com> - 0.32-1
- Update to 0.32 release

* Fri Nov 14 2014 Stef Walter <stefw@redhat.com> - 0.31-1
- Update to 0.31 release

* Wed Nov 12 2014 Stef Walter <stefw@redhat.com> - 0.30-1
- Update to 0.30 release
- Split Cockpit into various sub packages

* Wed Nov 05 2014 Stef Walter <stefw@redhat.com> - 0.29-3
- Don't require test-assets from selinux-policy
- Other minor tweaks and fixes

* Wed Nov 05 2014 Stef Walter <stefw@redhat.com> - 0.29-2
- Include selinux policy as a dep where required

* Wed Nov 05 2014 Stef Walter <stefw@redhat.com> - 0.29-1
- Update to 0.29 release

* Thu Oct 16 2014 Stef Walter <stefw@redhat.com> - 0.28-1
- Update to 0.28 release
- cockpit-agent was renamed to cockpit-bridge

* Fri Oct 10 2014 Stef Walter <stefw@redhat.com> - 0.27-1
- Update to 0.27 release
- Don't create cockpit-*-admin groups rhbz#1145135
- Fix user management for non-root users rhbz#1140562
- Fix 'out of memory' error during ssh auth rhbz#1142282

* Wed Oct 08 2014 Stef Walter <stefw@redhat.com> - 0.26-1
- Update to 0.26 release
- Can see disk usage on storage page rhbz#1142459
- Better order for lists of block devices rhbz#1142443
- Setting container memory limit fixed rhbz#1142362
- Can create storage volume of maximum capacity rhbz#1142259
- Fix RAID device Bitmap enable/disable error rhbz#1142248
- Docker page connects to right machine rhbz#1142229
- Clear the format dialog label correctly rhbz#1142228
- No 'Drop Privileges' item in menu for root rhbz#1142197
- Don't flash 'Server has closed Connection on logout rhbz#1142175
- Non-root users can manipulate user accounts rhbz#1142154
- Fix strange error message when editing user accounts rhbz#1142154

* Wed Sep 24 2014 Stef Walter <stefw@redhat.com> - 0.25-1
- Update to 0.25 release

* Wed Sep 17 2014 Stef Walter <stefw@redhat.com> - 0.24-1
- Update to 0.24 release

* Wed Sep 10 2014 Stef Walter <stefw@redhat.com> - 0.23-1
- Update to 0.23 release

* Wed Sep 03 2014 Stef Walter <stefw@redhat.com> - 0.22-1
- Update to 0.22 release

* Tue Aug 26 2014 Patrick Uiterwijk <puiterwijk@redhat.com> - 0.21-1
- Update to 0.21 release

* Sat Aug 16 2014 Fedora Release Engineering <rel-eng@lists.fedoraproject.org> - 0.20-2
- Rebuilt for https://fedoraproject.org/wiki/Fedora_21_22_Mass_Rebuild

* Thu Aug 14 2014 Stef Walter <stefw@redhat.com> 0.20-1
- Update to 0.20 release

* Thu Aug 07 2014 Stef Walter <stefw@redhat.com> 0.19-1
- Update to 0.19 release

* Wed Jul 30 2014 Stef Walter <stefw@redhat.com> 0.18-1
- Update to 0.18 release
- Add glib-networking build requirement
- Let selinux-policy-targetted distribute selinux policy

* Mon Jul 28 2014 Colin Walters <walters@verbum.org> 0.17-2
- Drop Requires and references to dead test-assets subpackage

* Thu Jul 24 2014 Stef Walter <stefw@redhat.com> 0.17-1
- Update to 0.17 release

* Wed Jul 23 2014 Stef Walter <stefw@redhat.com> 0.16-3
- Distribute our own selinux policy rhbz#1110758

* Tue Jul 22 2014 Stef Walter <stefw@redhat.com> 0.16-2
- Refer to cockpit.socket in scriptlets rhbz#1110764

* Thu Jul 17 2014 Stef Walter <stefw@redhat.com> 0.16-1
- Update to 0.16 release

* Thu Jul 10 2014 Stef Walter <stefw@redhat.com> 0.15-1
- Update to 0.15 release
- Put pam_reauthorize.so in the cockpit PAM stack

* Thu Jul 03 2014 Stef Walter <stefw@redhat.com> 0.14-1
- Update to 0.14 release

* Mon Jun 30 2014 Stef Walter <stefw@redhat.com> 0.13-1
- Update to 0.13 release

* Tue Jun 24 2014 Stef Walter <stefw@redhat.com> 0.12-1
- Update to upstream 0.12 release

* Fri Jun 20 2014 Stef Walter <stefw@redhat.com> 0.11-1
- Update to upstream 0.11 release

* Thu Jun 12 2014 Stef Walter <stefw@redhat.com> 0.10-1
- Update to upstream 0.10 release

* Sat Jun 07 2014 Fedora Release Engineering <rel-eng@lists.fedoraproject.org> - 0.9-2
- Rebuilt for https://fedoraproject.org/wiki/Fedora_21_Mass_Rebuild

* Fri May 23 2014 Stef Walter <stefw@redhat.com> 0.9-1
- Update to upstream 0.9 release
- Fix file attribute for cockpit-polkit

* Wed May 21 2014 Stef Walter <stefw@redhat.com> 0.8-1
- Update to upstream 0.8 release
- cockpitd now runs as a user session DBus service

* Mon May 19 2014 Stef Walter <stefw@redhat.com> 0.7-1
- Update to upstream 0.7 release

* Wed May 14 2014 Stef Walter <stefw@redhat.com> 0.6-1
- Update to upstream 0.6 release

* Tue Apr 15 2014 Stef Walter <stefw@redhat.com> 0.5-1
- Update to upstream 0.5 release

* Thu Apr 03 2014 Stef Walter <stefw@redhat.com> 0.4-1
- Update to upstream 0.4 release
- Lots of packaging cleanup and polish

* Fri Mar 28 2014 Stef Walter <stefw@redhat.com> 0.3-1
- Update to upstream 0.3 release

* Wed Feb 05 2014 Patrick Uiterwijk (LOCAL) <puiterwijk@redhat.com> - 0.2-0.4.20140204git5e1faad
- Redid the release tag

* Tue Feb 04 2014 Patrick Uiterwijk (LOCAL) <puiterwijk@redhat.com> - 0.2-0.3.5e1faadgit
- Fixed license tag
- Updated to new FSF address upstream
- Removing libgsystem before build
- Now claiming specific manpages
- Made the config files noreplace
- Removed the test assets
- Put the web assets in a subpackage

* Tue Feb 04 2014 Patrick Uiterwijk (LOCAL) <puiterwijk@redhat.com> - 0.2-0.2.5e1faadgit
- Patch libgsystem out

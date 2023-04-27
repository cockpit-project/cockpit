# This file is part of Cockpit.
#
# Copyright (C) 2013 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

m4_include([version.m4])
AC_INIT([Cockpit],
        [VERSION_NUMBER],
        [devel@lists.cockpit-project.org],
        [cockpit],
        [https://cockpit-project.org/])

AC_CONFIG_SRCDIR([src])
AC_CONFIG_HEADERS([config.h])
AC_CONFIG_AUX_DIR([tools])

AM_INIT_AUTOMAKE([1.11 foreign dist-xz no-dist-gzip subdir-objects])
# we want tar-ustar to avoid introducing extra metadata (ctime, atime) which
# only adds useless non-determinism to the result.  we also want to sort.
am__tar='tar --format=ustar --sort=name --owner=root:0 --group=root:0 -chf - "$$tardir"'

AC_USE_SYSTEM_EXTENSIONS
AC_SYS_LARGEFILE
AC_PROG_RANLIB

# This is required to find the correct `ar` for cross-compiling
AC_CHECK_TOOL(AR, ar)

AC_CHECK_FUNCS(
    closefrom
)

AM_SILENT_RULES([yes])

AC_MSG_CHECKING([whether to install to prefix only])
AC_ARG_ENABLE([prefix-only],
              [AS_HELP_STRING([--enable-prefix-only], [Whether to install to prefix only])],
              [], [enable_prefix_only=no])
AC_MSG_RESULT($enable_prefix_only)


# --enable-selinux-policy=[type]
AC_MSG_CHECKING([whether to build selinux policy, and which])
AC_ARG_ENABLE([selinux-policy], [AS_HELP_STRING([--enable-selinux-policy=type], [Whether to build selinux policy, and which])])
if test "${enable_selinux_policy:=no}" = 'yes'; then
    AC_MSG_ERROR([--enable-selinux-policy requires a type (eg: targeted)])
fi
AM_CONDITIONAL(SELINUX_POLICY_ENABLED, test "$enable_selinux_policy" != "no")
AC_SUBST(SELINUX_POLICY_TYPE, [${enable_selinux_policy}])
AC_MSG_RESULT($enable_selinux_policy)

# --disable-polkit
AC_MSG_CHECKING([whether to build polkit support])
AC_ARG_ENABLE(polkit, AS_HELP_STRING([--disable-polkit], [Disable usage of polkit]))
AM_CONDITIONAL(WITH_POLKIT, test "$enable_polkit" != 'no')
if test "$enable_polkit" != 'no'; then
  AC_DEFINE([WITH_POLKIT], 1, [Whether to build with polkit support])
fi
AC_MSG_RESULT(${enable_polkit:=yes})

# --disable-ssh
AC_MSG_CHECKING([whether to build cockpit-ssh])
AC_ARG_ENABLE(ssh, AS_HELP_STRING([--disable-ssh], [Disable cockpit-ssh build and libssh dependency]))
AM_CONDITIONAL(WITH_COCKPIT_SSH, test "$enable_ssh" != "no")
AC_MSG_RESULT(${enable_ssh:=yes})

# --enable-pybridge
AC_MSG_CHECKING([whether to install the python cockpit-bridge])
AC_ARG_ENABLE(bridge, AS_HELP_STRING([--enable-pybridge], [Install python cockpit-bridge]))
AM_CONDITIONAL(WITH_PYBRIDGE, test "$enable_pybridge" = "yes")
AC_MSG_RESULT(${enable_pybridge:=no})


# pkg-config
GLIB_API_VERSION="GLIB_VERSION_2_56"
PKG_CHECK_MODULES(glib, [gio-2.0 >= 2.56 gio-unix-2.0])
glib_CFLAGS="${glib_CFLAGS} -DGLIB_VERSION_MIN_REQUIRED=$GLIB_API_VERSION"
glib_CFLAGS="${glib_CFLAGS} -DGLIB_VERSION_MAX_ALLOWED=$GLIB_API_VERSION"

PKG_CHECK_MODULES(libsystemd, [libsystemd >= 235])
PKG_CHECK_MODULES(json_glib, [json-glib-1.0 >= 1.4])
PKG_CHECK_MODULES(gnutls, [gnutls >= 3.6.0])
PKG_CHECK_MODULES(krb5, [krb5-gssapi >= 1.11 krb5 >= 1.11])
if test "$enable_polkit" != "no"; then
  PKG_CHECK_MODULES(polkit, [polkit-agent-1 >= 0.105])
fi
if test "$enable_ssh" != "no"; then
  PKG_CHECK_MODULES(libssh, [libssh >= 0.8.5])
  old_CFLAGS=$CFLAGS; CFLAGS=$libssh_CFLAGS
  old_LIBS=$LIBS; LIBS=$libssh_LIBS
  AC_CHECK_FUNCS(ssh_userauth_publickey_auto_get_current_identity)
  CFLAGS=$old_CFLAGS
  LIBS=$old_LIBS
fi

# pam
AC_CHECK_HEADER([security/pam_appl.h], ,
  [AC_MSG_ERROR([Couldn't find PAM headers. Try installing pam-devel])]
)
PAM_LIBS="-lpam"
COCKPIT_SESSION_LIBS="$COCKPIT_SESSION_LIBS $PAM_LIBS"

# pam module directory
AC_ARG_WITH([pamdir],
            [AS_HELP_STRING([--with-pamdir=DIR],
                             [directory to install pam modules in])],
             [], [with_pamdir='${libdir}/security'])
pamdir=$with_pamdir
AC_SUBST(pamdir)

# crypt
AC_CHECK_HEADER([crypt.h], ,
  [AC_MSG_ERROR([Couldn't find crypt headers. Try installing glibc-headers])]
)
AC_CHECK_LIB(crypt, crypt_r, [ true ],
  [AC_MSG_ERROR([Couldn't find crypt library. Try installing glibc-devel])]
)
COCKPIT_WS_LIBS="$COCKPIT_WS_LIBS -lcrypt"

# pcp
AC_MSG_CHECKING([whether to build with PCP])
AC_ARG_ENABLE(pcp, AS_HELP_STRING([--disable-pcp], [Disable usage of PCP]))

if test "$enable_pcp" = "no"; then
  AC_MSG_RESULT($enable_pcp)

else
  if test "$enable_pcp" = ""; then
    disable_msg="(perhaps --disable-pcp)"
  fi

  enable_pcp="yes"
  AC_MSG_RESULT($enable_pcp)

  AC_CHECK_HEADER([pcp/pmapi.h], ,
    [AC_MSG_ERROR([Couldn't find pcp headers $disable_msg])]
  )
  AC_CHECK_HEADERS([pcp/import.h pcp/pmda.h], ,
    [AC_MSG_ERROR([Couldn't find pcp headers $disable_msg])],
    [#include <pcp/pmapi.h>]
  )
  AC_CHECK_LIB(pcp, pmNewContext, [ true ],
    [AC_MSG_ERROR([Couldn't find pcp library $disable_msg])]
  )
  AC_CHECK_LIB(pcp_pmda, pmdaCacheLookup, [ true ],
    [AC_MSG_ERROR([Couldn't find pcp_pmda library $disable_msg])]
  )
  AC_CHECK_LIB(pcp_import, pmiStart, [ true ],
    [AC_MSG_ERROR([Couldn't find pcp_import library $disable_msg])]
  )
  COCKPIT_PCP_LIBS="$COCKPIT_PCP_LIBS -lpcp"
fi

AM_CONDITIONAL([ENABLE_PCP], [test "$enable_pcp" = "yes"])

# systemd
AC_ARG_WITH([systemdunitdir], [AS_HELP_STRING([--with-systemdunitdir=DIR],
                                              [directory to install systemd unit files in])])

if test ! -z "$with_systemdunitdir"; then
  systemdunitdir=$with_systemdunitdir
elif test "$enable_prefix_only" = "yes"; then
    systemdunitdir='${prefix}/lib/systemd/system'
else
  PKG_CHECK_MODULES(SYSTEMD, [systemd])
  AC_MSG_CHECKING(for systemd unit dir)
  systemdunitdir=$($PKG_CONFIG systemd --variable=systemdsystemunitdir)
  if test "$systemdunitdir" = ""; then
    AC_MSG_ERROR([systemd's pkg-config file doesn't contain 'systemdsystemunitdir' variable])
  fi
  AC_MSG_RESULT($systemdunitdir)
fi
AC_SUBST([systemdunitdir], [$systemdunitdir])

# We need msgcat, msgfmt, and xgettext, but they're all in the same
# package as xgettext, and we find them by PATH, so just check for the one.
AC_PATH_PROG([XGETTEXT], [xgettext], [no])
if test "$XGETTEXT" = "no"; then
        AC_MSG_ERROR([Please install gettext tools])
fi

# ssh-add
AC_PATH_PROG([SSH_ADD], [ssh-add], [/usr/bin/ssh-add], [$PATH:/usr/local/sbin:/usr/sbin:/sbin])
AC_DEFINE_UNQUOTED([PATH_SSH_ADD], ["$SSH_ADD"], [Location of ssh-add binary])

# ssh-agent
AC_PATH_PROG([SSH_AGENT], [ssh-agent], [/usr/bin/ssh-agent], [$PATH:/usr/local/bin:/usr/bin:/bin])
AC_DEFINE_UNQUOTED([PATH_SSH_AGENT], ["$SSH_AGENT"], [Location of ssh-agent binary])

# Address sanitizer
AC_MSG_CHECKING([for asan flags])
AC_ARG_ENABLE(asan,
              AS_HELP_STRING([--enable-asan=no/yes],
                             [Turn the Address Sanitizer on or off])
             )

if test "$enable_asan" = "yes"; then
    CFLAGS="$CFLAGS -fsanitize=address -O1 -fno-omit-frame-pointer -g"
    asan_status="yes"
else
    asan_status="no"
fi
AM_CONDITIONAL(WITH_ASAN, test "$enable_asan" = "yes")
AC_MSG_RESULT($asan_status)

# User and group for running cockpit web server (cockpit-tls or -ws in customized setups)

AC_ARG_WITH(cockpit_user,
	    AS_HELP_STRING([--with-cockpit-user=<user>],
			   [User for running cockpit (root)]
                          )
           )
AC_ARG_WITH(cockpit_group,
	    AS_HELP_STRING([--with-cockpit-group=<group>],
			   [Group for running cockpit]
                          )
           )
if test -z "$with_cockpit_user"; then
    COCKPIT_USER=root
    COCKPIT_GROUP=
else
    COCKPIT_USER=$with_cockpit_user
    if test -z "$with_cockpit_group"; then
        COCKPIT_GROUP=$with_cockpit_user
    else
	COCKPIT_GROUP=$with_cockpit_group
    fi
fi

AC_SUBST(COCKPIT_USER)
AC_SUBST(COCKPIT_GROUP)

# User for running cockpit-ws instances from cockpit-tls

AC_ARG_WITH(cockpit_ws_instance_user,
	    AS_HELP_STRING([--with-cockpit-ws-instance-user=<user>],
			   [User for running cockpit-ws instances from cockpit-tls (root)]
                          )
           )
AC_ARG_WITH(cockpit_ws_instance_group,
	    AS_HELP_STRING([--with-cockpit-ws-instance-group=<group>],
			   [Group for running cockpit-ws instances from cockpit-tls]
                          )
           )
if test -z "$with_cockpit_ws_instance_user"; then
    if test "$COCKPIT_USER" != "root"; then
        AC_MSG_ERROR([--with-cockpit-ws-instance-user is required when setting --with-cockpit-user])
    fi
    COCKPIT_WSINSTANCE_USER=root
else
    COCKPIT_WSINSTANCE_USER=$with_cockpit_ws_instance_user
    if test -z "$with_cockpit_ws_instance_group"; then
        COCKPIT_WSINSTANCE_GROUP=$with_cockpit_ws_instance_user
    else
        COCKPIT_WSINSTANCE_GROUP=$with_cockpit_ws_instance_group
    fi
fi

AC_SUBST(COCKPIT_WSINSTANCE_USER)
AC_SUBST(COCKPIT_WSINSTANCE_GROUP)

# admin users group
AC_ARG_WITH([admin-group],
            [AS_HELP_STRING([--with-admin-group=GROUP],
                            [system group to which admin users belong])],
            [admin_group=$withval],
            [
              AC_MSG_CHECKING([for system group to which admin users belong])
              CANDIDATE_GROUPS="wheel sudo root"
              admin_group="$(getent group ${CANDIDATE_GROUPS} | head -n1 | cut -f1 -d:)"
              if test -n "$admin_group"; then
                AC_MSG_RESULT([$admin_group])
              else
                AC_MSG_RESULT([unable to detect])
                AC_MSG_ERROR([none of '${CANDIDATE_GROUPS}' exist: please specify a group with --with-admin-group=])
              fi
            ])
AC_SUBST(admin_group)

# Default PATH for cockpit-session
AC_ARG_WITH([default-session-path],
            [AS_HELP_STRING([--with-default-session-path=PATH],
                            [The value for the PATH environment variable in a session started by cockpit-session])],
            [default_session_path=$withval],
            [
              AC_MSG_CHECKING([for cockpit-session PATH value])
              if test "$(readlink /sbin)" == "usr/bin"; then
                 # This is Arch where "sbin" is symlinked to "bin" and
                 # "/bin" is symlinked to "/usr/bin".  We use the
                 # normal Arch PATH which omits "sbin" and "/bin" for
                 # those reasons.  Otherwise "pkexec" will find
                 # cockpit-bridge in "/usr/sbin" and our rule wont
                 # match.
                 default_session_path=/usr/local/sbin:/usr/local/bin:/usr/bin
              else
                 default_session_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
              fi
              AC_MSG_RESULT([$default_session_path])
            ])
AC_DEFINE_UNQUOTED([DEFAULT_SESSION_PATH], ["$default_session_path"], [Default value of PATH for cockpit-session])

# Documentation

AC_MSG_CHECKING([whether to build documentation])
AC_ARG_ENABLE(doc,
              AS_HELP_STRING([--disable-doc],
                             [Disable building documentation])
             )

if test "$enable_doc" = "no"; then
        AC_MSG_RESULT($enable_doc)

else
        if test "$enable_doc" = ""; then
                disable_msg="(perhaps --disable-doc)"
        fi

        enable_doc="yes"
        AC_MSG_RESULT($enable_doc)

        AC_PATH_PROG([XSLTPROC], [xsltproc], [no])
        if test "$XSLTPROC" = "no"; then
                AC_MSG_ERROR([the xsltproc command was not found $disable_msg])
        fi

        AC_PATH_PROG([XMLTO], [xmlto], [no])
        if test "$XMLTO" = "no"; then
                AC_MSG_ERROR([the xmlto command was not found $disable_msg])
        fi

        AC_SUBST(XSLTPROC)
        AC_SUBST(XMLTO)
fi

AM_CONDITIONAL([ENABLE_DOC], [test "$enable_doc" = "yes"])

# cockpit-client
AC_MSG_CHECKING([whether to install cockpit-client])
AC_ARG_ENABLE([cockpit-client],
              [AS_HELP_STRING([--enable-cockpit-client], [Whether to install cockpit-client])],
              [], [enable_cockpit_client=no])
AC_MSG_RESULT($enable_cockpit_client)
AM_CONDITIONAL([ENABLE_COCKPIT_CLIENT], [test "$enable_cockpit_client" = "yes"])

# Debug

AC_MSG_CHECKING([for debug mode])
AC_ARG_ENABLE(debug,
              AS_HELP_STRING([--enable-debug=no/default/yes],
                             [Turn on or off debugging])
             )

if test "$enable_debug" != "no"; then
  AC_DEFINE_UNQUOTED(WITH_DEBUG, 1, [Print debug output])
  AC_DEFINE_UNQUOTED(_DEBUG, 1, [In debug mode])
  CFLAGS="$CFLAGS -g"
fi
debugdir='${prefix}/src/debug'
if test "$enable_debug" = "yes"; then
  debug_status="yes"
  debugdir=
  CFLAGS="$CFLAGS -O0"
  NODE_ENV="development"
elif test "$enable_debug" = "no"; then
  debug_status="no"
  CFLAGS="$CFLAGS -O2"
  NODE_ENV="production"
else
  debug_status="default"
  NODE_ENV="${NODE_ENV:-production}"
fi
AM_CONDITIONAL(WITH_DEBUG, test "$enable_debug" = "yes")
AC_MSG_RESULT($debug_status)
AC_SUBST(NODE_ENV)
AC_SUBST(debugdir)

# Coverage

AC_MSG_CHECKING([whether to build with coverage])
AC_ARG_ENABLE([coverage],
              [AS_HELP_STRING([--enable-coverage], [Whether to enable coverage testing])],
              [],
              [enable_coverage=no])

if test "$enable_coverage" = "yes"; then
  if test "$GCC" != "yes"; then
    AC_MSG_ERROR(Coverage testing requires GCC)
  fi

  CFLAGS="$CFLAGS -O0 -g --coverage"
  LDFLAGS="$LDFLAGS --coverage"
fi

AM_CONDITIONAL([WITH_COVERAGE], [test "$enable_coverage" = "yes"])
AC_MSG_RESULT([$enable_coverage])

# Strict

AC_ARG_ENABLE(strict, [
               AS_HELP_STRING([--enable-strict], [Strict code compilation])
             ])

AC_MSG_CHECKING([build strict])
if test "$enable_strict" = "yes"; then
  CFLAGS="$CFLAGS -Werror"
else
  enable_strict="no"
fi
AC_MSG_RESULT($enable_strict)

AM_PATH_PYTHON([3.6])

# Generate
#

AC_SUBST(PAM_LIBS)

AC_CONFIG_FILES([
Makefile
doc/guide/version
src/tls/cockpit-certificate-helper
src/ws/cockpit-desktop
])
AC_OUTPUT


dnl ==========================================================================
echo "
               Cockpit $VERSION
             ================

        prefix:                     ${prefix}
        exec_prefix:                ${exec_prefix}
        libdir:                     ${libdir}
        libexecdir:                 ${libexecdir}
        bindir:                     ${bindir}
        sbindir:                    ${sbindir}
        datarootdir:                ${datarootdir}
        datadir:                    ${datadir}
        sysconfdir:                 ${sysconfdir}
        localstatedir:              ${localstatedir}
        pamdir:                     ${pamdir}
        systemd unit dir:           ${systemdunitdir}

        compiler:                   ${CC}
        cflags:                     ${CFLAGS}
        cppflags:                   ${CPPFLAGS}

        cockpit-ws user:            ${COCKPIT_USER}
        cockpit-ws group:           ${COCKPIT_GROUP}
        cockpit-ws instance user:   ${COCKPIT_WSINSTANCE_USER}
        cockpit-ws instance group:  ${COCKPIT_WSINSTANCE_GROUP}
        admin group:                ${admin_group}
        cockpit-session PATH:       ${default_session_path}

        Building docs:              ${enable_doc}
        Debug mode:                 ${debug_status}
        Node environment:           ${NODE_ENV}
        With coverage:              ${enable_coverage}
        With address sanitizer:     ${asan_status}
        With PCP:                   ${enable_pcp}
        With polkit:                ${enable_polkit}
        SELinux Policy:             ${enable_selinux_policy}

        cockpit-client:             ${enable_cockpit_client}
        cockpit-ssh:                ${enable_ssh}

        ssh-add:                    ${SSH_ADD}
        ssh-agent:                  ${SSH_AGENT}

Now type 'make' to compile cockpit."

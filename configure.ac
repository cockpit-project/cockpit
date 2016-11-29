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

AC_INIT([Cockpit],
        [m4_esyscmd([tools/git-version-gen .tarball])],
        [devel@lists.cockpit-project.org],
        [cockpit],
        [http://www.cockpit-project.org/])

# The above git-version-gen command can either use .git or a .tarball file
# in the top level directory to determine the version. If that didn't work
# bail early. Cockpit needs to know its own version number
AC_MSG_CHECKING(that PACKAGE_VERSION is properly set)
if test -z "$PACKAGE_VERSION"; then
  AC_MSG_RESULT(no)
  AC_MSG_ERROR(Please build from a .git checkout or .tar.xz tarball)
else
  AC_MSG_RESULT(yes)
fi

AC_CONFIG_SRCDIR([src])
AC_CONFIG_HEADERS([config.h])
AC_CONFIG_AUX_DIR([tools])
AC_CONFIG_MACRO_DIR([tools])

AM_INIT_AUTOMAKE([1.9 foreign dist-xz no-dist-gzip subdir-objects tar-pax])
AM_MAINTAINER_MODE([enable])

AC_USE_SYSTEM_EXTENSIONS

AM_PROG_AR
AC_PROG_CC
AC_PROG_CC_C99
AC_PROG_RANLIB
AC_ISC_POSIX
AC_HEADER_STDC
AC_PROG_LN_S

m4_ifdef([AM_SILENT_RULES], [AM_SILENT_RULES([yes])])

AC_MSG_CHECKING([whether to install to prefix only])
AC_ARG_ENABLE([prefix-only],
              [AS_HELP_STRING([--enable-prefix-only], [Whether to install to prefix only])],
              [], [enable_prefix_only=no])
AC_MSG_RESULT($enable_prefix_only)

# Initialization
#

GLIB_VERSION="2.34"
LIBSSH_VERSION="0.6.0"

GIO_REQUIREMENT="gio-unix-2.0 >= $GLIB_VERSION"
LIBSYSTEMD_REQUIREMENT="libsystemd"
LIBSYSTEMD_REQUIREMENT_OLD="libsystemd-journal >= 187 libsystemd-daemon libsystemd-login"
JSON_GLIB_REQUIREMENT="json-glib-1.0 >= 0.14.0"
POLKIT_REQUIREMENT="polkit-agent-1 >= 0.105"

PKG_CHECK_MODULES(GIO, [$GIO_REQUIREMENT])
GLIB_VERSION_DEF="GLIB_VERSION_$(echo $GLIB_VERSION | tr '.' '_')"
GIO_CFLAGS="$GIO_CFLAGS -DGLIB_VERSION_MIN_REQUIRED=$GLIB_VERSION_DEF"
GIO_CFLAGS="$GIO_CFLAGS -DGLIB_VERSION_MAX_ALLOWED=$GLIB_VERSION_DEF"

PKG_CHECK_MODULES(LIBSYSTEMD, [$LIBSYSTEMD_REQUIREMENT], [], [
	PKG_CHECK_MODULES(LIBSYSTEMD, [$LIBSYSTEMD_REQUIREMENT_OLD])
])
PKG_CHECK_MODULES(JSON_GLIB, [$JSON_GLIB_REQUIREMENT])
PKG_CHECK_MODULES(POLKIT, [$POLKIT_REQUIREMENT])

# HACK: We can't yet use the new krb5 pkg-config file
AC_PATH_PROG(KRB5_CONFIG, krb5-config)
AC_MSG_CHECKING(for working krb5-config)
if test -x "$KRB5_CONFIG"; then
  KRB5_CFLAGS="$($KRB5_CONFIG --cflags gssapi)"
  KRB5_LIBS="$($KRB5_CONFIG --libs gssapi)"
  AC_MSG_RESULT(yes)
else
  AC_MSG_ERROR(no. Please install MIT kerberos devel package)
fi

COCKPIT_CFLAGS="$GIO_CFLAGS $JSON_GLIB_CFLAGS $LIBSYSTEMD_CFLAGS"
COCKPIT_LIBS="$GIO_LIBS $JSON_GLIB_LIBS $LIBSYSTEMD_LIBS -lutil -lm"
AC_SUBST(COCKPIT_CFLAGS)
AC_SUBST(COCKPIT_LIBS)

COCKPIT_BRIDGE_CFLAGS="$COCKPIT_CFLAGS $POLKIT_CFLAGS"
COCKPIT_BRIDGE_LIBS="$COCKPIT_LIBS $POLKIT_LIBS"
AC_SUBST(COCKPIT_BRIDGE_CFLAGS)
AC_SUBST(COCKPIT_BRIDGE_LIBS)

COCKPIT_PCP_CFLAGS="$COCKPIT_CFLAGS"
COCKPIT_PCP_LIBS="$COCKPIT_LIBS"
AC_SUBST(COCKPIT_PCP_CFLAGS)
AC_SUBST(COCKPIT_PCP_LIBS)

COCKPIT_SESSION_CFLAGS="$KRB5_CFLAGS"
COCKPIT_SESSION_LIBS="$KRB5_LIBS"
AC_SUBST(COCKPIT_SESSION_CFLAGS)
AC_SUBST(COCKPIT_SESSION_LIBS)

COCKPIT_POLKIT_CFLAGS="$GIO_CFLAGS $POLKIT_CFLAGS"
COCKPIT_POLKIT_LIBS="$GIO_LIBS $POLKIT_LIBS"
AC_SUBST(COCKPIT_POLKIT_CFLAGS)
AC_SUBST(COCKPIT_POLKIT_LIBS)

# whether to build cockpit-ws
AC_ARG_ENABLE(ws, AC_HELP_STRING([--disable-ws], [Disable cockpit-ws build]))

AC_MSG_CHECKING([build with cockpit-ws])
if test "$enable_ws" != "no"; then
  enable_ws="yes"
  AC_MSG_RESULT([$enable_ws])
  PKG_CHECK_MODULES(GLIB_TLS, [glib-2.0 >= 2.37.4])
  PKG_CHECK_MODULES(LIBSSH, [libssh >= $LIBSSH_VERSION libssh_threads])
  COCKPIT_WS_CFLAGS="$COCKPIT_CFLAGS $KRB5_CFLAGS"
  COCKPIT_WS_LIBS="$COCKPIT_LIBS $KRB5_LIBS"
  COCKPIT_SSH_SESSION_CFLAGS="$COCKPIT_CFLAGS $LIBSSH_CFLAGS $KRB5_CFLAGS"
  COCKPIT_SSH_SESSION_LIBS="$COCKPIT_LIBS $LIBSSH_LIBS $KRB5_LIBS"
  AC_SUBST(COCKPIT_WS_CFLAGS)
  AC_SUBST(COCKPIT_WS_LIBS)
  AC_SUBST(COCKPIT_SSH_SESSION_LIBS)
  AC_SUBST(COCKPIT_SSH_SESSION_CFLAGS)
else
  enable_ws="no"
  AC_MSG_RESULT([$enable_ws])
fi

AM_CONDITIONAL(WITH_COCKPIT_WS, test "$enable_ws" = "yes")

# pam
AC_CHECK_HEADER([security/pam_appl.h], ,
  [AC_MSG_ERROR([Couldn't find PAM headers. Try installing pam-devel])]
)
AC_CHECK_LIB(pam, pam_open_session, [ true ],
  [AC_MSG_ERROR([Couldn't find PAM library. Try installing pam-devel])]
)
PAM_LIBS="-lpam"
COCKPIT_SESSION_LIBS="$COCKPIT_SESSION_LIBS $PAM_LIBS"
COCKPIT_WS_LIBS="$COCKPIT_WS_LIBS $PAM_LIBS"
REAUTHORIZE_LIBS="$REAUTHORIZE_LIBS $PAM_LIBS"

# pam module directory
AC_ARG_WITH([pamdir],
            [AC_HELP_STRING([--with-pamdir=DIR],
                             [directory to install pam modules in])],
             [], [with_pamdir='${libdir}/security'])
pamdir=$with_pamdir
AC_SUBST(pamdir)

# keyutils
AC_CHECK_HEADER([keyutils.h], ,
  [AC_MSG_ERROR([Couldn't find keyutils headers. Try installing keyutils-libs-devel])]
)
AC_CHECK_LIB(keyutils, keyctl_join_session_keyring, [ true ],
  [AC_MSG_ERROR([Couldn't find keyutils library. Try installing keyutils-libs-devel])]
)
COCKPIT_SESSION_LIBS="$COCKPIT_SESSION_LIBS -lkeyutils"
REAUTHORIZE_LIBS="$REAUTHORIZE_LIBS -lkeyutils"

# crypt
AC_CHECK_HEADER([crypt.h], ,
  [AC_MSG_ERROR([Couldn't find crypt headers. Try installing glibc-headers])]
)
AC_CHECK_LIB(crypt, crypt_r, [ true ],
  [AC_MSG_ERROR([Couldn't find crypt library. Try installing glibc-devel])]
)
COCKPIT_WS_LIBS="$COCKPIT_WS_LIBS -lcrypt"
REAUTHORIZE_LIBS="$REAUTHORIZE_LIBS -lcrypt"

# pcp
AC_MSG_CHECKING([whether to build with PCP])
AC_ARG_ENABLE(pcp, AC_HELP_STRING([--disable-pcp], [Disable usage of PCP]))

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
  COCKPIT_PCP_LIBS="$COCKPIT_PCP_LIBS -lpcp -lm"
fi

AM_CONDITIONAL([ENABLE_PCP], [test "$enable_pcp" = "yes"])

# gssapi
AC_CHECK_LIB(gssapi_krb5, gss_import_cred,
  [AC_DEFINE_UNQUOTED(HAVE_GSS_IMPORT_CRED, 1, Whether gss_import_cred is available)])
AC_CHECK_LIB(ssh, ssh_gssapi_set_creds,
  [AC_DEFINE_UNQUOTED(HAVE_SSH_GSSAPI_SET_CREDS, 1, Whether ssh_gssapi_set_creds is available)])

# key auth
AC_CHECK_LIB(ssh, ssh_set_agent_socket,
  [AC_DEFINE_UNQUOTED(HAVE_SSH_SET_AGENT_SOCKET, 1, Whether ssh_set_agent_socket is available)
  key_auth="yes"],
  [key_auth="no"])

# systemd
AC_ARG_WITH([systemdunitdir], [AC_HELP_STRING([--with-systemdunitdir=DIR],
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

# Internationalization

GETTEXT_PACKAGE=cockpit
AC_SUBST([GETTEXT_PACKAGE])
AM_GLIB_GNU_GETTEXT
AC_DEFINE_UNQUOTED([GETTEXT_PACKAGE],["$GETTEXT_PACKAGE"],[gettext domain])

AC_PATH_PROG(MSGCAT, msgcat)
AC_PATH_PROG(MSGFMT, msgfmt)
AC_PATH_PROG(MSGGREP, msggrep)
AC_PATH_PROG(MSGMERGE, msgmerge)
AC_PATH_PROG(XGETTEXT, xgettext)
AC_MSG_CHECKING(for gettext binaries)
if test -x "$MSGCAT" -a -x "$MSGFMT" -a -x "$MSGMERGE" -a -x "$MSGGREP" -a -x "$XGETTEXT"; then
  AC_SUBST(MSGCAT)
  AC_SUBST(MSGFMT)
  AC_SUBST(MSGGREP)
  AC_SUBST(MSGMERGE)
  AC_SUBST(XGETTEXT)
  AC_MSG_RESULT(yes)
else
  AC_MSG_ERROR([no. Please install gettext tools])
fi

AC_PATH_PROG(INTLTOOL_EXTRACT, intltool-extract)
AC_PATH_PROG(INTLTOOL_MERGE, intltool-merge)
AC_PATH_PROG(INTLTOOL_UPDATE, intltool-update)
AC_MSG_CHECKING(for intltool binaries)
if test -x "$INTLTOOL_EXTRACT" -a -x "$INTLTOOL_MERGE" -a -x "$INTLTOOL_UPDATE"; then
  AC_SUBST(INTLTOOL_EXTRACT)
  AC_SUBST(INTLTOOL_MERGE)
  AC_SUBST(INTLTOOL_UPDATE)
  AC_MSG_RESULT(yes)
else
  AC_MSG_ERROR(no. Please install intltool package)
fi

# phantomjs

AC_PATH_PROG([PHANTOMJS], [phantomjs], [], [$PATH$PATH_SEPARATOR$srcdir/node_modules/.bin/])
AM_CONDITIONAL([WITH_PHANTOMJS], [test -n "$PHANTOMJS"])

# go

AC_PATH_PROG([GOLANG], [go])
AM_CONDITIONAL([WITH_GOLANG], [test -n "$GOLANG"])

# usermod
#
# usermod might not be world-executable, so AC_PATH_PROG might not
# find it.  In that case, we fall back to /usr/sbin/usermod.

AC_PATH_PROG([USERMOD], [usermod], [/usr/sbin/usermod], [$PATH:/usr/local/sbin:/usr/sbin:/sbin])
AC_DEFINE_UNQUOTED([PATH_USERMOD],["$USERMOD"],[Location of usermod binary])

# newusers
AC_PATH_PROG([NEWUSERS], [newusers], [/usr/sbin/newusers], [$PATH:/usr/local/sbin:/usr/sbin:/sbin])
AC_DEFINE_UNQUOTED([PATH_NEWUSERS],["$NEWUSERS"],[Location of newusers binary])
AC_MSG_CHECKING(whether $NEWUSERS understands --crypt-method)
if newusers --help | grep -q -e --crypt-method; then
  AC_DEFINE_UNQUOTED([HAVE_NEWUSERS_CRYPT_METHOD],[1],[whether newusers understands --crypt-method])
  AC_MSG_RESULT(yes)
else
  AC_MSG_RESULT(no)
fi

# chpasswd
AC_PATH_PROG([CHPASSWD], [chpasswd], [/usr/sbin/chpasswd], [$PATH:/usr/local/sbin:/usr/sbin:/sbin])
AC_DEFINE_UNQUOTED([PATH_CHPASSWD],["$CHPASSWD"],[Location of chpasswd binary])

# pkexec
AC_PATH_PROG([PKEXEC], [pkexec], [/usr/bin/pkexec], [$PATH:/usr/local/sbin:/usr/sbin:/sbin])
AC_DEFINE_UNQUOTED([PATH_PKEXEC], ["$PKEXEC"], [Location of pkexec binary])

# sudo
AC_PATH_PROG([SUDO], [sudo], [/usr/bin/sudo], [$PATH:/usr/local/sbin:/usr/sbin:/sbin])
AC_DEFINE_UNQUOTED([PATH_SUDO], ["$SUDO"], [Location of sudo binary])

# ssh-add
AC_PATH_PROG([SSH_ADD], [ssh-add], [/usr/bin/ssh-add], [$PATH:/usr/local/sbin:/usr/sbin:/sbin])
AC_DEFINE_UNQUOTED([PATH_SSH_ADD], ["$SSH_ADD"], [Location of ssh-add binary])

# ssh-agent
AC_PATH_PROG([SSH_AGENT], [ssh-agent], [/usr/bin/ssh-agent], [$PATH:/usr/local/bin:/usr/bin:/bin])
AC_DEFINE_UNQUOTED([PATH_SSH_AGENT], ["$SSH_AGENT"], [Location of ssh-agent binary])

# chcon
AC_PATH_PROG([CHCON], [chcon], [/usr/bin/chcon], [$PATH:/usr/local/bin:/usr/bin:/bin])
AC_DEFINE_UNQUOTED([PATH_CHCON], ["$CHCON"], [Location of chcon binary])

changequote(,)dnl
if test "x$GCC" = "xyes"; then
  CFLAGS="-Wall \
          -Werror=strict-prototypes -Werror=missing-prototypes \
          -Werror=implicit-function-declaration \
          -Werror=pointer-arith -Werror=init-self \
          -Werror=format-security \
          -Werror=missing-include-dirs $CFLAGS"
fi
changequote([,])dnl

# System functions

AC_CHECK_FUNCS(fdwalk)


# Package specific settings

# HACK - Storaged before 2.5.3 doesn't tell us when it supports
#        sessions, so we allow it to be switched off explicitly.
#
# https://github.com/storaged-project/storaged/pull/68

AC_ARG_WITH(storaged-iscsi-sessions,
            AC_HELP_STRING([--with-storaged-iscsi-sessions=yes/no],
                           [Whether storaged supports listing iSCSI sessions]),
            [],
            [with_storaged_iscsi_sessions=yes])
AC_SUBST(with_storaged_iscsi_sessions)

# HACK - Debian has a broken policy for NetworkManager where it
#        only allows local sessions or root to perform actions.
#
# https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=808162

AC_ARG_WITH(networkmanager-needs-root,
	    AC_HELP_STRING([--with-networkmanager-needs-root=yes/no],
			   [Whether NetworkManager requires root access]),
            [],
	    [with_networkmanager_needs_root=yes])
AC_SUBST(with_networkmanager_needs_root)


# Address sanitizer

AC_MSG_CHECKING([for asan flags])
AC_ARG_ENABLE(asan,
              AC_HELP_STRING([--enable-asan=no/yes],
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

# User and group for running cockpit-ws

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

AC_ARG_WITH(selinux_config_type,
	    AS_HELP_STRING([--with-selinux-config-type=<type>],
			   [SELinux context type for cockpit config files]
                          )
           )

COCKPIT_SELINUX_CONFIG_TYPE=$with_selinux_config_type
AC_SUBST(COCKPIT_SELINUX_CONFIG_TYPE)

# Documentation

AC_MSG_CHECKING([whether to build documentation])
AC_ARG_ENABLE(doc,
              AC_HELP_STRING([--disable-doc],
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

# Branding

AC_MSG_CHECKING([for branding directory])
AC_ARG_WITH(branding,
            AC_HELP_STRING([--with-branding=auto],
                           [Specify which branding to use.  A value of "default" means upstream branding.])
)
BRAND=${with_branding:-auto}
AC_MSG_RESULT($BRAND)
if test "$BRAND" != "auto"; then
  AC_DEFINE_UNQUOTED([PACKAGE_BRAND], ["$BRAND"], [Which brand to show.])
fi

# Debug

AC_MSG_CHECKING([for debug mode])
AC_ARG_ENABLE(debug,
              AC_HELP_STRING([--enable-debug=no/default/yes],
                             [Turn on or off debugging])
             )

if test "$enable_debug" != "no"; then
  AC_DEFINE_UNQUOTED(WITH_DEBUG, 1, [Print debug output])
  AC_DEFINE_UNQUOTED(_DEBUG, 1, [In debug mode])
  CFLAGS="$CFLAGS -g"
fi
debugdir=${prefix}/src/debug
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
  NODE_ENV="production"
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

# Generate
#

AC_SUBST(REAUTHORIZE_LIBS)
AC_SUBST(PAM_LIBS)

AC_DEFINE([MAX_PACKET_SIZE], [65536], [Maximum size of packet messages])

AC_OUTPUT([
Makefile
pkg/networkmanager/override.json
pkg/storaged/override.json
doc/guide/version
])


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

        cockpit-ws:                 ${enable_ws}
        cockpit-ws user:            ${COCKPIT_USER}
        cockpit-ws group:           ${COCKPIT_GROUP}
        selinux config type:        ${COCKPIT_SELINUX_CONFIG_TYPE}

        Maintainer mode:            ${USE_MAINTAINER_MODE}
        Building docs:              ${enable_doc}
        Debug mode:                 ${debug_status}
        With coverage:              ${enable_coverage}
        With address sanitizer:     ${asan_status}
        With PCP:                   ${enable_pcp}
	Branding:                   ${BRAND}
        Supports key auth:          ${key_auth}

        pkexec:                     ${PKEXEC}
        ssh-add:                    ${SSH_ADD}
        ssh-agent:                  ${SSH_AGENT}
        sudo:                       ${SUDO}
        usermod:                    ${USERMOD}
        chcon:                      ${CHCON}
"

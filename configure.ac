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
        [0.25],
        [devel@lists.cockpit-project.org],
        [cockpit],
        [http://www.cockpit-project.org/])

AC_CONFIG_SRCDIR([src])
AC_CONFIG_HEADERS([config.h])
AC_CONFIG_AUX_DIR([tools])
AC_CONFIG_MACRO_DIR([tools])

AM_INIT_AUTOMAKE([1.9 foreign dist-bzip2 no-dist-gzip subdir-objects])
AM_MAINTAINER_MODE([enable])

AC_USE_SYSTEM_EXTENSIONS

AC_PROG_CC
AC_PROG_CC_C99
AC_PROG_RANLIB
AC_ISC_POSIX
AC_HEADER_STDC

m4_ifdef([AM_SILENT_RULES], [AM_SILENT_RULES([yes])])

# Initialization
#

AC_PATH_PROG([XSLTPROC], [xsltproc])
if test -z "$XSLTPROC"; then
  AC_MSG_ERROR([xsltproc is needed])
fi

AC_PATH_PROG([JSL], [jsl])
if test -z "$JSL"; then
  AC_MSG_WARN([jsl is needed to run js-lint])
fi

GLIB_VERSION="2.34"

GIO_REQUIREMENT="gio-unix-2.0 >= $GLIB_VERSION"
SYSTEMD_REQUIREMENT="libsystemd-journal >= 187 libsystemd-daemon"
JSON_GLIB_REQUIREMENT="json-glib-1.0 >= 0.14.0"
LIBSSH_REQUIREMENT="libssh >= 0.6.0"
GUDEV_REQUIREMENT="gudev-1.0 >= 165"
UDISKS_REQUIREMENT="udisks2 >= 2.0.91"
ACCOUNTS_REQUIREMENT="accountsservice >= 0.6.35"
POLKIT_REQUIREMENT="polkit-agent-1 >= 0.105"
LIBGSYSTEM_REQUIREMENT="libgsystem"

PKG_CHECK_MODULES(GIO, [$GIO_REQUIREMENT])
GLIB_VERSION_DEF="GLIB_VERSION_$(echo $GLIB_VERSION | tr '.' '_')"
GIO_CFLAGS="$GIO_CFLAGS -DGLIB_VERSION_MIN_REQUIRED=$GLIB_VERSION_DEF"
GIO_CFLAGS="$GIO_CFLAGS -DGLIB_VERSION_MAX_ALLOWED=$GLIB_VERSION_DEF"

PKG_CHECK_MODULES(SYSTEMD, [$SYSTEMD_REQUIREMENT])
PKG_CHECK_MODULES(JSON_GLIB, [$JSON_GLIB_REQUIREMENT])
PKG_CHECK_MODULES(LIBSSH, [$LIBSSH_REQUIREMENT])
PKG_CHECK_MODULES(LIBGSYSTEM, [$LIBGSYSTEM_REQUIREMENT])
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

COCKPIT_CFLAGS="$GIO_CFLAGS $JSON_GLIB_CFLAGS $SYSTEMD_CFLAGS"
COCKPIT_LIBS="$GIO_LIBS $JSON_GLIB_LIBS $SYSTEMD_LIBS -lutil"
AC_SUBST(COCKPIT_CFLAGS)
AC_SUBST(COCKPIT_LIBS)

COCKPIT_WS_CFLAGS="$COCKPIT_CFLAGS $LIBSSH_CFLAGS $LIBGSYSTEM_CFLAGS $KRB5_CFLAGS"
COCKPIT_WS_LIBS="$COCKPIT_LIBS $LIBSSH_LIBS $KRB5_LIBS"
AC_SUBST(COCKPIT_WS_CFLAGS)
AC_SUBST(COCKPIT_WS_LIBS)

COCKPIT_AGENT_CFLAGS="$COCKPIT_CFLAGS $LIBGSYSTEM_CFLAGS $POLKIT_CFLAGS"
COCKPIT_AGENT_LIBS="$COCKPIT_LIBS $POLKIT_LIBS"
AC_SUBST(COCKPIT_AGENT_CFLAGS)
AC_SUBST(COCKPIT_AGENT_LIBS)

COCKPIT_SESSION_CFLAGS="$KRB5_CFLAGS"
COCKPIT_SESSION_LIBS="$KRB5_LIBS"
AC_SUBST(COCKPIT_SESSION_CFLAGS)
AC_SUBST(COCKPIT_SESSION_LIBS)

COCKPIT_POLKIT_CFLAGS="$GIO_CFLAGS $POLKIT_CFLAGS"
COCKPIT_POLKIT_LIBS="$GIO_LIBS $POLKIT_LIBS"
AC_SUBST(COCKPIT_POLKIT_CFLAGS)
AC_SUBST(COCKPIT_POLKIT_LIBS)

PKG_CHECK_MODULES(COCKPIT_DAEMON, [$GUDEV_REQUIREMENT
                                   $UDISKS_REQUIREMENT
                                   $ACCOUNTS_REQUIREMENT])

COCKPIT_DAEMON_CFLAGS="$COCKPIT_CFLAGS $COCKPIT_DAEMON_CFLAGS $LIBGSYSTEM_CFLAGS"
COCKPIT_DAEMON_LIBS="$COCKPIT_LIBS $COCKPIT_DAEMON_LIBS"

# dbus interfaces dir

# Can't use PKG_CHECK_VAR() as not all our target systems have it
AC_CHECK_PROGS(PKG_CONFIG, pkg-config)
AC_MSG_CHECKING(for dbus interfaces directory)
interfacesdir=$($PKG_CONFIG dbus-1 --variable=interfaces_dir)
if test "$interfacesdir" = ""; then
    AC_MSG_ERROR(Couldn't find dbus interfaces directory. Try installing dbus-devel)
else
    AC_MSG_RESULT($interfacesdir)
    AC_SUBST(interfacesdir)
fi

# pam
AC_CHECK_HEADER([security/pam_appl.h], [ ],
  [AC_MSG_ERROR([Couldn't find PAM headers. Try installing pam-devel])]
)
AC_CHECK_LIB(pam, pam_open_session, [ ],
  [AC_MSG_ERROR([Couldn't find PAM library. Try installing pam-devel])]
)
COCKPIT_SESSION_LIBS="$COCKPIT_SESSION_LIBS -lpam"
COCKPIT_WS_LIBS="$COCKPIT_WS_LIBS -lpam"
REAUTHORIZE_LIBS="$REAUTHORIZE_LIBS -lpam"

# pam module directory
AC_ARG_WITH([pamdir],
            [AC_HELP_STRING([--with-pamdir=DIR],
                             [directory to install pam modules in])],
             [], [with_pamdir='${libdir}/security'])
pamdir=$with_pamdir
AC_SUBST(pamdir)

# keyutils
AC_CHECK_HEADER([keyutils.h], [ ],
  [AC_MSG_ERROR([Couldn't find keyutils headers. Try installing keyutils-libs-devel])]
)
AC_CHECK_LIB(keyutils, keyctl_join_session_keyring, [ ],
  [AC_MSG_ERROR([Couldn't find keyutils library. Try installing keyutils-libs-devel])]
)
COCKPIT_SESSION_LIBS="$COCKPIT_SESSION_LIBS -lkeyutils"
REAUTHORIZE_LIBS="$REAUTHORIZE_LIBS -lkeyutils"

# crypt
AC_CHECK_HEADER([crypt.h], [ ],
  [AC_MSG_ERROR([Couldn't find crypt headers. Try installing glibc-headers])]
)
AC_CHECK_LIB(crypt, crypt_r, [ ],
  [AC_MSG_ERROR([Couldn't find crypt library. Try installing glibc-devel])]
)
COCKPIT_WS_LIBS="$COCKPIT_WS_LIBS -lcrypt"
REAUTHORIZE_LIBS="$REAUTHORIZE_LIBS -lcrypt"

# systemd
AC_ARG_WITH([systemdsystemunitdir],
            AS_HELP_STRING([--with-systemdsystemunitdir=DIR], [Directory for systemd service files]),
            [],
            [with_systemdsystemunitdir=$($PKG_CONFIG --variable=systemdsystemunitdir systemd)])
if test "x$with_systemdsystemunitdir" != "xno"; then
  AC_SUBST([systemdsystemunitdir], [$with_systemdsystemunitdir])
fi
AM_CONDITIONAL(HAVE_SYSTEMD, [test -n "$systemdsystemunitdir"])

# Internationalization

IT_PROG_INTLTOOL([$INTLTOOL_REQUIRED])

GETTEXT_PACKAGE=cockpit
AC_SUBST([GETTEXT_PACKAGE])
AM_GLIB_GNU_GETTEXT
AC_DEFINE_UNQUOTED([GETTEXT_PACKAGE],["$GETTEXT_PACKAGE"],[gettext domain])

# For po2json

for mod in JSON Locale::PO; do
  AC_MSG_CHECKING([for CPAN perl module $mod])
  if perl -e "use $mod;"; then
    AC_MSG_RESULT([yes])
  else
    AC_MSG_ERROR([The CPAN perl module $mod is required])
  fi
done

# phantomjs

AC_PATH_PROG([PHANTOMJS], [phantomjs])
AM_CONDITIONAL([WITH_PHANTOMJS], [test -n "$PHANTOMJS"])

# storaged

LVM2_INTERFACE=$interfacesdir/com.redhat.lvm2.xml
AC_CHECK_FILE($LVM2_INTERFACE, ,
    [AC_MSG_ERROR(Need com.redhat.lvm2.xml. Try installing storaged)]
)
AC_SUBST(LVM2_INTERFACE)

# Config

AC_DEFINE_UNQUOTED([COCKPIT_CONFIG_FILE],["$sysconfdir/cockpit/config"],[Configuration file])

changequote(,)dnl
if test "x$GCC" = "xyes"; then
  CFLAGS="-Wall \
          -Werror=strict-prototypes -Werror=missing-prototypes \
          -Werror=implicit-function-declaration \
          -Werror=pointer-arith -Werror=init-self \
          -Werror=format-security \
          -Werror=missing-include-dirs -Werror=aggregate-return $CFLAGS"
fi
changequote([,])dnl

# System functions

AC_CHECK_FUNCS(fdwalk)

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
if test "$enable_debug" = "yes"; then
  debug_status="yes"
  CFLAGS="$CFLAGS -O0"
elif test "$enable_debug" = "no"; then
  debug_status="no"
  CFLAGS="$CFLAGS -O2"
else
  debug_status="default"
fi
AM_CONDITIONAL(WITH_DEBUG, test "$enable_debug" = "yes")
AC_MSG_RESULT($debug_status)

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

AC_OUTPUT([
Makefile
doc/version
po/Makefile.in
])

dnl ==========================================================================
echo "
               Cockpit $VERSION
             ================

        prefix:                     ${prefix}
        libdir:                     ${libdir}
        libexecdir:                 ${libexecdir}
        bindir:                     ${bindir}
        sbindir:                    ${sbindir}
        datadir:                    ${datadir}
        sysconfdir:                 ${sysconfdir}
        localstatedir:              ${localstatedir}
        systemdsystemunitdir:       ${systemdsystemunitdir}
        pamdir:                     ${pamdir}

        compiler:                   ${CC}
        cflags:                     ${CFLAGS}
        cppflags:                   ${CPPFLAGS}

        cockpit-ws user:            ${COCKPIT_USER}
        cockpit-ws group:           ${COCKPIT_GROUP}

        Maintainer mode:            ${USE_MAINTAINER_MODE}
        Building docs:              ${enable_doc}
        Debug mode:                 ${debug_status}
        With coverage:              ${enable_coverage}
        With address sanitizer:     ${asan_status}
"

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
AC_INIT([Cockpit],[0.2],[devel@lists.cockpit-project.org],[cockpit],[http://www.cockpit-project.org/])

AC_CONFIG_SRCDIR([src])
AC_CONFIG_HEADERS([config.h])
AC_CONFIG_AUX_DIR([tools])
AC_CONFIG_MACRO_DIR([tools])

AM_INIT_AUTOMAKE([1.9 foreign dist-bzip2 no-dist-gzip])
AM_MAINTAINER_MODE([enable])

AC_USE_SYSTEM_EXTENSIONS

AC_PROG_CC
AC_PROG_CC_C99
AC_ISC_POSIX
AC_HEADER_STDC
LT_INIT

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

AC_PATH_PROG([SASS], [pyscss])
if test -z "$SASS"; then
  AC_MSG_ERROR([pyscss is needed])
fi

GTK_DOC_CHECK([1.3])

GIO_REQUIREMENT="gio-unix-2.0 >= 2.34"
SYSTEMD_REQUIREMENT="libsystemd-journal >= 187 libsystemd-daemon"
JSON_GLIB_REQUIREMENT="json-glib-1.0 >= 0.14.0"
LIBGSSH_REQUIREMENT="libssh >= 0.6.0 libgssh-1"

dnl Used for anything that just needs gio
PKG_CHECK_MODULES(GIO, [gio-unix-2.0 >= 2.34.0])
AC_SUBST(GIO_CFLAGS)
AC_SUBST(GIO_LIBS)

dnl Our two main binaries
PKG_CHECK_MODULES(COCKPIT_WS, [$GIO_REQUIREMENT
                               $SYSTEMD_REQUIREMENT
                               $JSON_GLIB_REQUIREMENT
                               $LIBGSSH_REQUIREMENT])

PKG_CHECK_MODULES(COCKPIT_AGENT, [$GIO_REQUIREMENT
                                  $SYSTEMD_REQUIREMENT
                                  $JSON_GLIB_REQUIREMENT])

PKG_CHECK_MODULES(COCKPIT_DAEMON, [$GIO_REQUIREMENT
                                   $SYSTEMD_REQUIREMENT
                                   $JSON_GLIB_REQUIREMENT
                                   gudev-1.0 >= 165
                                   udisks2 >= 2.0.91
                                   libnm-glib >= 0.9.7.0 libnm-util
                                   accountsservice >= 0.6.35])

old_CFLAGS=$CFLAGS
old_LIBS=$LIBS
CFLAGS=$COCKPIT_DAEMON_CFLAGS
LIBS=$COCKPIT_DAEMON_LIBS

CFLAGS=$old_CFLAGS
LIBS=$old_LIBS

# pam
AC_CHECK_HEADER([security/pam_appl.h], [ ],
  [AC_MSG_ERROR([Couldn't find PAM headers. Try installing pam-devel])]
)
AC_CHECK_LIB(pam, pam_open_session, [ ],
  [AC_MSG_ERROR([Couldn't find PAM library. Try installing pam-devel])]
)
COCKPIT_SESSION_LIBS="$COCKPIT_SESSION_LIBS -lpam"
COCKPIT_WS_LIBS="$COCKPIT_WS_LIBS -lpam"

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
  AC_DEFINE_UNQUOTED(G_DISABLE_ASSERT, 1, [Disable glib assertions])
else
  debug_status="default"
fi
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

# Generate
#

AC_SUBST(COCKPIT_SESSION_LIBS)

AC_OUTPUT([
Makefile
doc/Makefile
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

        compiler:                   ${CC}
        cflags:                     ${CFLAGS}
        cppflags:                   ${CPPFLAGS}

        Maintainer mode:            ${USE_MAINTAINER_MODE}
        Building api docs:          ${enable_gtk_doc}
        Debug mode:                 ${debug_status}
        With coverage:              ${enable_coverage}
"

AC_INIT([libvirt-dbus], [0.0.1], [libvir-list@redhat.com], [], [http://libvirt.org])

AC_CONFIG_SRCDIR(src/main.c)
AC_CONFIG_AUX_DIR([build-aux])
AC_CONFIG_HEADERS([config.h])
AC_CONFIG_MACRO_DIR([m4])
dnl Make automake keep quiet about wildcards & other GNUmake-isms
AM_INIT_AUTOMAKE([foreign -Wno-portability])
AC_CANONICAL_HOST
AC_USE_SYSTEM_EXTENSIONS

AM_SILENT_RULES([yes])

GLIB2_REQUIRED=2.44.0
LIBVIRT_REQUIRED=1.2.8
SYSTEMD_REQUIRED=211
LIBVIRT_GLIB_REQUIRED=0.0.7
AC_SUBST([GLIB2_REQUIRED]) dnl used in the .spec file
AC_SUBST([LIBVIRT_REQUIRED]) dnl used in the .spec file
AC_SUBST([SYSTEMD_REQUIRED]) dnl used in the .spec file
AC_SUBST([LIBVIRT_GLIB_REQUIRED]) dnl used in the .spec file

LIBVIRT_DBUS_MAJOR_VERSION=`echo $VERSION | awk -F. '{print $1}'`
LIBVIRT_DBUS_MINOR_VERSION=`echo $VERSION | awk -F. '{print $2}'`
LIBVIRT_DBUS_MICRO_VERSION=`echo $VERSION | awk -F. '{print $3}'`
LIBVIRT_DBUS_VERSION=$LIBVIRT_DBUS_MAJOR_VERSION.$LIBVIRT_DBUS_MINOR_VERSION.$LIBVIRT_DBUS_MICRO_VERSION$LIBVIRT_DBUS_MICRO_VERSION_SUFFIX
LIBVIRT_DBUS_VERSION_NUMBER=`expr $LIBVIRT_DBUS_MAJOR_VERSION \* 1000000 + $LIBVIRT_dbus_MINOR_VERSION \* 1000 + $LIBVIRT_DBUS_MICRO_VERSION`

AC_SUBST([LIBVIRT_DBUS_MAJOR_VERSION])
AC_SUBST([LIBVIRT_DBUS_MINOR_VERSION])
AC_SUBST([LIBVIRT_DBUS_MICRO_VERSION])
AC_SUBST([LIBVIRT_DBUS_VERSION])
AC_SUBST([LIBVIRT_DBUS_VERSION_INFO])
AC_SUBST([LIBVIRT_DBUS_VERSION_NUMBER])

AC_PROG_CC
AC_PROG_MKDIR_P
AM_PROG_CC_C_O
AC_PROG_CC_STDC

PKG_CHECK_MODULES(GIO2, gio-unix-2.0 >= GLIB2_REQUIRED)
PKG_CHECK_MODULES(GLIB2, glib-2.0 >= GLIB2_REQUIRED)
PKG_CHECK_MODULES(LIBVIRT, libvirt >= $LIBVIRT_REQUIRED)
PKG_CHECK_MODULES(SYSTEMD, libsystemd >= $SYSTEMD_REQUIRED)
PKG_CHECK_MODULES(LIBVIRT_GLIB, libvirt-glib-1.0 >= LIBVIRT_GLIB_REQUIRED)

LIBVIRT_COMPILE_WARNINGS
LIBVIRT_LINKER_RELRO
LIBVIRT_COMPILE_PIE

LIBVIRT_ARG_WITH([DBUS_SERVICES], [where D-Bus session services direcotry is],
                 ['$(datadir)/dbus-1/services'])
DBUS_SERVICES_DIR="$with_dbus_services"
AC_SUBST(DBUS_SERVICES_DIR)

LIBVIRT_ARG_WITH([DBUS_SYSTEM_SERVICES], [where D-Bus system services directory is],
                 ['$(datadir)/dbus-1/system-services'])
DBUS_SYSTEM_SERVICES_DIR="$with_dbus_system_services"
AC_SUBST(DBUS_SYSTEM_SERVICES_DIR)

LIBVIRT_ARG_WITH([DBUS_SYSTEM_POLICIES], [where D-Bus system policies directory is],
                 ['$(datadir)/dbus-1/system.d'])
DBUS_SYSTEM_POLICIES_DIR="$with_dbus_system_policies"
AC_SUBST(DBUS_SYSTEM_POLICIES_DIR)

LIBVIRT_ARG_WITH([DBUS_INTERFACES], [where D-Bus interfaces directory is],
                 ['$(datadir)/dbus-1/interfaces'])
DBUS_INTERFACES_DIR="$with_dbus_interfaces"
AC_SUBST([DBUS_INTERFACES_DIR])

LIBVIRT_ARG_WITH([SYSTEM_USER], [username to run system instance as],
                 ['libvirtdbus'])
SYSTEM_USER=$with_system_user
AC_SUBST([SYSTEM_USER])

AC_CONFIG_FILES([run],
                [chmod +x,-w run])
AC_OUTPUT(Makefile
          data/Makefile
          src/Makefile
          test/Makefile
          libvirt-dbus.spec)

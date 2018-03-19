AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	-DVIRT_DBUS_INTERFACES_DIR=\"$(DBUS_INTERFACES_DIR)\"

DAEMON_SOURCES = \
	main.c \
	connect.c connect.h \
	util.c util.h \
	domain.c domain.h \
	events.c events.h \
	gdbus.c gdbus.h

EXTRA_DIST = \
	$(DAEMON_SOURCES)
CLEANFILES =

bin_PROGRAMS = libvirt-dbus

libvirt_dbus_SOURCES = $(DAEMON_SOURCES)

libvirt_dbus_CFLAGS = \
	$(SYSTEMD_CFLAGS) \
	$(GIO2_CFLAGS) \
	$(GLIB2_CFLAGS) \
	$(LIBVIRT_CFLAGS) \
	$(LIBVIRT_GLIB_CFLAGS) \
	$(WARN_CFLAGS) \
	$(PIE_CFLAGS) \
	$(NULL)

libvirt_dbus_LDFLAGS = \
	$(SYSTEMD_LDFLAGS) \
	$(GIO2_LDFLAGS) \
	$(GLIB2_LDFLAGS) \
	$(LIBVIRT_LDFLAGS) \
	$(LIBVIRT_GLIB_LDFLAGS) \
	$(RELRO_LDFLAGS) \
	$(PID_LDFLAGS) \
	$(NULL)

libvirt_dbus_LDADD = \
	$(SYSTEMD_LIBS) \
	$(GIO2_LIBS) \
	$(GLIB2_LIBS) \
	$(LIBVIRT_LIBS) \
	$(LIBVIRT_GLIB_LIBS)

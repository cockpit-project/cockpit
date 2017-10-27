AM_CPPFLAGS = \
	-I$(top_srcdir)/src

DAEMON_SOURCES = \
	main.c \
	manager.c manager.h \
	util.c util.h \
	domain.c domain.h \
	events.c events.h

EXTRA_DIST = \
	$(DAEMON_SOURCES)
CLEANFILES =

bin_PROGRAMS = libvirt-dbus

libvirt_dbus_SOURCES = $(DAEMON_SOURCES)

libvirt_dbus_CFLAGS = \
	$(SYSTEMD_CFLAGS) \
	$(LIBVIRT_CFLAGS) \
	$(WARN_CFLAGS) \
	$(PIE_CFLAGS) \
	$(NULL)

libvirt_dbus_LDFLAGS = \
	$(SYSTEMD_LDFLAGS) \
	$(LIBVIRT_LDFLAGS) \
	$(RELRO_LDFLAGS) \
	$(PID_LDFLAGS) \
	$(NULL)

libvirt_dbus_LDADD = \
	$(SYSTEMD_LIBS) \
	$(LIBVIRT_LIBS)

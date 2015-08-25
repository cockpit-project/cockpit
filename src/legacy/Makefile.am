libexec_PROGRAMS += cockpit-wrapper

dbus_built_sources = cockpit-generated.h cockpit-generated.c

cockpit-generated.h: cockpit-generated.c
cockpit-generated.c: Makefile.am $(top_srcdir)/src/legacy/com.redhat.Cockpit.xml
	$(AM_V_GEN) $(GDBUS_CODEGEN) \
		--interface-prefix com.redhat.Cockpit.				\
		--c-namespace Cockpit							\
		--c-generate-object-manager						\
		--generate-c-code cockpit-generated                             		\
		--generate-docbook cockpit-generated-doc					\
		$(top_srcdir)/src/legacy/com.redhat.Cockpit.xml	\
		$(NULL)

BUILT_SOURCES += $(dbus_built_sources)
CLEANFILES += cockpit-generated*

noinst_LIBRARIES += libcockpit-legacy.a

libcockpit_legacy_a_SOURCES = \
	src/legacy/types.h \
	src/legacy/daemon.h \
	src/legacy/daemon.c \
	src/legacy/utils.h \
	src/legacy/utils.c \
	src/legacy/cgroupmonitor.h \
	src/legacy/cgroupmonitor.c \
	src/legacy/netdevmonitor.h \
	src/legacy/netdevmonitor.c \
	$(NULL)

libcockpit_legacy_a_CFLAGS = \
	-DG_LOG_DOMAIN=\"cockpit-wrapper\" \
	$(COCKPIT_WRAPPER_CFLAGS) \
	$(NULL)

cockpit_wrapper_SOURCES = \
	src/legacy/main.c \
	$(NULL)

cockpit_wrapper_CFLAGS = \
	-I$(top_srcdir)/src/legacy			\
	-DG_LOG_DOMAIN=\"cockpit-wrapper\" \
	$(COCKPIT_WRAPPER_CFLAGS) \
	$(NULL)

cockpit_wrapper_LDADD = \
	libcockpit-legacy.a \
	libcockpit-common.a \
	$(COCKPIT_WRAPPER_LIBS) \
	-lm 						\
	$(NULL)

dbusservice_DATA = com.redhat.Cockpit.service

com.redhat.Cockpit.service: src/legacy/com.redhat.Cockpit.service.in Makefile.am
	$(AM_V_GEN) $(SED_SUBST) $< > $@

EXTRA_DIST += \
	src/legacy/com.redhat.Cockpit.xml \
	src/legacy/com.redhat.Cockpit.service.in \
	$(NULL)

CLEANFILES += \
	com.redhat.Cockpit.service \
	$(NULL)

# -----------------------------------------------------------------------------
# TESTS

DAEMON_CHECKS = \
	test-cgroupmonitor
test_cgroupmonitor_SOURCES = src/legacy/test-cgroupmonitor.c
test_cgroupmonitor_CFLAGS = $(libcockpit_legacy_a_CFLAGS)
test_cgroupmonitor_LDADD = $(cockpit_wrapper_LDADD)

noinst_PROGRAMS += $(DAEMON_CHECKS)
TESTS += $(DAEMON_CHECKS)

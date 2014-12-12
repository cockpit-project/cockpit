
noinst_LIBRARIES += libcockpit-bridge.a

bridge_built_sources = internal-generated.h internal-generated.c

internal-generated.h: internal-generated.c
internal-generated.c: Makefile.am $(top_srcdir)/src/bridge/deprecated/internal.xml
	$(AM_V_GEN) $(GDBUS_CODEGEN) \
		--interface-prefix com.redhat.Cockpit. \
		--c-namespace Cockpit \
		--c-generate-object-manager \
		--generate-c-code internal-generated \
		$(top_srcdir)/src/bridge/deprecated/internal.xml
BUILT_SOURCES += $(bridge_built_sources)
CLEANFILES += $(bridge_built_sources)

nodist_libcockpit_bridge_a_SOURCES = $(bridge_built_sources)
libcockpit_bridge_a_SOURCES = \
	src/bridge/cockpitchannel.c \
	src/bridge/cockpitchannel.h \
	src/bridge/cockpitdbuscache.c \
	src/bridge/cockpitdbuscache.h \
	src/bridge/cockpitdbusjson.c \
	src/bridge/cockpitdbusjson.h \
	src/bridge/cockpitdbusrules.c \
	src/bridge/cockpitdbusrules.h \
	src/bridge/cockpitechochannel.c \
	src/bridge/cockpitechochannel.h \
	src/bridge/cockpithttpstream.c \
	src/bridge/cockpithttpstream.h \
	src/bridge/cockpitpackage.c \
	src/bridge/cockpitpackage.h \
	src/bridge/cockpitpaths.c \
	src/bridge/cockpitpaths.h \
	src/bridge/cockpitpolkitagent.c \
	src/bridge/cockpitpolkitagent.h \
	src/bridge/cockpitnullchannel.c \
	src/bridge/cockpitnullchannel.h \
	src/bridge/cockpitresource.c \
	src/bridge/cockpitresource.h \
	src/bridge/cockpitstream.c \
	src/bridge/cockpitstream.h \
	src/bridge/cockpitsuperchannels.c \
	src/bridge/cockpitsuperchannels.h \
	src/bridge/cockpitfsread.c \
	src/bridge/cockpitfsread.h \
	src/bridge/cockpitfswrite.c \
	src/bridge/cockpitfswrite.h \
	src/bridge/cockpitfswatch.c \
	src/bridge/cockpitfswatch.h \
	src/bridge/cockpitfsdir.c \
	src/bridge/cockpitfsdir.h \
	src/bridge/deprecated/cockpitdbusjson1.c \
	src/bridge/deprecated/cockpitdbusjson1.h \
	src/bridge/deprecated/manager.h \
	src/bridge/deprecated/manager.c \
	src/bridge/deprecated/machines.h \
	src/bridge/deprecated/machines.c \
	src/bridge/deprecated/machine.h \
	src/bridge/deprecated/machine.c \
	src/bridge/deprecated/cpumonitor.h \
	src/bridge/deprecated/cpumonitor.c \
	src/bridge/deprecated/memorymonitor.h \
	src/bridge/deprecated/memorymonitor.c \
	src/bridge/deprecated/networkmonitor.h \
	src/bridge/deprecated/networkmonitor.c \
	src/bridge/deprecated/diskiomonitor.h \
	src/bridge/deprecated/diskiomonitor.c \
	src/bridge/deprecated/cgroupmonitor.h \
	src/bridge/deprecated/cgroupmonitor.c \
	src/bridge/deprecated/netdevmonitor.h \
	src/bridge/deprecated/netdevmonitor.c \
	src/bridge/deprecated/blockdevmonitor.h \
	src/bridge/deprecated/blockdevmonitor.c \
	src/bridge/deprecated/mountmonitor.h \
	src/bridge/deprecated/mountmonitor.c \
	src/bridge/deprecated/services.h \
	src/bridge/deprecated/services.c \
	src/bridge/deprecated/cgroup-show.h \
	src/bridge/deprecated/cgroup-show.c \
	$(NULL)

libcockpit_bridge_a_CFLAGS = \
	-I$(srcdir)/src/bridge \
	$(cockpit_cppflags_common) \
	$(cockpit_cppflags_glib_version) \
	-DG_LOG_DOMAIN=\"cockpit-bridge\" \
	$(COCKPIT_BRIDGE_CFLAGS) \
	$(WARN_CFLAGS) \
	$(NULL)

libcockpit_bridge_LIBS = \
	libcockpit-bridge.a \
	libcockpit-common.a \
	libwebsocket.a \
	$(COCKPIT_BRIDGE_LIBS) \
	$(NULL)

# -----------------------------------------------------------------------------

bin_PROGRAMS += cockpit-bridge
libexec_PROGRAMS += cockpit-polkit

cockpit_bridge_SOURCES = src/bridge/bridge.c
cockpit_bridge_CFLAGS = \
	-DG_LOG_DOMAIN=\"cockpit-bridge\" \
	$(COCKPIT_BRIDGE_CFLAGS) \
	$(NULL)
cockpit_bridge_LDADD = $(libcockpit_bridge_LIBS)

cockpit_polkit_SOURCES = src/bridge/cockpitpolkithelper.c
cockpit_polkit_CFLAGS = $(COCKPIT_POLKIT_CFLAGS)
cockpit_polkit_LDADD = libreauthorize.a $(REAUTHORIZE_LIBS) $(COCKPIT_POLKIT_LIBS)

# polkit-agent-helper-1 need to be setuid root because polkit wants
# responses to come from a root process
install-data-hook::
	-chown root:0 $(DESTDIR)$(libexecdir)/cockpit-polkit
	-chown root:0 $(DESTDIR)$(libexecdir)/cockpit-polkit
	-chmod 4755 $(DESTDIR)$(libexecdir)/cockpit-polkit

EXTRA_DIST += \
	src/bridge/cockpit.pam.insecure \
	src/bridge/sshd-reauthorize.pam \
	$(NULL)

# -----------------------------------------------------------------------------
# TESTS

BRIDGE_CHECKS = \
	test-paths \
	test-rules \
	test-channel \
	test-dbusjson \
	test-stream \
	test-package \
	test-resource \
	test-fs \
	test-cgroupmonitor \
	test-machines \
	$(NULL)

test_channel_SOURCES = \
	src/bridge/test-channel.c \
	src/bridge/mock-transport.c src/bridge/mock-transport.h
test_channel_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_channel_LDADD = $(libcockpit_bridge_LIBS)

test_cgroupmonitor_SOURCES = src/bridge/deprecated/test-cgroupmonitor.c
test_cgroupmonitor_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_cgroupmonitor_LDADD = $(libcockpit_bridge_LIBS)

test_dbusjson_SOURCES = src/bridge/deprecated/test-dbusjson.c $(mock_dbus_sources)
nodist_test_dbusjson_SOURCES = $(test_built_sources)
test_dbusjson_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_dbusjson_LDADD = $(libcockpit_bridge_LIBS)

test_machines_SOURCES = src/bridge/deprecated/test-machines.c
test_machines_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_machines_LDADD = $(libcockpit_bridge_LIBS)

test_package_SOURCES = src/bridge/test-package.c
test_package_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_package_LDADD = $(libcockpit_bridge_LIBS)

test_paths_SOURCES = src/bridge/test-paths.c
test_paths_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_paths_LDADD = $(libcockpit_bridge_LIBS)

test_rules_SOURCES = src/bridge/test-rules.c
test_rules_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_rules_LDADD = $(libcockpit_bridge_LIBS)

test_stream_SOURCES = \
	src/bridge/test-stream.c \
	src/bridge/mock-transport.c src/bridge/mock-transport.h
test_stream_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_stream_LDADD = $(libcockpit_bridge_LIBS)

test_resource_SOURCES = \
	src/bridge/test-resource.c \
	src/bridge/mock-transport.c src/bridge/mock-transport.h
test_resource_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_resource_LDADD = $(libcockpit_bridge_LIBS)

test_fs_SOURCES = \
	src/bridge/test-fs.c \
	src/bridge/mock-transport.c src/bridge/mock-transport.h
test_fs_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_fs_LDADD = $(libcockpit_bridge_LIBS)

noinst_PROGRAMS += $(BRIDGE_CHECKS)
TESTS += $(BRIDGE_CHECKS)

EXTRA_DIST += \
	src/bridge/mock-resource

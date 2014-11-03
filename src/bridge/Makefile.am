
noinst_LIBRARIES += libcockpit-bridge.a

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
	src/bridge/cockpitrestjson.c \
	src/bridge/cockpitrestjson.h \
	src/bridge/cockpittextstream.c \
	src/bridge/cockpittextstream.h \
	src/bridge/deprecated/cockpitdbusjson1.c \
	src/bridge/deprecated/cockpitdbusjson1.h \
	src/bridge/deprecated/cockpitdbusjson2.c \
	src/bridge/deprecated/cockpitdbusjson2.h \
	src/bridge/deprecated/cockpitfakemanager.c \
	src/bridge/deprecated/cockpitfakemanager.h \
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
	test-fakemanager \
	test-dbusjson \
	test-restjson \
	test-textstream \
	test-package \
	test-resource \
	$(NULL)

test_channel_SOURCES = \
	src/bridge/test-channel.c \
	src/bridge/mock-transport.c src/bridge/mock-transport.h
test_channel_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_channel_LDADD = $(libcockpit_bridge_LIBS)

test_dbusjson_SOURCES = src/bridge/deprecated/test-dbusjson.c $(mock_dbus_sources)
nodist_test_dbusjson_SOURCES = $(test_built_sources)
test_dbusjson_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_dbusjson_LDADD = $(libcockpit_bridge_LIBS)

test_package_SOURCES = src/bridge/test-package.c
test_package_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_package_LDADD = $(libcockpit_bridge_LIBS)

test_paths_SOURCES = src/bridge/test-paths.c
test_paths_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_paths_LDADD = $(libcockpit_bridge_LIBS)

test_restjson_SOURCES = src/bridge/test-restjson.c
test_restjson_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_restjson_LDADD = $(libcockpit_bridge_LIBS)

test_rules_SOURCES = src/bridge/test-rules.c
test_rules_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_rules_LDADD = $(libcockpit_bridge_LIBS)

test_textstream_SOURCES = \
	src/bridge/test-textstream.c \
	src/bridge/mock-transport.c src/bridge/mock-transport.h
test_textstream_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_textstream_LDADD = $(libcockpit_bridge_LIBS)

test_resource_SOURCES = \
	src/bridge/test-resource.c \
	src/bridge/mock-transport.c src/bridge/mock-transport.h
test_resource_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_resource_LDADD = $(libcockpit_bridge_LIBS)

nodist_test_fakemanager_SOURCES = $(test_dbus_generated)
test_fakemanager_SOURCES = \
	src/bridge/deprecated/test-fakemanager.c \
	$(mock_dbus_sources)
test_fakemanager_CFLAGS = $(libcockpit_bridge_a_CFLAGS)
test_fakemanager_LDADD = $(libcockpit_bridge_LIBS)

noinst_PROGRAMS += $(BRIDGE_CHECKS)
TESTS += $(BRIDGE_CHECKS)

EXTRA_DIST += \
	src/bridge/mock-resource

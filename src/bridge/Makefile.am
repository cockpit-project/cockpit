# -----------------------------------------------------------------------------
# libcockpit-metrics.a: code used in both cockpit-bridge and cockpit-pcp

noinst_LIBRARIES += libcockpit-metrics.a

libcockpit_metrics_a_CPPFLAGS = \
	-DG_LOG_DOMAIN=\"cockpit-bridge\" \
	$(glib_CFLAGS) \
	$(json_glib_CFLAGS) \
	$(AM_CPPFLAGS)

libcockpit_metrics_a_LIBS = \
	libcockpit-metrics.a \
	$(libcockpit_common_a_LIBS) \
	$(fts_LIBS) \
	-lm \
	$(NULL)

libcockpit_metrics_a_SOURCES = \
	src/bridge/cockpitblocksamples.c \
	src/bridge/cockpitblocksamples.h \
	src/bridge/cockpitcgroupsamples.c \
	src/bridge/cockpitcgroupsamples.h \
	src/bridge/cockpitcpusamples.c \
	src/bridge/cockpitcpusamples.h \
	src/bridge/cockpitdisksamples.c \
	src/bridge/cockpitdisksamples.h \
	src/bridge/cockpitinternalmetrics.c \
	src/bridge/cockpitinternalmetrics.h \
	src/bridge/cockpitmemorysamples.c \
	src/bridge/cockpitmemorysamples.h \
	src/bridge/cockpitmetrics.c \
	src/bridge/cockpitmetrics.h \
	src/bridge/cockpitmountsamples.c \
	src/bridge/cockpitmountsamples.h \
	src/bridge/cockpitnetworksamples.c \
	src/bridge/cockpitnetworksamples.h \
	src/bridge/cockpitsamples.c \
	src/bridge/cockpitsamples.h \
	$(NULL)

# -----------------------------------------------------------------------------
# libcockpit-bridge.a: code used in cockpit-bridge and its tests

noinst_LIBRARIES += libcockpit-bridge.a

libcockpit_bridge_a_CPPFLAGS = \
	-DG_LOG_DOMAIN=\"cockpit-bridge\" \
	$(glib_CFLAGS) \
	$(json_glib_CFLAGS) \
	$(AM_CPPFLAGS)

libcockpit_bridge_a_LIBS = \
	libcockpit-bridge.a \
	$(libcockpit_metrics_a_LIBS) \
	$(libsystemd_LIBS) \
	$(NULL)

libcockpit_bridge_a_SOURCES = \
	src/bridge/cockpitconnect.c \
	src/bridge/cockpitconnect.h \
	src/bridge/cockpitdbuscache.c \
	src/bridge/cockpitdbuscache.h \
	src/bridge/cockpitdbusconfig.c \
	src/bridge/cockpitdbusinternal.c \
	src/bridge/cockpitdbusinternal.h \
	src/bridge/cockpitdbusjson.c \
	src/bridge/cockpitdbusjson.h \
	src/bridge/cockpitdbusloginmessages.c \
	src/bridge/cockpitdbusmachines.c \
	src/bridge/cockpitdbusmeta.c \
	src/bridge/cockpitdbusmeta.h \
	src/bridge/cockpitdbusprocess.c \
	src/bridge/cockpitdbusrules.c \
	src/bridge/cockpitdbusrules.h \
	src/bridge/cockpitdbususer.c \
	src/bridge/cockpitechochannel.c \
	src/bridge/cockpitechochannel.h \
	src/bridge/cockpitfslist.c \
	src/bridge/cockpitfslist.h \
	src/bridge/cockpitfsread.c \
	src/bridge/cockpitfsread.h \
	src/bridge/cockpitfsreplace.c \
	src/bridge/cockpitfsreplace.h \
	src/bridge/cockpitfswatch.c \
	src/bridge/cockpitfswatch.h \
	src/bridge/cockpithttpstream.c \
	src/bridge/cockpithttpstream.h \
	src/bridge/cockpitinteracttransport.c \
	src/bridge/cockpitinteracttransport.h \
	src/bridge/cockpitnullchannel.c \
	src/bridge/cockpitnullchannel.h \
	src/bridge/cockpitpackages.c \
	src/bridge/cockpitpackages.h \
	src/bridge/cockpitpacketchannel.c \
	src/bridge/cockpitpacketchannel.h \
	src/bridge/cockpitpaths.c \
	src/bridge/cockpitpaths.h \
	src/bridge/cockpitpeer.c \
	src/bridge/cockpitpeer.h \
	src/bridge/cockpitpipechannel.c \
	src/bridge/cockpitpipechannel.h \
	src/bridge/cockpitrouter.c \
	src/bridge/cockpitrouter.h \
	src/bridge/cockpitstream.c \
	src/bridge/cockpitstream.h \
	src/bridge/cockpitwebsocketstream.c \
	src/bridge/cockpitwebsocketstream.h \
	$(NULL)

if WITH_POLKIT
libcockpit_bridge_a_CPPFLAGS += $(polkit_CFLAGS)
libcockpit_bridge_a_LIBS += $(polkit_LIBS)
libcockpit_bridge_a_SOURCES += \
	src/bridge/cockpitpolkitagent.c \
	src/bridge/cockpitpolkitagent.h \
	$(NULL)
endif

# -----------------------------------------------------------------------------
# PROGRAMS

bin_PROGRAMS += cockpit-bridge
cockpit_bridge_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS)
cockpit_bridge_LDADD = $(libcockpit_bridge_a_LIBS)
cockpit_bridge_SOURCES = src/bridge/bridge.c

libexec_PROGRAMS += cockpit-askpass
cockpit_askpass_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS)
cockpit_askpass_LDADD = $(libcockpit_bridge_a_LIBS)
cockpit_askpass_SOURCES = src/bridge/askpass.c

# -----------------------------------------------------------------------------
# TESTS

check_PROGRAMS += mock-bridge
mock_bridge_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS)
mock_bridge_LDADD = $(libcockpit_bridge_a_LIBS)
mock_bridge_SOURCES = src/bridge/mock-bridge.c

TEST_PROGRAM += test-bridge
test_bridge_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_bridge_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_bridge_SOURCES = src/bridge/test-bridge.c

TEST_PROGRAM += test-connect
test_connect_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_connect_LDADD = $(test_bridge_LDADD) $(TEST_LIBS)
test_connect_SOURCES = src/bridge/test-connect.c

TEST_PROGRAM += test-dbus-meta
test_dbus_meta_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_dbus_meta_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_dbus_meta_SOURCES = src/bridge/test-dbus-meta.c

TEST_PROGRAM += test-fs
test_fs_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_fs_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_fs_SOURCES = src/bridge/test-fs.c

TEST_PROGRAM += test-httpstream
test_httpstream_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_httpstream_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_httpstream_SOURCES = src/bridge/test-httpstream.c

TEST_PROGRAM += test-metrics
test_metrics_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_metrics_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_metrics_SOURCES = src/bridge/test-metrics.c

TEST_PROGRAM += test-packages
test_packages_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_packages_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_packages_SOURCES = src/bridge/test-packages.c

TEST_PROGRAM += test-packet-channel
test_packet_channel_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_packet_channel_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_packet_channel_SOURCES = src/bridge/test-packet-channel.c

TEST_PROGRAM += test-paths
test_paths_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_paths_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_paths_SOURCES = src/bridge/test-paths.c

TEST_PROGRAM += test-peer
test_peer_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_peer_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_peer_SOURCES = src/bridge/test-peer.c

TEST_PROGRAM += test-pipe-channel
test_pipe_channel_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_pipe_channel_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_pipe_channel_SOURCES = src/bridge/test-pipe-channel.c

TEST_PROGRAM += test-process
test_process_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_process_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_process_SOURCES = src/bridge/test-process.c

TEST_PROGRAM += test-router
test_router_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_router_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_router_SOURCES = src/bridge/test-router.c

TEST_PROGRAM += test-rules
test_rules_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_rules_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_rules_SOURCES = src/bridge/test-rules.c

TEST_PROGRAM += test-stream
test_stream_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_stream_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_stream_SOURCES = src/bridge/test-stream.c

TEST_PROGRAM += test-websocketstream
test_websocketstream_CPPFLAGS = $(libcockpit_bridge_a_CPPFLAGS) $(TEST_CPP)
test_websocketstream_LDADD = $(libcockpit_bridge_a_LIBS) $(TEST_LIBS)
test_websocketstream_SOURCES = src/bridge/test-websocketstream.c

dist_check_DATA += \
	src/bridge/mock-resource \
	src/bridge/mock-pmda.c \
	src/bridge/mock-pmns \
	src/bridge/mock-client.crt \
	src/bridge/mock-client.key \
	src/bridge/mock-server.crt \
	src/bridge/mock-server.key \
	$(NULL)

# -----------------------------------------------------------------------------
# polkit

# make sure this ends up in the tarball, even with --disable-ssh
polkit_in_files  = src/bridge/org.cockpit-project.cockpit-bridge.policy.in
EXTRA_DIST += $(polkit_in_files)

if WITH_POLKIT
polkitdir        = $(datadir)/polkit-1/actions
polkit_DATA = $(polkit_in_files:.policy.in=.policy)

%.policy: %.policy.in $(PO_FILES)
	$(AM_V_GEN) GETTEXTDATADIRS=$(srcdir)/po msgfmt --xml -d $(top_srcdir)/po --template $< --output $@

CLEANFILES += $(polkit_DATA)
endif

# -----------------------------------------------------------------------------
# PCP

if ENABLE_PCP

pmlogconfdir = $(localstatedir)/lib/pcp/config/pmlogconf/tools
dist_pmlogconf_DATA = src/bridge/pmlogconf/cockpit

libexec_PROGRAMS += cockpit-pcp

noinst_LIBRARIES += libcockpit-pcp.a

libcockpit_pcp_a_CPPFLAGS = \
	-DG_LOG_DOMAIN=\"cockpit-pcp\" \
	$(glib_CFLAGS) \
	$(json_glib_CFLAGS) \
	$(AM_CPPFLAGS)

libcockpit_pcp_a_LIBS = \
	libcockpit-pcp.a \
	$(libcockpit_metrics_a_LIBS) \
	-lpcp_pmda -lpcp -lpcp_import \
	$(NULL)

libcockpit_pcp_a_SOURCES = \
	src/bridge/cockpitconnect.c \
	src/bridge/cockpitconnect.h \
	src/bridge/cockpitpcpmetrics.c \
	src/bridge/cockpitpcpmetrics.h \
	src/bridge/cockpitdbusinternal.c \
	src/bridge/cockpitdbusinternal.h \
	src/bridge/cockpitpeer.c \
	src/bridge/cockpitpeer.h \
	src/bridge/cockpitrouter.c \
	src/bridge/cockpitrouter.h \
	$(libcockpit_bridge_METRICS) \
	$(NULL)

cockpit_pcp_CPPFLAGS = $(libcockpit_pcp_a_CPPFLAGS)
cockpit_pcp_LDADD = $(libcockpit_pcp_a_LIBS)
cockpit_pcp_SOURCES = src/bridge/cockpitpcp.c

check_PROGRAMS += mock-pmda.so
mock_pmda_so_CFLAGS = -fPIC $(AM_CFLAGS)
mock_pmda_so_LDFLAGS = -shared
mock_pmda_so_LDADD = -lpcp_pmda -lpcp
mock_pmda_so_SOURCES = src/bridge/mock-pmda.c

TEST_PROGRAM += test-pcp
test_pcp_CPPFLAGS = $(libcockpit_pcp_a_CFLAGS) $(TEST_CPP)
test_pcp_LDADD = $(libcockpit_pcp_a_LIBS) $(TEST_LIBS) -ldl
test_pcp_SOURCES = src/bridge/test-pcp.c

TEST_PROGRAM += test-pcp-archives
test_pcp_archives_CPPFLAGS = $(libcockpit_pcp_a_CPPFLAGS) $(TEST_CPP)
test_pcp_archives_LDADD = $(libcockpit_pcp_a_LIBS) $(TEST_LIBS)
test_pcp_archives_SOURCES = src/bridge/test-pcp-archives.c

CLEANFILES += mock-archives/*

endif

EXTRA_DIST += \
	src/bridge/cockpit.pam.insecure \
	$(NULL)

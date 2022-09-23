BUILT_SOURCES =
bin_PROGRAMS =
libexec_PROGRAMS =
libexec_SCRIPTS =
sbin_PROGRAMS =

# -----------------------------------------------------------------------------
#  Python

pyTESTS_PASSING = \
	dist/base1/test-base64.html \
	dist/base1/test-browser-storage.html \
	dist/base1/test-cache.html \
	dist/base1/test-chan.html \
	dist/base1/test-dbus-framed.html \
	dist/base1/test-echo.html \
	dist/base1/test-events.html \
	dist/base1/test-external.html \
	dist/base1/test-file.html \
	dist/base1/test-format.html \
	dist/base1/test-framed-cache.html \
	dist/base1/test-framed.html \
	dist/base1/test-http.html \
	dist/base1/test-journal-renderer.html \
	dist/base1/test-locale.html \
	dist/base1/test-location.html \
	dist/base1/test-metrics.html \
	dist/base1/test-no-jquery.html \
	dist/base1/test-permissions.html \
	dist/base1/test-promise.html \
	dist/base1/test-protocol.html \
	dist/base1/test-series.html \
	dist/base1/test-spawn.html \
	dist/base1/test-spawn-proc.html \
	dist/base1/test-user.html \
	dist/base1/test-utf8.html \
	dist/kdump/test-config-client.html \
	dist/networkmanager/test-utils.html \
	dist/storaged/test-util.html \
	$(NULL)

pyTESTS_FAILING = \
	dist/base1/test-websocket.html \
	$(NULL)

pyTESTS_HANGING = \
	dist/base1/test-dbus-address.html \
	dist/base1/test-dbus.html \
	$(NULL)

pyTESTS = $(pyTESTS_PASSING) $(pyTESTS_FAILING)

pycheck: cockpit-bridge.pyz
	$(MAKE) check XFAIL_TESTS='$(pyTESTS_FAILING)' TESTS='$(pyTESTS)' COCKPIT_BRIDGE=./cockpit-bridge.pyz

PYTHON_BRIDGE_FILES = \
	src/cockpit/__init__.py \
	src/cockpit/asyncstdio.py \
	src/cockpit/bridge.py \
	src/cockpit/channel.py \
	src/cockpit/channels/__init__.py \
	src/cockpit/channels/dbus.py \
	src/cockpit/channels/filesystem.py \
	src/cockpit/channels/http.py \
	src/cockpit/channels/metrics.py \
	src/cockpit/channels/packages.py \
	src/cockpit/channels/stream.py \
	src/cockpit/channels/trivial.py \
	src/cockpit/internal_endpoints.py \
	src/cockpit/packages.py \
	src/cockpit/peer.py \
	src/cockpit/protocol.py \
	src/cockpit/router.py \
	src/cockpit/samples.py \
	$(NULL)

SYSTEMD_CTYPES_STAMP = src/systemd_ctypes/__init__.py
SYSTEMD_CTYPES_REPO_URL = https://github.com/allisonkarlitskaya/systemd_ctypes
SYSTEMD_CTYPES_REPO_COMMIT = 1833c33b3846c974f0f8146023479f3d69e7746d

SYSTEMD_CTYPES_REPO_TREE = '$(strip $(SYSTEMD_CTYPES_REPO_COMMIT))^{tree}'
$(SYSTEMD_CTYPES_STAMP):
	@git -C '$(srcdir)' rev-list --quiet --objects $(SYSTEMD_CTYPES_REPO_TREE) -- 2>/dev/null || \
	    git -C '$(srcdir)' fetch --no-tags --no-write-fetch-head --depth=1 $(SYSTEMD_CTYPES_REPO_URL) $(SYSTEMD_CTYPES_REPO_COMMIT)
	@rm -rf src/systemd_ctypes
	@mkdir -p src
	$(AM_V_GEN) git -C '$(srcdir)' archive $(SYSTEMD_CTYPES_REPO_TREE) -- systemd_ctypes | tar --extract -C src

CLEANFILES += cockpit-bridge.pyz
cockpit-bridge.pyz: $(MANIFESTS) $(PYTHON_BRIDGE_FILES) $(SYSTEMD_CTYPES_STAMP)
	@rm -rf tmp/pyz
	@mkdir -p tmp/pyz
	@cp -r $(srcdir)/dist $(srcdir)/src/cockpit src/systemd_ctypes/ tmp/pyz
	$(AM_V_GEN) python3 -m zipapp --python /usr/bin/python3 --output $@ --main cockpit.bridge:main tmp/pyz
	@chmod a+x $@

.PHONY: pcc
# Python Cockpit Client testing target
pcc: cockpit-bridge.pyz
	ln -vsf "$(realpath $<)" ~/.local/bin/cockpit-bridge
	gapplication action org.cockpit_project.CockpitClient open-path '"=localhost"'

# -----------------------------------------------------------------------------
#  C

AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	-DDATADIR=\"$(datadir)\" \
	-DLIBEXECDIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	$(NULL)

AM_CFLAGS = \
	-pthread \
	-Wall \
	-Werror=strict-prototypes \
	-Werror=missing-prototypes \
	-Werror=implicit-function-declaration \
	-Werror=pointer-arith -Werror=init-self \
	-Werror=format=2 \
	-Werror=return-type \
	-Werror=missing-include-dirs \
	$(NULL)

BUILT_SOURCES =
bin_PROGRAMS =
libexec_PROGRAMS =
libexec_SCRIPTS =
sbin_PROGRAMS =

# -----------------------------------------------------------------------------
#  Python

# Will only be honoured if pytest-timeout plugin is installed
export PYTEST_TIMEOUT = 120

.PHONY: pytest
pytest: $(BUILT_SOURCES) $(MANIFESTS) $(SYSTEMD_CTYPES_STAMP)
	$(MAKE) test-server
	cd '$(srcdir)' && abs_builddir='$(abs_builddir)' pytest

.PHONY: pytest-cov
pytest-cov: $(BUILT_SOURCES) $(MANIFESTS) $(SYSTEMD_CTYPES_STAMP)
	$(MAKE) test-server
	cd '$(srcdir)' && abs_builddir='$(abs_builddir)' pytest --cov

PYTHON_BRIDGE_FILES = \
	src/cockpit/__init__.py \
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
	src/cockpit/transports.py \
	$(NULL)

SYSTEMD_CTYPES_STAMP = src/cockpit/_vendor/systemd_ctypes/__init__.py
$(SYSTEMD_CTYPES_STAMP):
	$(srcdir)/tools/systemd_ctypes

# -----------------------------------------------------------------------------
#  C

AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	-DDATADIR=\"$(datadir)\" \
	-DLIBEXECDIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	$(NULL)

AM_CFLAGS = \
	-std=gnu18 \
	-pthread \
	-Wall \
	-Werror=strict-prototypes \
	-Werror=missing-prototypes \
	-Werror=implicit-function-declaration \
	-Werror=implicit-int \
	-Werror=int-conversion \
	-Werror=old-style-definition \
	-Werror=pointer-arith \
	-Werror=init-self \
	-Werror=format=2 \
	-Werror=return-type \
	-Werror=missing-include-dirs \
	$(NULL)

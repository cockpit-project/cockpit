pkg_TESTS = \
	pkg/users/test-list-public-keys.sh \
	$(NULL)

TESTS += $(pkg_TESTS)

# Used for testing and the 'translate' playground
playgrounddir = $(pkgdatadir)/playground
playground_DATA = \
	dist/playground/po.extra.de.js \
	$(NULL)

dist/playground/extra.de.po: pkg/playground/extra.de.po
	$(COPY_RULE)

machinesincludedir = $(pkgdatadir)/machines/include
machinesinclude_DATA = \
	$(shell ls -1 $(srcdir)/node_modules/noVNC/include | grep ".*\.\(js\|css\|ttf\|woff\)" | sed -e 's/^/dist\/machines\/include\//') \
	$(NULL)

machinesincludechromedir = $(pkgdatadir)/machines/include/chrome-app
machinesincludechrome_DATA = \
	$(shell ls -1 $(srcdir)/node_modules/noVNC/include/chrome-app | grep ".*\.\(js\|css\|ttf\|woff\)" | sed -e 's/^/dist\/machines\/include\/chrome-app\//') \
	$(NULL)

dist/machines/include/chrome-app/%: node_modules/noVNC/include/chrome-app/%
	$(COPY_RULE)

dist/machines/include/%: node_modules/noVNC/include/%
	$(COPY_RULE)

EXTRA_DIST += \
	dist/playground/extra.de.po \
	pkg/playground/extra.de.po \
	pkg/users/mock \
	pkg/lib/qunit-template.html \
        $(shell ls -1 $(srcdir)/node_modules/noVNC/include | grep ".*\.\(js\|css\|ttf\|woff\)" | sed -e 's/^/node_modules\/noVNC\/include\//') \
        $(shell ls -1 $(srcdir)/node_modules/noVNC/include/chrome-app | grep ".*\.\(js\|css\|ttf\|woff\)" | sed -e 's/^/node_modules\/noVNC\/include\/chrome-app\//') \
        node_modules/noVNC/package.json \
	$(shell ls -1 $(srcdir)/node_modules/noVNC/include | grep ".*\.\(js\|css\|ttf\|woff\)" | sed -e 's/^/dist\/machines\/include\//') \
	$(shell ls -1 $(srcdir)/node_modules/noVNC/include/chrome-app | grep ".*\.\(js\|css\|ttf\|woff\)" | sed -e 's/^/dist\/machines\/include\/chrome-app\//') \
	$(playground_DATA) \
	$(pkg_TESTS)

if WITH_GOLANG

AM_V_GO = $(am__v_GO_@AM_V@)
am__v_GO_ = $(am__v_GO_@AM_DEFAULT_V@)
am__v_GO_0 = @echo "  GO      " $@;

GO_BUILD_RULE = \
	GOPATH=$(abs_srcdir)/pkg/kubernetes/standalone $(GOLANG) build \
		-ldflags "-B 0x"`head -c20 /dev/urandom|od -An -tx1|tr -d ' \n'` "$@"

COCKPIT_KUBE_HELPERS =	\
	pkg/kubernetes/standalone/src/cockpit-kube-auth/helpers/creds.go \
	pkg/kubernetes/standalone/src/cockpit-kube-auth/helpers/client.go \
	$(NULL)

COCKPIT_KUBE_AUTH = $(COCKPIT_KUBE_HELPERS) \
	pkg/kubernetes/standalone/src/cockpit-kube-auth/main.go \
	$(NULL)

COCKPIT_KUBE_LAUNCH = $(COCKPIT_KUBE_HELPERS) \
	pkg/kubernetes/standalone/src/cockpit-kube-launch/main.go \
	$(NULL)

cockpit-kube-auth$(EXEEXT): $(COCKPIT_KUBE_AUTH)
	$(AM_V_GO) $(GO_BUILD_RULE)

cockpit-kube-launch$(EXEEXT): $(COCKPIT_KUBE_LAUNCH)
	$(AM_V_GO) $(GO_BUILD_RULE)

libexec_PROGRAMS += cockpit-kube-auth cockpit-kube-launch

cockpit_kube_auth_SOURCES = $(COCKPIT_KUBE_AUTH)
cockpit_kube_launch_SOURCES = $(COCKPIT_KUBE_LAUNCH)

endif

pkg_TESTS = \
	pkg/docker/test-docker.html \
	pkg/kubernetes/tests/test-utils.html \
	pkg/kubernetes/tests/test-images.html \
	pkg/kubernetes/tests/test-volumes.html \
	pkg/kubernetes/tests/test-nodes.html \
	pkg/kubernetes/tests/test-connection.html \
	pkg/kubernetes/tests/test-kube-client.html \
	pkg/kubernetes/tests/test-tags.html \
	pkg/kubernetes/tests/test-projects.html \
	pkg/storaged/test-util.html \
	$(NULL)

TESTS += $(pkg_TESTS)

# HACK: https://github.com/storaged-project/storaged/pull/68
storageddir = $(pkgdatadir)/storaged
nodist_storaged_DATA = \
       pkg/storaged/override.json \
       $(NULL)

EXTRA_DIST += \
	pkg/storaged/override.json.in \
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

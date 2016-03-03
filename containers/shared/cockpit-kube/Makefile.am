if WITH_GOLANG

GO_BUILD_RULE = \
	GOPATH=$(abs_srcdir)/containers/shared/cockpit-kube $(GOLANG) build \
		-ldflags "-B 0x"`head -c20 /dev/urandom|od -An -tx1|tr -d ' \n'` "$@"

COCKPIT_KUBE_HELPERS =	\
	containers/shared/cockpit-kube/src/cockpit-kube-auth/helpers/creds.go	\
	containers/shared/cockpit-kube/src/cockpit-kube-auth/helpers/client.go	\
	$(NULL)

COCKPIT_KUBE_AUTH = $(COCKPIT_KUBE_HELPERS) \
	containers/shared/cockpit-kube/src/cockpit-kube-auth/main.go	\
	$(NULL)

COCKPIT_KUBE_LAUNCH = $(COCKPIT_KUBE_HELPERS) \
	containers/shared/cockpit-kube/src/cockpit-kube-launch/main.go	\
	$(NULL)

cockpit-kube-auth$(EXEEXT): $(COCKPIT_KUBE_AUTH)
	$(GO_BUILD_RULE)

cockpit-kube-launch$(EXEEXT): $(COCKPIT_KUBE_LAUNCH)
	$(GO_BUILD_RULE)

libexec_PROGRAMS += cockpit-kube-auth cockpit-kube-launch

cockpit_kube_auth_SOURCES = $(COCKPIT_KUBE_AUTH)
cockpit_kube_launch_SOURCES = $(COCKPIT_KUBE_LAUNCH)

endif

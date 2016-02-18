if WITH_GOLANG

GO_BUILD_RULE = \
	GOPATH=$(abs_srcdir)/images/shared/cockpit-kube $(GOLANG) build "$@"

COCKPIT_KUBE_HELPERS =	\
	images/shared/cockpit-kube/src/cockpit-kube-auth/helpers/creds.go	\
	images/shared/cockpit-kube/src/cockpit-kube-auth/helpers/client.go	\
	$(NULL)

COCKPIT_KUBE_AUTH = $(COCKPIT_KUBE_HELPERS) \
	images/shared/cockpit-kube/src/cockpit-kube-auth/main.go	\
	$(NULL)

COCKPIT_KUBE_LAUNCH = $(COCKPIT_KUBE_HELPERS) \
	images/shared/cockpit-kube/src/cockpit-kube-launch/main.go	\
	$(NULL)

cockpit-kube-auth$(EXEEXT): $(COCKPIT_KUBE_AUTH)
	$(GO_BUILD_RULE)

cockpit-kube-launch$(EXEEXT): $(COCKPIT_KUBE_LAUNCH)
	$(GO_BUILD_RULE)

libexec_PROGRAMS += cockpit-kube-auth cockpit-kube-launch

cockpit_kube_auth_SOURCES = $(COCKPIT_KUBE_AUTH)
cockpit_kube_launch_SOURCES = $(COCKPIT_KUBE_LAUNCH)

endif

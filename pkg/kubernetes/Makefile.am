
kubernetesdir = $(pkgdatadir)/kubernetes
nodist_kubernetes_DATA = \
	pkg/kubernetes/app.min.css.gz \
	pkg/kubernetes/index.min.html.gz \
	pkg/kubernetes/kubernetes.min.js.gz \
	$(NULL)
kubernetes_DATA = \
	pkg/kubernetes/manifest.json \
	$(NULL)

kubernetes_VIEWS = \
	pkg/kubernetes/views/containers-page.html \
	pkg/kubernetes/views/container-body.html \
	pkg/kubernetes/views/container-panel.html \
	pkg/kubernetes/views/dashboard-page.html \
	pkg/kubernetes/views/default-panel.html \
	pkg/kubernetes/views/deploymentconfig-panel.html \
	pkg/kubernetes/views/details-page.html \
	pkg/kubernetes/views/filter-bar.html \
	pkg/kubernetes/views/images-page.html \
	pkg/kubernetes/views/imagerepository-panel.html \
	pkg/kubernetes/views/pod-body.html \
	pkg/kubernetes/views/pod-panel.html \
	pkg/kubernetes/views/node-panel.html \
	pkg/kubernetes/views/replicationcontroller-panel.html \
	pkg/kubernetes/views/route-panel.html \
	pkg/kubernetes/views/service-panel.html \
	pkg/kubernetes/views/topology-page.html \
	$(NULL)

kubernetesdebugdir = $(debugdir)$(kubernetesdir)
kubernetesdebug_DATA = \
	pkg/kubernetes/adjust.js \
	pkg/kubernetes/app.css \
	pkg/kubernetes/app.js \
	pkg/kubernetes/client.js \
	pkg/kubernetes/config.js \
	pkg/kubernetes/containers.css \
	pkg/kubernetes/containers.js \
	pkg/kubernetes/container-terminal.js \
	pkg/kubernetes/container-terminal.css \
	pkg/kubernetes/dashboard.js \
	pkg/kubernetes/details.css \
	pkg/kubernetes/details.js \
	pkg/kubernetes/graphs.js \
	pkg/kubernetes/images.css \
	pkg/kubernetes/images.js \
	pkg/kubernetes/index.html \
	pkg/kubernetes/kubernetes.js \
	pkg/kubernetes/node.js \
	pkg/kubernetes/object-describer.js \
	pkg/kubernetes/deploy.js \
	pkg/kubernetes/revealable.css \
	pkg/kubernetes/topology.css \
	pkg/kubernetes/topology.js \
	pkg/kubernetes/topology-graph.css \
	pkg/kubernetes/topology-graph.js \
	pkg/kubernetes/nulecule.js \
	$(NULL)
kubernetesviewsdebugdir = $(debugdir)$(kubernetesdir)/views
kubernetesviewsdebug_DATA = \
	$(kubernetes_VIEWS) \
	$(NULL)

kubernetes_BUNDLE = \
	pkg/kubernetes/adjust.min.js \
	pkg/kubernetes/app.min.js \
	pkg/kubernetes/client.min.js \
	pkg/kubernetes/config.min.js \
	pkg/kubernetes/containers.min.js \
	pkg/kubernetes/dashboard.min.js \
	pkg/kubernetes/deploy.min.js \
	pkg/kubernetes/details.min.js \
	pkg/kubernetes/graphs.min.js \
	pkg/kubernetes/images.min.js \
	pkg/kubernetes/nulecule.min.js \
	pkg/kubernetes/node.min.js \
	pkg/kubernetes/object-describer.min.js \
	pkg/kubernetes/topology.min.js \
	pkg/kubernetes/topology-graph.min.js \
	pkg/kubernetes/container-terminal.min.js \
	pkg/kubernetes/templates.js \
	pkg/kubernetes/kubernetes.js \
	$(NULL)

# Bundles all the view templates into a $templateCache loadable
pkg/kubernetes/templates.js: $(kubernetes_VIEWS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/ngbundle -d kubernetes/app -o $@ $^

# Everything else into a nice big bundle
pkg/kubernetes/kubernetes.min.js: $(kubernetes_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

kubernetes_TESTS = \
	pkg/kubernetes/test-kubernetes.html \
	$(NULL)

TESTS += $(kubernetes_TESTS)

CLEANFILES += \
	pkg/kubernetes/app.min.css \
	pkg/kubernetes/index.min.html \
	pkg/kubernetes/kubernetes.min.js \
	$(kubernetes_BUNDLE) \
	$(nodist_kubernetes_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/kubernetes/app.min.css \
	pkg/kubernetes/index.min.html \
	pkg/kubernetes/kubernetes.min.js \
	$(kubernetes_BUNDLE) \
	$(NULL)

update-lib:: update-bower
	$(JSMODULE) -m -d base1/angular -o $(srcdir)/pkg/kubernetes/object-describer.js \
	    $(BOWER)/kubernetes-object-describer/dist/object-describer.js

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

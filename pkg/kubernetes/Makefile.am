# Shared files

shared_VIEWS = \
	pkg/kubernetes/views/filter-bar.html \
	pkg/kubernetes/views/filter-project.html \
	pkg/kubernetes/views/image-body.html \
	pkg/kubernetes/views/image-config.html \
	pkg/kubernetes/views/image-delete.html \
	pkg/kubernetes/views/image-meta.html \
	pkg/kubernetes/views/image-listing.html \
	pkg/kubernetes/views/image-page.html \
	pkg/kubernetes/views/image-panel.html \
	pkg/kubernetes/views/images-page.html \
	pkg/kubernetes/views/imagestream-body.html \
	pkg/kubernetes/views/imagestream-delete.html \
	pkg/kubernetes/views/imagestream-meta.html \
	pkg/kubernetes/views/imagestream-modify.html \
	pkg/kubernetes/views/imagestream-page.html \
	pkg/kubernetes/views/imagestream-panel.html \
	pkg/kubernetes/views/add-group-dialog.html \
	pkg/kubernetes/views/add-user-dialog.html \
	pkg/kubernetes/views/projects-page.html \
	pkg/kubernetes/views/project-modify.html \
	pkg/kubernetes/views/project-page.html \
	pkg/kubernetes/views/project-panel.html \
	pkg/kubernetes/views/project-listing.html \
	$(NULL)

shared_MODULES = \
	pkg/kubernetes/scripts/kube-client.js \
	pkg/kubernetes/scripts/kube-client-cockpit.js \
	pkg/kubernetes/scripts/date.js \
	pkg/kubernetes/scripts/dialog.js \
	pkg/kubernetes/scripts/images.js \
	pkg/kubernetes/scripts/layers.js \
	pkg/kubernetes/scripts/listing.js \
	pkg/kubernetes/scripts/projects.js \
	pkg/kubernetes/scripts/app.js \
	pkg/kubernetes/scripts/utils.js \
	$(NULL)

shared_LESS = \
	pkg/kubernetes/styles/variables-bootstrap.less \
	pkg/kubernetes/styles/variables-patternfly.less \
	pkg/kubernetes/styles/images.less \
	pkg/kubernetes/styles/layers.less \
	pkg/kubernetes/styles/projects.less \
	$(NULL)

# Registry files

registry_VIEWS = \
	pkg/kubernetes/views/registry-dashboard-page.html \
	$(NULL)

registry_MODULES = \
	pkg/kubernetes/scripts/registry.js \
	$(NULL)

registry_LESS = \
	pkg/kubernetes/styles/registry.less \
	pkg/kubernetes/styles/dropdown.less \
	pkg/kubernetes/styles/filter.less \
	pkg/kubernetes/styles/sidebar.less \
	$(NULL)

registry_MIN = \
	$(shared_MODULES:.js=.min.js) \
	$(registry_MODULES:.js=.min.js) \
	$(NULL)

registry_BUNDLE = \
	$(registry_MIN) \
	pkg/kubernetes/registry-templates.js \
	$(NULL)

# Bundles all the view templates into a $templateCache loadable
pkg/kubernetes/registry-templates.js: $(shared_VIEWS) $(registry_VIEWS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/ngbundle -m registry -o $@ $^

# Everything else into a nice big bundle
pkg/kubernetes/registry.min.js: $(registry_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Less is compiled correctly
pkg/kubernetes/registry.min.css: $(registry_LESS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/lessc --verbose $< $@

# Kubernetes files

kubernetes_VIEWS = \
	pkg/kubernetes/views/containers-page.html \
	pkg/kubernetes/views/container-body.html \
	pkg/kubernetes/views/container-panel.html \
	pkg/kubernetes/views/dashboard-page.html \
	pkg/kubernetes/views/default-panel.html \
	pkg/kubernetes/views/deploy.html \
	pkg/kubernetes/views/deploymentconfig-panel.html \
	pkg/kubernetes/views/details-page.html \
	pkg/kubernetes/views/file-button.html \
	pkg/kubernetes/views/item-delete.html \
	pkg/kubernetes/views/images-page.html \
	pkg/kubernetes/views/imagerepository-panel.html \
	pkg/kubernetes/views/pod-body.html \
	pkg/kubernetes/views/pod-panel.html \
	pkg/kubernetes/views/node-add.html \
	pkg/kubernetes/views/node-panel.html \
	pkg/kubernetes/views/replicationcontroller-panel.html \
	pkg/kubernetes/views/replicationcontroller-modify.html \
	pkg/kubernetes/views/route-panel.html \
	pkg/kubernetes/views/route-modify.html \
	pkg/kubernetes/views/service-modify.html \
	pkg/kubernetes/views/service-panel.html \
	pkg/kubernetes/views/topology-page.html \
	$(NULL)

kubernetes_MODULES = \
	pkg/kubernetes/scripts/containers.js \
	pkg/kubernetes/scripts/container-terminal.js \
	pkg/kubernetes/scripts/dashboard.js \
	pkg/kubernetes/scripts/details.js \
	pkg/kubernetes/scripts/graphs.js \
	pkg/kubernetes/scripts/main.js \
	pkg/kubernetes/scripts/object-describer.js \
	pkg/kubernetes/scripts/topology.js \
	pkg/kubernetes/scripts/topology-graph.js \
	$(NULL)

kubernetes_TESTS = \
	pkg/kubernetes/tests/test-kube-client.html \
	pkg/kubernetes/tests/test-images.html \
	pkg/kubernetes/tests/test-projects.html \
	$(NULL)

kubernetes_LESS = \
	pkg/kubernetes/styles/main.less \
	pkg/kubernetes/styles/app.less \
	pkg/kubernetes/styles/containers.less \
	pkg/kubernetes/styles/container-terminal.less \
	pkg/kubernetes/styles/details.less \
	pkg/kubernetes/styles/revealable.less \
	pkg/kubernetes/styles/topology.less \
	pkg/kubernetes/styles/topology-graph.less \
	$(NULL)

kubernetes_MIN = \
	$(shared_MODULES:.js=.min.js) \
	$(kubernetes_MODULES:.js=.min.js) \
	$(NULL)

kubernetes_BUNDLE = \
	$(kubernetes_MIN) \
	pkg/kubernetes/kubernetes-templates.js \
	$(NULL)

# Bundles all the view templates into a $templateCache loadable
pkg/kubernetes/kubernetes-templates.js: $(shared_VIEWS) $(kubernetes_VIEWS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/ngbundle -m kubernetes -o $@ $^

# Everything else into a nice big bundle
pkg/kubernetes/kubernetes.min.js: $(kubernetes_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Less compiled correctly
pkg/kubernetes/kubernetes.min.css: $(kubernetes_LESS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/lessc --verbose $< $@

kubernetes_DATA = \
	pkg/kubernetes/sparkle-placeholder.png \
	pkg/kubernetes/donut-placeholder.png \
	pkg/kubernetes/manifest.json \
	pkg/kubernetes/override.json \
	$(NULL)

kubernetesdir = $(pkgdatadir)/kubernetes
nodist_kubernetes_DATA = \
	pkg/kubernetes/kubernetes.min.css.gz \
	pkg/kubernetes/index.min.html.gz \
	pkg/kubernetes/kubernetes.min.js.gz \
	pkg/kubernetes/registry.min.html.gz \
	pkg/kubernetes/registry.min.js.gz \
	pkg/kubernetes/registry.min.css.gz \
	$(NULL)

kubernetesdebugdir = $(debugdir)$(kubernetesdir)
kubernetesdebug_DATA = \
	pkg/kubernetes/kubernetes.js \
	pkg/kubernetes/kubernetes.css \
	pkg/kubernetes/index.html \
	pkg/kubernetes/registry.js \
	pkg/kubernetes/registry.css \
	pkg/kubernetes/registry.html \
	pkg/kubernetes/less.js \
	$(NULL)

install-data-hook::
	mkdir -p $(DESTDIR)$(kubernetesdebugdir)
	tar -chf - -C $(srcdir) $(shared_LESS) $(shared_VIEWS) $(shared_MODULES) $(registry_VIEWS) $(registry_LESS) $(registry_MODULES) $(kubernetes_VIEWS) $(kubernetes_LESS) $(kubernetes_MODULES) | tar -xf - --strip-components=2 -C $(DESTDIR)$(kubernetesdebugdir)

uninstall-hook:
	rm -rf $(DESTDIR)$(kubernetesdebugdir)/scripts
	rm -rf $(DESTDIR)$(kubernetesdebugdir)/views
	rm -rf $(DESTDIR)$(kubernetesdebugdir)/styles


TESTS += $(kubernetes_TESTS)

CLEANFILES += \
	pkg/kubernetes/kubernetes.min.css\
	pkg/kubernetes/index.min.html \
	pkg/kubernetes/kubernetes.min.js \
	pkg/kubernetes/kubernetes-templates.js \
	pkg/kubernetes/registry.min.css \
	pkg/kubernetes/registry.min.html \
	pkg/kubernetes/registry.min.js \
	pkg/kubernetes/registry-templates.js \
	$(kubernetes_MIN) \
	$(registry_MIN) \
	$(nodist_kubernetes_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/kubernetes/kubernetes.min.css \
	pkg/kubernetes/index.min.html \
	pkg/kubernetes/kubernetes.min.js \
	pkg/kubernetes/kubernetes-templates.js \
	pkg/kubernetes/registry.min.css \
	pkg/kubernetes/registry.min.html \
	pkg/kubernetes/registry.min.js \
	pkg/kubernetes/registry-templates.js \
	pkg/kubernetes/scripts/kube-client-mock.js \
	pkg/kubernetes/tests/fixture-basic.js \
	pkg/kubernetes/tests/fixture-large.js \
	$(kubernetes_BUNDLE) \
	$(registry_BUNDLE) \
	$(shared_VIEWS) \
	$(shared_MODULES) \
	$(registry_VIEWS) \
	$(registry_LESS) \
	$(registry_MODULES) \
	$(kubernetes_VIEWS) \
	$(kubernetes_LESS) \
	$(kubernetes_MODULES) \
	$(NULL)

update-lib:: update-bower
	$(JSMODULE) -o $(srcdir)/pkg/kubernetes/scripts/object-describer.js \
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

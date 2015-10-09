
kubernetesdir = $(pkgdatadir)/kubernetes
nodist_kubernetes_DATA = \
	assets/kubernetes/app.min.css.gz \
	assets/kubernetes/index.min.html.gz \
	assets/kubernetes/kubernetes.min.js.gz \
	$(NULL)
kubernetes_DATA = \
	assets/kubernetes/manifest.json \
	$(NULL)

kubernetes_VIEWS = \
	assets/kubernetes/views/containers-page.html \
	assets/kubernetes/views/container-body.html \
	assets/kubernetes/views/container-panel.html \
	assets/kubernetes/views/dashboard-page.html \
	assets/kubernetes/views/default-panel.html \
	assets/kubernetes/views/deploymentconfig-panel.html \
	assets/kubernetes/views/details-page.html \
	assets/kubernetes/views/filter-bar.html \
	assets/kubernetes/views/images-page.html \
	assets/kubernetes/views/imagerepository-panel.html \
	assets/kubernetes/views/pod-body.html \
	assets/kubernetes/views/pod-panel.html \
	assets/kubernetes/views/node-panel.html \
	assets/kubernetes/views/replicationcontroller-panel.html \
	assets/kubernetes/views/route-panel.html \
	assets/kubernetes/views/service-panel.html \
	assets/kubernetes/views/topology-page.html \
	$(NULL)

kubernetesdebugdir = $(debugdir)$(kubernetesdir)
kubernetesdebug_DATA = \
	assets/kubernetes/adjust.js \
	assets/kubernetes/app.css \
	assets/kubernetes/app.js \
	assets/kubernetes/client.js \
	assets/kubernetes/config.js \
	assets/kubernetes/containers.css \
	assets/kubernetes/containers.js \
	assets/kubernetes/d3.js \
	assets/kubernetes/dashboard.js \
	assets/kubernetes/details.css \
	assets/kubernetes/details.js \
	assets/kubernetes/graphs.js \
	assets/kubernetes/images.css \
	assets/kubernetes/images.js \
	assets/kubernetes/index.html \
	assets/kubernetes/kubernetes.js \
	assets/kubernetes/node.js \
	assets/kubernetes/object-describer.js \
	assets/kubernetes/deploy.js \
	assets/kubernetes/revealable.css \
	assets/kubernetes/topology.css \
	assets/kubernetes/topology.js \
	assets/kubernetes/topology-graph.css \
	assets/kubernetes/topology-graph.js \
	assets/kubernetes/nulecule.js \
	$(NULL)
kubernetesviewsdebugdir = $(debugdir)$(kubernetesdir)/views
kubernetesviewsdebug_DATA = \
	$(kubernetes_VIEWS) \
	$(NULL)

kubernetes_MIN = \
	assets/kubernetes/adjust.min.js \
	assets/kubernetes/app.min.js \
	assets/kubernetes/client.min.js \
	assets/kubernetes/config.min.js \
	assets/kubernetes/containers.min.js \
	assets/kubernetes/dashboard.min.js \
	assets/kubernetes/deploy.min.js \
	assets/kubernetes/details.min.js \
	assets/kubernetes/graphs.min.js \
	assets/kubernetes/images.min.js \
	assets/kubernetes/nulecule.min.js \
	assets/kubernetes/node.min.js \
	assets/kubernetes/object-describer.min.js \
	assets/kubernetes/topology.min.js \
	assets/kubernetes/topology-graph.min.js \
	$(NULL)
kubernetes_BUNDLE = \
	assets/kubernetes/d3.min.js \
	$(kubernetes_MIN) \
	$(NULL)

# Bundles all the view templates into a $templateCache loadable
assets/kubernetes/templates.js: $(kubernetes_VIEWS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/ngbundle -d kubernetes/app -o $@ $^

# Everything else into a nice big bundle
assets/kubernetes/kubernetes.min.js: $(kubernetes_BUNDLE) assets/kubernetes/templates.js
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

kubernetes_TESTS = \
	assets/kubernetes/test-kubernetes.html \
	$(NULL)

TESTS += $(kubernetes_TESTS)

CLEANFILES += \
	assets/kubernetes/app.min.css \
	assets/kubernetes/index.min.html \
	assets/kubernetes/kubernetes.min.js \
	assets/kubernetes/templates.js \
	$(kubernetes_MIN) \
	$(nodist_kubernetes_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/kubernetes/app.min.css \
	assets/kubernetes/index.min.html \
	assets/kubernetes/kubernetes.min.js \
	assets/kubernetes/templates.js \
	$(kubernetes_BUNDLE) \
	$(kubernetes_DATA) \
	$(kubernetesdebug_DATA) \
	$(kubernetes_TESTS) \
	$(kubernetes_VIEWS) \
	assets/kubernetes/mock-basic.js \
	assets/kubernetes/mock-large.js \
	assets/kubernetes/d3.min.js \
	$(NULL)

update-lib:: update-bower
	$(JSMODULE) -m -d base1/angular -o $(srcdir)/assets/kubernetes/object-describer.js \
	    $(BOWER)/kubernetes-object-describer/dist/object-describer.js
	$(JSMODULE) -o $(srcdir)/assets/kubernetes/topology-graph.js \
		$(BOWER)/kubernetes-topology-graph/dist/topology-graph.js
	$(CSSBUNDLE) -o $(srcdir)/assets/kubernetes/topology-graph.css \
		$(BOWER)/kubernetes-topology-graph/dist/topology-graph.css
	$(JSMODULE) -o $(srcdir)/assets/kubernetes/d3.js \
		$(BOWER)/d3/d3.js
	$(JSMODULE) -o $(srcdir)/assets/kubernetes/d3.min.js \
		$(BOWER)/d3/d3.min.js

# Never recreate these files
assets/kubernetes/d3.min.js:
	@true

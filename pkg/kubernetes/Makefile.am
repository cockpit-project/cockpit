
kubernetesdir = $(pkgdatadir)/kubernetes
kubernetes_GZ = \
	pkg/kubernetes/app.min.css.gz \
	pkg/kubernetes/cluster.min.html.gz \
	pkg/kubernetes/kubernetes.min.js.gz \
	$(NULL)
kubernetes_DATA = \
	pkg/kubernetes/manifest.json \
	$(kubernetes_GZ) \
	$(NULL)

kubernetes_VIEWS = \
	pkg/kubernetes/views/container-panel.html \
	pkg/kubernetes/views/dashboard.html \
	pkg/kubernetes/views/details.html \
	pkg/kubernetes/views/listing.html \
	pkg/kubernetes/views/pod-panel.html \
	pkg/kubernetes/views/topology.html \
	$(NULL)

kubernetesdebugdir = $(debugdir)$(kubernetesdir)
kubernetesdebug_DATA = \
	pkg/kubernetes/adjust.js \
	pkg/kubernetes/app.css \
	pkg/kubernetes/app.js \
	pkg/kubernetes/client.js \
	pkg/kubernetes/cluster.html \
	pkg/kubernetes/config.js \
	pkg/kubernetes/d3.js \
	pkg/kubernetes/dashboard.js \
	pkg/kubernetes/details.css \
	pkg/kubernetes/details.js \
	pkg/kubernetes/graphs.js \
	pkg/kubernetes/kubernetes.js \
	pkg/kubernetes/listing.css \
	pkg/kubernetes/listing.js \
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

kubernetes_MIN = \
	pkg/kubernetes/adjust.min.js \
	pkg/kubernetes/app.min.js \
	pkg/kubernetes/client.min.js \
	pkg/kubernetes/config.min.js \
	pkg/kubernetes/dashboard.min.js \
	pkg/kubernetes/deploy.min.js \
	pkg/kubernetes/details.min.js \
	pkg/kubernetes/graphs.min.js \
	pkg/kubernetes/listing.min.js \
	pkg/kubernetes/nulecule.min.js \
	pkg/kubernetes/node.min.js \
	pkg/kubernetes/object-describer.min.js \
	pkg/kubernetes/topology.min.js \
	pkg/kubernetes/topology-graph.min.js \
	$(NULL)
kubernetes_BUNDLE = \
	pkg/kubernetes/d3.min.js \
	$(kubernetes_MIN) \
	$(NULL)

# Bundles all the view templates into a $templateCache loadable
pkg/kubernetes/templates.min.js: $(kubernetes_VIEWS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/ngbundle -d kubernetes/app -o $@ $^

# Everything else into a nice big bundle
pkg/kubernetes/kubernetes.min.js: $(kubernetes_BUNDLE) pkg/kubernetes/templates.min.js
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

kubernetes_TESTS = \
	pkg/kubernetes/test-kubernetes.html \
	$(NULL)

TESTS += $(kubernetes_TESTS)

CLEANFILES += \
	pkg/kubernetes/app.min.css \
	pkg/kubernetes/cluster.min.html \
	pkg/kubernetes/kubernetes.min.js \
	pkg/kubernetes/templates.min.js \
	$(kubernetes_MIN) \
	$(kubernetes_GZ) \
	$(NULL)

EXTRA_DIST += \
	pkg/kubernetes/cluster.min.html \
	pkg/kubernetes/kubernetes.min.js \
	pkg/kubernetes/templates.min.js \
	$(kubernetes_BUNDLE) \
	$(kubernetes_DATA) \
	$(kubernetesdebug_DATA) \
	$(kubernetes_TESTS) \
	$(kubernetes_VIEWS) \
	pkg/kubernetes/mock-basic.js \
	pkg/kubernetes/mock-large.js \
	pkg/kubernetes/d3.min.js \
	$(NULL)

update-lib:: update-bower
	$(JSMODULE) -m -d base1/angular -o $(srcdir)/pkg/kubernetes/object-describer.js \
	    $(BOWER)/kubernetes-object-describer/dist/object-describer.js
	$(JSMODULE) -o $(srcdir)/pkg/kubernetes/topology-graph.js \
		$(BOWER)/kubernetes-topology-graph/dist/topology-graph.js
	$(CSSBUNDLE) -o $(srcdir)/pkg/kubernetes/topology-graph.css \
		$(BOWER)/kubernetes-topology-graph/dist/topology-graph.css
	$(JSMODULE) -o $(srcdir)/pkg/kubernetes/d3.js \
		$(BOWER)/d3/d3.js
	$(JSMODULE) -o $(srcdir)/pkg/kubernetes/d3.min.js \
		$(BOWER)/d3/d3.min.js

# Never recreate these files
pkg/kubernetes/d3.min.js:
	@true

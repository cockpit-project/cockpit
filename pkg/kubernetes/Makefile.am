
kubernetesdir = $(pkgdatadir)/kubernetes
kubernetes_DATA = \
	pkg/kubernetes/app.min.css.gz \
	pkg/kubernetes/cluster.min.html.gz \
	pkg/kubernetes/kubernetes.min.js.gz \
	pkg/kubernetes/manifest.json \
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
	pkg/kubernetes/node.js \
	pkg/kubernetes/object-describer.js \
	pkg/kubernetes/deploy.js \
	pkg/kubernetes/revealable.css \
	pkg/kubernetes/topology.css \
	pkg/kubernetes/topology.js \
	pkg/kubernetes/topology-graph.css \
	pkg/kubernetes/topology-graph.js \
	$(NULL)

kubernetes_BUNDLE = \
	pkg/kubernetes/adjust.min.js \
	pkg/kubernetes/app.min.js \
	pkg/kubernetes/client.min.js \
	pkg/kubernetes/config.min.js \
	pkg/kubernetes/dashboard.min.js \
	pkg/kubernetes/deploy.min.js \
	pkg/kubernetes/details.min.js \
	pkg/kubernetes/d3.min.js \
	pkg/kubernetes/graphs.min.js \
	pkg/kubernetes/node.min.js \
	pkg/kubernetes/object-describer.min.js \
	pkg/kubernetes/topology.min.js \
	pkg/kubernetes/topology-graph.min.js \
	$(NULL)

pkg/kubernetes/kubernetes.min.js: $(kubernetes_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

kubernetes_TESTS = \
	pkg/kubernetes/test-kubernetes.html \
	$(NULL)

TESTS += $(kubernetes_TESTS)

CLEANFILES += \
	pkg/kubernetes/app.min.css \
	pkg/kubernetes/cluster.min.html \
	pkg/kubernetes/kubernetes.min.js \
	$(kubernetes_BUNDLE) \
	$(NULL)

EXTRA_DIST += \
	pkg/kubernetes/cluster.min.html \
	pkg/kubernetes/kubernetes.min.js \
	$(kubernetes_BUNDLE) \
	$(kubernetes_DATA) \
	$(kubernetesdebug_DATA) \
	$(kubernetes_TESTS) \
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

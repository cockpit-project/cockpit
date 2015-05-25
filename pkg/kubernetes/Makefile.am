
kubernetesdir = $(pkgdatadir)/kubernetes
kubernetes_DATA = \
	pkg/kubernetes/app.min.css.gz \
	pkg/kubernetes/cluster.min.html.gz \
	pkg/kubernetes/kubernetes.min.js.gz \
	pkg/kubernetes/manifest.json \
	pkg/kubernetes/deploy.min.js.gz \
	$(NULL)

kubernetesdebugdir = $(DBGDIR)$(kubernetesdir)
kubernetesdebug_DATA = \
	pkg/kubernetes/adjust.js \
	pkg/kubernetes/angular.js \
	pkg/kubernetes/app.css \
	pkg/kubernetes/app.js \
	pkg/kubernetes/client.js \
	pkg/kubernetes/cluster.html \
	pkg/kubernetes/config.js \
	pkg/kubernetes/d3.js \
	pkg/kubernetes/dashboard.js \
	pkg/kubernetes/graphs.js \
	pkg/kubernetes/kubernetes.js \
	pkg/kubernetes/node.js \
	pkg/kubernetes/deploy.js \
	$(NULL)

kubernetes_BUNDLE = \
	pkg/kubernetes/adjust.min.js \
	pkg/kubernetes/angular.min.js \
	pkg/kubernetes/app.min.js \
	pkg/kubernetes/client.min.js \
	pkg/kubernetes/config.min.js \
	pkg/kubernetes/dashboard.min.js \
	pkg/kubernetes/deploy.min.js \
	pkg/kubernetes/d3.min.js \
	pkg/kubernetes/graphs.min.js \
	pkg/kubernetes/node.min.js \
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
	pkg/kubernetes/angular.min.js \
	pkg/kubernetes/angular-config.js \
	pkg/kubernetes/d3.min.js \
	$(NULL)

update-lib:: update-bower
	$(srcdir)/tools/jsbundle $(srcdir)/pkg/kubernetes/angular.js \
	    $(BOWER)/angular/angular.js \
	    $(BOWER)/angular-route/angular-route.js \
	    $(srcdir)/pkg/kubernetes/angular-config.js
	$(srcdir)/tools/jsbundle $(srcdir)/pkg/kubernetes/angular.min.js \
	    $(BOWER)/angular/angular.min.js \
	    $(BOWER)/angular-route/angular-route.min.js \
	    $(srcdir)/pkg/kubernetes/angular-config.js
	cp $(BOWER)/d3/d3.js $(srcdir)/pkg/kubernetes/d3.js
	cp $(BOWER)/d3/d3.min.js $(srcdir)/pkg/kubernetes/d3.min.js

# Never recreate these files
pkg/kubernetes/angular.min.js:
	@true
pkg/kubernetes/d3.min.js:
	@true

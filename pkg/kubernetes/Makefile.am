
kubernetesdir = $(pkgdatadir)/kubernetes
kubernetes_DATA = \
	pkg/kubernetes/angular.js \
	pkg/kubernetes/angular.min.js \
	pkg/kubernetes/client.js \
	pkg/kubernetes/client.min.js \
	pkg/kubernetes/manifest.json \
	pkg/kubernetes/tool.html \
	$(NULL)

kubernetes_TESTS = \
	pkg/kubernetes/test-kubernetes.html \
	$(NULL)

TESTS += $(kubernetes_TESTS)

CLEANFILES += \
	pkg/kubernetes/client.min.js \
	$(NULL)

EXTRA_DIST += \
	$(kubernetes_DATA) \
	$(kubernetes_TESTS) \
	pkg/kubernetes/mock-basic.js \
	pkg/kubernetes/mock-large.js \
	pkg/kubernetes/angular-config.js \
	$(NULL)

update-lib::
	$(srcdir)/tools/jsmerge -o $(srcdir)/pkg/kubernetes/angular.js \
	    $(srcdir)/lib/angular.$(VX).js \
	    $(srcdir)/lib/angular-route.$(VX).js \
	    $(srcdir)/pkg/kubernetes/angular-config.js
	$(srcdir)/tools/jsmerge -o $(srcdir)/pkg/kubernetes/angular.min.js \
	    $(srcdir)/lib/angular.$(VX).min.js \
	    $(srcdir)/lib/angular-route.$(VX).min.js \
	    $(srcdir)/pkg/kubernetes/angular-config.js

# Never recreate these files
pkg/kubernetes/angular.min.js:
	@true

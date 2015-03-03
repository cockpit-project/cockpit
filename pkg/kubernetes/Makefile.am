
kubernetesdir = $(pkgdatadir)/kubernetes
kubernetes_DATA = \
	pkg/kubernetes/kubernetes.js \
	pkg/kubernetes/kubernetes.min.js \
	pkg/kubernetes/manifest.json \
	pkg/kubernetes/tool.html \
	$(NULL)

kubernetes_TESTS = \
	pkg/kubernetes/test-kubernetes.html \
	$(NULL)

TESTS += $(kubernetes_TESTS)

CLEANFILES += \
	pkg/kubernetes/kubernetes.min.js \
	$(NULL)

EXTRA_DIST += \
	$(kubernetes_DATA) \
	$(kubernetes_TESTS) \
	$(NULL)

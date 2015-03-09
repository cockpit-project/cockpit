
kubernetesdir = $(pkgdatadir)/kubernetes
kubernetes_DATA = \
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
	$(NULL)


kubernetes_FILES = \
	pkg/kubernetes/kubernetes.js \
	pkg/kubernetes/kubernetes.min.js \
	pkg/kubernetes/manifest.json \
	pkg/kubernetes/tool.html \
	$(NULL)

noinst_DATA += $(kubernetes_FILES)

kubernetes_TESTS = \
	pkg/kubernetes/test-kubernetes.html \
	$(NULL)

TESTS += $(kubernetes_TESTS)

CLEANFILES += \
	pkg/kubernetes/kubernetes.min.js \
	$(NULL)

EXTRA_DIST += \
	$(kubernetes_FILES) \
	$(kubernetes_TESTS) \
	$(NULL)

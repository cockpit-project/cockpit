
dockerdir = $(pkgdatadir)/docker
docker_DATA = \
	pkg/docker/console.min.html.gz \
	pkg/docker/docker.min.js.gz \
	pkg/docker/manifest.json \
	$(NULL)

dockerdebugdir = $(DBGDIR)$(dockerdir)
dockerdebug_DATA = \
	pkg/docker/docker.js \
	pkg/docker/console.html \
	$(NULL)

docker_TESTS = \
	pkg/docker/test-docker.html \
	$(NULL)

TESTS += $(docker_TESTS)

CLEANFILES += \
	pkg/docker/docker.min.js \
	pkg/docker/console.min.html \
	$(NULL)

EXTRA_DIST += \
	$(docker_DATA) \
	$(dockerdebug_DATA) \
	$(docker_TESTS) \
	$(NULL)


dockerdir = $(pkgdatadir)/docker
docker_DATA = \
	pkg/docker/docker.min.js \
	pkg/docker/console.min.html \
	pkg/docker/manifest.json \
	$(NULL)

dockerdebugdir = $(dockerdir)$(DBGDIR)
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
	$(docker_TESTS) \
	$(NULL)

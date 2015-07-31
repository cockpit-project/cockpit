
dockerdir = $(pkgdatadir)/docker
docker_GZ = \
	pkg/docker/console.min.html.gz \
	pkg/docker/docker.min.js.gz \
	$(NULL)
docker_DATA = \
	pkg/docker/manifest.json \
	$(docker_GZ) \
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
	$(docker_GZ) \
	$(NULL)

EXTRA_DIST += \
	$(docker_DATA) \
	$(dockerdebug_DATA) \
	$(docker_TESTS) \
	$(NULL)

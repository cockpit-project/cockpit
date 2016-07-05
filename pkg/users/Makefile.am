usersdir = $(pkgdatadir)/users
dist_users_DATA = \
	pkg/users/manifest.json \
	pkg/users/users.min.js \
	pkg/users/index.html \
	pkg/users/webpack.config.js \
	$(NULL)

users_BUNDLE = \
	pkg/users/ssh-add-public-key.sh \
	pkg/users/ssh-list-public-keys.sh \
	pkg/users/authorized-keys.js \
	pkg/users/local.js \
	$(NULL)

pkg/users/users.min.js: $(users_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/webpack \
		--config $(srcdir)/pkg/users/webpack.config.js \
		--context=$(srcdir)/pkg/users \
		--output-path=$(builddir)/pkg/users

users_TESTS = \
	pkg/users/test-list-public-keys.sh \
	$(NULL)

TESTS += $(users_TESTS)

CLEANFILES += \
	pkg/users/users.min.js \
	$(NULL)

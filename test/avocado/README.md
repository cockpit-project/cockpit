# Tests using Avocado

The rules for tests are a bit different:

 * One or more machines are dedicated to running all our tests: The
   machines are initialized specifically for this purpose, and will
   not be reused for anything else after all tests have been run.

 * A test runs as root directly in one of the machines dedicated to
   the test run.

 * A test is allowed to drastically modify the machine, as long as
   that doesn't break other tests.

 * The tests should aim to be independent from each other: Although a
   test run is deterministic and the tests are always run in the same
   order, implicit or explicit dependencies between tests should be
   avoided.  If they can't easily be avoided, they need to be
   documented, of course.

 * This means that tests should clean up after themselves, and restore
   the machine into the same configuration as it was before the test.

   Of course, a test should not aim for rootkit-level stealthiness: It
   can and should leave entries in the journal behind, etc.

More concretely:

 * When a test starts, the cockpit socket is already active, but
   cockpit itself is not running.  After a test, cockpit will be
   stopped.

 * A test is a Python file in this directory modeled after
   checkexample-foo.py.

 * Previously, we have combined multiple tests into one file, like
   check-storage, which has 12 tests in it.  Now we need to split them
   out into 12 individual Python files, maybe with a common support
   module.

 * Each test is a class derived from cockpit.Test, which in turn is
   derived from avocado.test.Test.

 * The test class normally shouldn't define the usual 'setup',
   'action', and 'cleanup' methods.

   Instead, it should define a 'test' method, and use
   cockpit.Test.atcleanup to register any cleanup actions it wants.
   The cockpit.Test class has some convenience functions such as
   'replace_file' that should make this easier.

 * If you do want to define 'setup' or 'cleanup', make sure to call
   cockpit.Test.setup and cockpit.Test.cleanup as appropriate as part
   of it.

 * Use 'self.browser' to get an instance of the old Browser class.  It
   works exactly as before.

 * The old 'self.allow_journal_messages' and
   'self.allowed_restart_messages' are also still there.

 * The old 'self.machine' is gone.  Use 'self.run_shell_command' or
   the more general 'avocado.utils.process'.  (But make sure to undo
   the actions.)

 * To change files, use 'self.replace_file'.  It will put the old
   content back during cleanup.

 * You can't use 'print' statements in the 'test' method.  Avocado
   swallows the output.  Use 'self.log.debug' or similar.

 * Use lib/var.env to pass information from setup.sh to the tests.  It
   contains, for example, the IP of the DNS server to use when
   discovering the default domain.

   In a test, use 'self.environment' to access it.

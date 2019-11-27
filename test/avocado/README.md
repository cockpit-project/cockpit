# Tests using Avocado

There are two types of tests:
 - **pure avocado** tests which are using [testlib](https://github.com/cockpit-project/cockpit/blob/master/test/common/testlib.py) and [testvm](https://github.com/cockpit-project/cockpit/blob/master/bots/machine/testvm.py) with [sizzle.js](https://www.npmjs.com/package/sizzle) CSS selector engine
 - **selenium** based tests which are using [seleniumlib.py](https://github.com/cockpit-project/cockpit/blob/master/test/avocado/testlib_avocado/seleniumlib.py) wrappers around [selenium](https://www.seleniumhq.org/)

Libraries are accessible in [testlib_avocado module](./testlib_avocado).

## How to run tests

The default way to run avocado tests is to use the [testing images](https://github.com/cockpit-project/cockpit/blob/master/bots/images/) that CI uses and test cockpit installation inside a test VM.

Currently, these tests run on Fedora 30. Other images don't have selenium and
avocado installed.

``` bash
$ test/image-prepare fedora-30 # Install code to test
```

Run the [run-tests script](https://github.com/cockpit-project/cockpit/blob/master/test/avocado/run-tests) changing the parameters accordingly for selenium vs pure avocado tests.

- For **pure avocado** tests: ``TEST_OS=fedora-30 test/avocado/run-tests``
- For **selenium** tests:
  - ``bots/image-download services # Download a VM image with pre-installed selenium``
  - ``TEST_OS=fedora-30 test/avocado/run-tests --selenium-tests --browser firefox -v``
 
Although this is the default way to run avocado tests the run-tests script is configurable and can be changed to run tests against different machines. This can be usefull for developing or debugging tests. Check bellow the HACKING section for more details.

## Hacking

### Selenium tests
[run-tests script](https://github.com/cockpit-project/cockpit/blob/master/test/avocado/run-tests) can change it's behavior by the environment variables specified bellow.

#### Where cockpit is running
Defines where is the cockpit instance that you want to test. This cannot be used together with ``TEST_OS`` variable.

 - ``GUEST`` (default: ``localhost``) - defines hostname or IP of the machine where cockpit-ws is running
   - This machine has to have enabled ssh for execution remote commands for purpose of ``self.machine.execute``
 - ``PORT`` (default: ``9090``) - defines the port where cockpit-ws component accepts connections in GUEST machine
 - ``URL_BASE`` (default: ``http``) - defines what protocol to use, http or https.

Leads to address ``URL_BASE//GUEST:PORT``

#### Where is selenium running
There are two ways to use selenium:
- Usage with remote drivers [grid](https://github.com/SeleniumHQ/selenium/wiki/Grid2)
- Direct usage of [local browsers](https://selenium-python.readthedocs.io/getting-started.html#using-selenium-to-write-tests)

The following environment variables can be used to configure selenium options in``run-tests`` script:
- ``HUB`` (default: ``localhost``) - location of selenium grid (on port ``4444``)
- ``LOCAL`` (default: ``no``) - if you set to ``yes``, it will use installed browsers directly
   - **WARN** - if ``LOCAL`` option set to ``yes`` ``HUB`` option is ignored

#### Which browser to use
It is possible to test 3 browsers - **Firefox, Google Chrome or Microsoft Edge**.
It is highly connected with previous section, depends what your `selenium grid` or your `local machine` supports and have installed or registered.
Browser selection can be done by ``BROWSER`` environment variable (default is ``firefox``).

``BROWSER`` variable can take one of the following values:
 - ``firefox`` - it will use Firefox as an browser
   - **WARN** please ensure that you have installed [gecko driver](https://github.com/mozilla/geckodriver) in your ``PATH``.
  New Firefox browsers are not working without this driver
 - ``chrome`` - Will use Google Chrome browser
 - ``edge`` - Will use Microsoft Edge browser

There are several possibilities how to do it:
 - Directly - Use **local browser** when used ``LOCAL=yes`` you have to have your browser browser installed
 - Via selenium **grid directly** (will register you local browser to hub on port ``4444``
```
$ java -jar selenium-server-standalone-2.44.0.jar -role hub
$ java -jar selenium-server-standalone-2.44.0.jar -role node  -hub
```
 - via **docker selenium grid** - it will redirect HUB port ``4444`` to your machine
```
$ docker run -d -p 4444:4444 --name selenium-hub selenium/hub
$ docker run -d --link selenium-hub:hub selenium/node-chrome
$ docker run -d --link selenium-hub:hub selenium/node-firefox
```

#### Other options
 - ``IDENTITY`` (default: ``testlib_avocado/identity`` symlink) - private key to run commands on ``GUEST`` machine to execute commands there via ``self.machine.execute``. Please do not use ``subprocess`` modules or similar way, because then commands will everytime runs locally not on defined machine.

### How run tests against local cockpit installation with local browser

#### Generic dependencies
When not using the selenium image the following dependencies need to be installed on the system.
```
sudo pip3 install selenium
sudo pip3 install avocado-framework
```

#### Firefox with gecko driver
```
sudo dnf install firefox
curl -L -f https://github.com/mozilla/geckodriver/releases/download/v0.23.0/geckodriver-v0.23.0-linux64.tar.gz > geckodriver.tar.gz
tar xzvf geckodriver.tar.gz
cp geckodriver /usr/local/bin
```

#### Other requirements
When not using selenium image you need to have the created an ``test`` user with credentials defined in [seleniumlib](https://github.com/cockpit-project/cockpit/blob/master/test/avocado/testlib_avocado/seleniumlib.py#L40)


**And finally run selected test(s)** ``LOCAL=yes BROWSER=firefox avocado-3 run test/avocado/selenium-base.py``


# How to write tests
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
   example-check-foo.py.

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

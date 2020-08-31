# Selenium tests using Avocado

These use [seleniumlib.py](https://github.com/cockpit-project/cockpit/blob/master/test/selenium/testlib_avocado/seleniumlib.py) wrappers around [selenium](https://www.seleniumhq.org/)

Libraries are accessible in [testlib_avocado module](./testlib_avocado).

## How to run tests

The default way to run selenium tests is to use the [testing images](https://github.com/cockpit-project/cockpit/blob/master/bots/images/) that CI uses and test cockpit installation inside a test VM.

Currently, these tests run on Fedora 31. Other images don't have selenium and
avocado installed.

``` bash
$ test/image-prepare fedora-32 # Install code to test
```

Run the [run-tests script](https://github.com/cockpit-project/cockpit/blob/master/test/selenium/run-tests) with appropriate parameters.

  - `bots/image-download services # Download a VM image with pre-installed selenium`
  - `TEST_OS=fedora-32 test/selenium/run-tests --browser firefox -v`

Although this is the default way to run selenium tests the run-tests script is configurable and can be changed to run tests against different machines. This can be useful for developing or debugging tests. Check bellow the HACKING section for more details.

### Debugging tests:
When running selenium tests with ``run-tests`` you can debug them in the following ways.
  - Run just selected (one or more) tests via listing them on the command line, tests are relative to ``test/selenium/`` directory (for example: ``TEST_OS=fedora-32 test/selenium/run-tests --browser firefox -v selenium-base.py``) test filename is relative to ``test/selenium/`` directory
  - Pass ``--sit`` parameter to ``run-tests`` which will leave all test machines running after the tests finish.
  - Use own selenium grid via option ``--hub``

#### Use selenium grid in container
Start own selenium grid in container ([Original description](https://github.com/SeleniumHQ/docker-selenium#debugging)).

  - Create selenium grid with chrome browser with VNC enabled (you can replace it by firefox and change commands according to that):
    ```
    podman run --rm -p 4444:4444 -p 5555:5900 -v /dev/shm:/dev/shm selenium/standalone-chrome-debug
    ```
  - Start VNC session to that machine (password is ``secret``):
    ```
    vncviewer 127.0.0.1:5555
    ```
  - Enable port forwarding of port ``127.0.0.2:9091`` to publicly accessible address, because selenium hub in podman container will have trouble to contact host port because it is forwarded right to ``127.0.0.2``. ``YOUR_IP`` is the hostname or IP address of your machine, that the selenium ``HUB`` will be able to access.
    ```
    ssh -L $YOUR_IP:9991:127.0.0.2:9091 $(whoami)@localhost
    ```
  - Run the test. ``HUB_IP`` is IP address of your selenium grid, has to be able to see cockpit instance via port 9991 on ``GUEST_IP``
    ```
    test/selenium/run-tests --hub $HUB_IP:$GUEST_IP:9991 -v -b chrome selenium-base.py --sit
    ```

#### Selenium grid on your machine with your local browsers
Steps are described in [selenium page](https://www.browserstack.com/guide/selenium-grid-tutorial)
  - Download selenium standalone:
    ```
    curl -f -L https://selenium-release.storage.googleapis.com/3.141/selenium-server-standalone-3.141.59.jar > selenium.jar
    ```
  - Run hub and attach the browsers here:
    ```
    java -jar selenium.jar -role hub
    ```
    - Then attach your local browsers there. You have browsers, for example, firefox or chrome installed, and also ensure you have proper [selenium drivers for the selected the browser](https://github.com/cockpit-project/cockpit/tree/master/test/selenium#which-browser-to-use)
      ```
      java -jar selenium.jar -role node -hub https://localhost:4444/grid/register
      ```
  - Run the test. ``HUB_IP`` is the IP address of your selenium grid
    ```
    test/selenium/run-tests --hub $HUB_IP -v -b chrome selenium-base.py --sit
    ```
#### Reschedule the the test/s again
It is possible to reschedule tests if you used ``--sit`` option for ``run-tests``, in case of failure, machines won't be destroyed.
Command-line options depend on which selenium grid you used.
It is described on the output of the ``run-tests`` script. For example:

```
$test/selenium/run-tests --hub $HUB_IP -v -b chrome selenium-navigate.py --sit

...
To rerun tests connect to VM with avocado installed via
    ssh -p 2202 root@127.0.0.2

and run the command
    PYTHONPATH=/tmp/avocado_library HUB=$HUB_IP_ADDR GUEST=127.0.0.2
PORT=9091 SSH_PORT=22 SSH_GUEST=10.111.113.1 BROWSER=chrome timeout 297
python3 -m avocado run --show-job-log /tmp/avocado_tests/selenium-navigate.py:NavigateTestSuite.testNavigateNoReload 2>&1
```

It is possible also to run the tests on your machine, without test VM (bots/images) that contains the installed avocado testing framework.
  - You have to install the avocado framework for python3 (for example via pip: ``pip3 install avocado-framework``)
  - Then a little bit modify command what you see on the output of the ``run-tests`` command and it depends how you run the selenium grid.
    ```
    HUB=$HUB_IP GUEST=$GUEST_IP PORT=9991 SSH_PORT=2021 SSH_GUEST=127.0.0.2 BROWSER=chrome python3 -m avocado --show=test run  test/selenium/selenium-navigate.py
    ```
   - **Remember**
     - An avocado runner is:
       - for ``run-tests`` script it is dedicated VM (different from ``GUEST`` and is not configurable from outside this script)
       - but could be your machine, or anywhere, in case it can fulfill the next conditions
     - ``GUEST`` has to be accessible via port ``PORT`` from the ``HUB``
     - ``HUB``  has to be accessible via port ``4444`` from the avocado runner
     - ``SSH_GUEST`` has to be accessible via port ``SSH_PORT`` from avocado runner (``GUEST`` and ``SSH_GUEST`` is the same machine, but may have another address, because of port forwarding and ``HUB`` location)
 

##### Description of example output

  - ``PYTHONPATH=/tmp/avocado_library`` - path to libraries
  - ``HUB=$HUB_IP_ADDR`` - IP address of your selenium grid
  - ``GUEST=127.0.0.2`` - IP address of cockpit machine (``HUB`` has to see ``GUEST`` cockpit port)
  - ``PORT=9091`` - port of cockpit machine on ``GUEST`` IP address
  - ``SSH_PORT=22`` - ssh port number on ``SSH_GUEST``
  - ``SSH_GUEST=10.111.113.1`` - guest ip how to connect to ssh (``GUEST`` has to be able to connect ``SSH_GUEST:SSH_PORT``)
  - ``BROWSER=chrome`` - name of browser to use (possible options: ``chrome, firefox, edge``)
  - ``timeout 297`` - timeout to kill the ``avocado`` process (could be removed in case of manual rescheduling)
  - ``python3 -m avocado run --show-job-log`` - avocado test scheduler (in case you have newer avocado (>70.0) there is little bit different sytanx ``python3 -m avocado --show=test run ``)
  - ``/tmp/avocado_tests/selenium-navigate.py:NavigateTestSuite.testNavigateNoReload`` name of test, it consists of ``filename_path:Class_name.tests_method_name``
  - ``2>&1`` - could be removed in case of manual rescheduling

## Hacking

### Selenium tests
[run-tests script](https://github.com/cockpit-project/cockpit/blob/master/test/selenium/run-tests) can change its behavior by the environment variables specified bellow.

#### Where cockpit is running
Defines where is the cockpit instance that you want to test. This cannot be used together with the ``TEST_OS`` variable.

 - ``GUEST`` (default: ``localhost``) - defines hostname or IP of the machine where cockpit-ws is running
   - This machine has to have enabled ssh for execution remote commands for purpose of ``self.machine.execute``
 - ``PORT`` (default: ``9090``) - defines the port where cockpit-ws component accepts connections in GUEST machine
 - ``URL_BASE`` (default: ``http``) - defines what protocol to use, http or https.
 - ``SSH_GUEST`` (default: same as ``GUEST``) - define name or ip of cockpit machine, it is important for the ``run-tests`` scheduler for debugging, where is used port forwarding
 - ``SSH_PORT`` (default: ``22``) - use another port to connect to cockpit machine

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
It is highly connected with the previous section, depends what your `selenium grid` or your `local machine` supports and has installed or registered.
Browser selection can be done by the ``BROWSER`` environment variable (default is ``firefox``).

``BROWSER`` variable can take one of the following values:
 - ``firefox`` - it will use Firefox as a browser
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
 - ``IDENTITY`` (default: ``testlib_avocado/identity`` symlink) - private key to run commands on ``GUEST`` machine to execute commands there via ``self.machine.execute``. Please do not use ``subprocess`` modules or similar way, because then commands will every time run locally not on defined machine.

### How to run tests against local cockpit installation with local browser

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
When not using selenium image you need to have the created an ``test`` user with credentials defined in [seleniumlib](https://github.com/cockpit-project/cockpit/blob/master/test/selenium/testlib_avocado/seleniumlib.py#L40)


**And finally run selected test(s)** ``LOCAL=yes BROWSER=firefox avocado-3 run test/selenium/selenium-base.py``


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
   the test run is deterministic and the tests are always run in the same order, implicit or explicit dependencies between tests should be avoided.  If they can't easily be avoided, they need to be
   documented, of course.

 * This means that tests should clean up after themselves, and restore
   the machine into the same configuration as it was before the test.

   Of course, a test should not aim for rootkit-level stealthiness: It
   can and should leave entries in the journal behind, etc.

More concretely:

 * When a test starts, the cockpit socket is already active, but
   the cockpit itself is not running.  After a test, the cockpit will be
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

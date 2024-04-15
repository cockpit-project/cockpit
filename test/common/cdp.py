import abc
import fcntl
import glob
import json
import os
import random
import resource
import shutil
import subprocess
import sys
import tempfile
import time
import typing
import urllib.request
from urllib.error import URLError

TEST_DIR = os.path.normpath(os.path.dirname(os.path.realpath(os.path.join(__file__, ".."))))


class Browser(abc.ABC):
    # The name of the browser
    NAME: str
    # The executable names available for the browser
    EXECUTABLES: typing.List[str]
    # The filename of the cdp driver JS file
    CDP_DRIVER_FILENAME: str

    @property
    def name(self):
        return self.NAME

    def find_exe(self):
        """Try to find the path of the browser, or None if not found."""
        for name in self.EXECUTABLES:
            exe = shutil.which(name)
            if exe is not None:
                return exe
        return None

    @abc.abstractmethod
    def _path(self, show_browser):
        """Return the path of the browser if available, or None.

        Reimplement this in subclasses, so it is easier to return None
        than to raise the proper exception (done at once in path()).
        """

    def path(self, show_browser):
        """Return the path of the browser, if available.

        In case it is not found, this raises SystemError.
        """
        p = self._path(show_browser)
        if p is not None:
            return p
        raise SystemError(f"{self.name} is not installed")

    @abc.abstractmethod
    def cmd(self, cdp_port, env, show_browser, browser_home, download_dir):
        pass


class Chromium(Browser):
    NAME = "chromium"
    EXECUTABLES = ["chromium-browser", "chromium", "google-chrome", "chromium-freeworld"]
    CDP_DRIVER_FILENAME = f"{TEST_DIR}/common/chromium-cdp-driver.js"

    def _path(self, show_browser):
        """Return path to chromium browser.

        Support the following locations:
         - /usr/lib*/chromium-browser/headless_shell (chromium-headless RPM)
         - the executables in self.EXECUTABLES available in $PATH (distro package)
         - node_modules/chromium/lib/chromium/chrome-linux/chrome (npm install chromium)
        """

        # If we want to have interactive chromium, we don't want to use headless_shell
        if not show_browser:
            g = glob.glob("/usr/lib*/chromium-browser/headless_shell")
            if g:
                return g[0]

        p = self.find_exe()
        if p:
            return p

        p = os.path.join(os.path.dirname(TEST_DIR), "node_modules/chromium/lib/chromium/chrome-linux/chrome")
        if os.access(p, os.X_OK):
            return p

        return None

    def cmd(self, cdp_port, env, show_browser, browser_home, download_dir):
        exe = self.path(show_browser)

        return [exe, "--headless" if not show_browser else "",
                "--no-sandbox", "--disable-setuid-sandbox",
                "--disable-namespace-sandbox", "--disable-seccomp-filter-sandbox",
                "--disable-sandbox-denial-logging", "--disable-pushstate-throttle",
                "--font-render-hinting=none",
                "--v=0", f"--remote-debugging-port={cdp_port}", "about:blank"]


class Firefox(Browser):
    NAME = "firefox"
    EXECUTABLES = ["firefox-developer-edition", "firefox-nightly", "firefox"]
    CDP_DRIVER_FILENAME = f"{TEST_DIR}/common/firefox-cdp-driver.js"

    def _path(self, show_browser):
        """Return path to Firefox browser."""
        return self.find_exe()

    def cmd(self, cdp_port, env, show_browser, browser_home, download_dir):
        exe = self.path(show_browser)

        subprocess.check_call([exe, "--headless", "--no-remote", "-CreateProfile", "blank"], env=env)
        profile = glob.glob(os.path.join(browser_home, ".mozilla/firefox/*.blank"))[0]

        with open(os.path.join(profile, "user.js"), "w") as f:
            f.write(f"""
                user_pref("remote.enabled", true);
                user_pref("remote.frames.enabled", true);
                user_pref("app.update.auto", false);
                user_pref("datareporting.policy.dataSubmissionEnabled", false);
                user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
                user_pref("dom.disable_beforeunload", true);
                user_pref("browser.download.dir", "{download_dir}");
                user_pref("browser.download.folderList", 2);
                user_pref("signon.rememberSignons", false);
                user_pref("dom.navigation.locationChangeRateLimit.count", 9999);
                // HACK: https://bugzilla.mozilla.org/show_bug.cgi?id=1746154
                user_pref("fission.webContentIsolationStrategy", 0);
                user_pref("fission.bfcacheInParent", false);
                """)

        with open(os.path.join(profile, "handlers.json"), "w") as f:
            f.write('{'
                    '"defaultHandlersVersion":{"en-US":4},'
                    '"mimeTypes":{"application/xz":{"action":0,"extensions":["xz"]}}'
                    '}')

        cmd = [exe, "-P", "blank", f"--remote-debugging-port={cdp_port}", "--no-remote", "localhost"]
        if not show_browser:
            cmd.insert(3, "--headless")
        return cmd


def get_browser(browser):
    browser_classes = [
        Chromium,
        Firefox,
    ]
    for klass in browser_classes:
        if browser == klass.NAME:
            return klass()
    raise SystemError(f"Unsupported browser: {browser}")


def jsquote(obj):
    return json.dumps(obj)


class CDP:
    def __init__(self, lang=None, verbose=False, trace=False, inject_helpers=None, start_profile=False):
        self.lang = lang
        self.timeout = 15
        self.valid = False
        self.verbose = verbose
        self.trace = trace
        self.inject_helpers = inject_helpers or []
        self.start_profile = start_profile
        self.browser = get_browser(os.environ.get("TEST_BROWSER", "chromium"))
        self.show_browser = bool(os.environ.get("TEST_SHOW_BROWSER", ""))
        self.download_dir = tempfile.mkdtemp()
        self._driver = None
        self._browser = None
        self._browser_home = None
        self._cdp_port_lockfile = None

    def invoke(self, fn, **kwargs):
        """Call a particular CDP method such as Runtime.evaluate

        Use command() for arbitrary JS code.
        """
        trace = self.trace and not kwargs.get("no_trace", False)
        try:
            del kwargs["no_trace"]
        except KeyError:
            pass

        cmd = fn + "(" + json.dumps(kwargs) + ")"

        # frame support for Runtime.evaluate(): map frame name to
        # executionContextId and insert into argument object; this must not be quoted
        # see "Frame tracking" in cdp-driver.js for how this works
        if fn == 'Runtime.evaluate':
            cmd = "%s, contextId: getFrameExecId(%s)%s" % (cmd[:-2], jsquote(self.cur_frame), cmd[-2:])

        waitPageLoad = fn in ['Page.navigate', 'Page.reload']

        if trace:
            print("-> " + kwargs.get('trace', cmd) + (" (with waitPageLoad)" if waitPageLoad else ""))

        if waitPageLoad:
            self.command(f"client.setupPageLoadHandler({self.timeout})")

        # avoid having to write the "client." prefix everywhere
        cmd = "client." + cmd
        res = self.command(cmd)
        if trace:
            if res and "result" in res:
                print("<- " + repr(res["result"]))
            else:
                print("<- " + repr(res))

        if waitPageLoad:
            res = self.command("client.pageLoadPromise")
            if trace:
                print("<- pageLoadPromise " + repr(res))
        return res

    def command(self, cmd):
        if not self._driver:
            self.start()
        self._driver.stdin.write(cmd.encode("UTF-8"))
        self._driver.stdin.write(b"\n")
        self._driver.stdin.flush()
        line = self._driver.stdout.readline().decode("UTF-8")
        if not line:
            self.kill()
            raise RuntimeError("CDP broken")
        try:
            res = json.loads(line)
        except ValueError:
            print(line.strip())
            raise

        if "error" in res:
            if self.trace:
                print("<- raise %s" % str(res["error"]))
            raise RuntimeError(res["error"])
        return res["result"]

    def claim_port(self, port):
        f = None
        try:
            f = open(os.path.join(tempfile.gettempdir(), ".cdp-%i.lock" % port), "w")
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._cdp_port_lockfile = f
            return True
        except (IOError, OSError):
            if f:
                f.close()
            return False

    def find_cdp_port(self):
        """Find an unused port and claim it through lock file"""

        for _ in range(100):
            # don't use the default CDP port 9222 to avoid interfering with running browsers
            port = random.randint(9223, 10222)
            if self.claim_port(port):
                return port

        raise RuntimeError("unable to find free port")

    def start(self):
        environ = os.environ.copy()
        if self.lang:
            environ["LC_ALL"] = self.lang
        self.cur_frame = None

        # allow attaching to external browser
        cdp_port = None
        if "TEST_CDP_PORT" in os.environ:
            p = int(os.environ["TEST_CDP_PORT"])
            if self.claim_port(p):
                # can fail when a test starts multiple browsers; only show the first one
                cdp_port = p

        if not cdp_port:
            # start browser on a new port
            cdp_port = self.find_cdp_port()
            self._browser_home = tempfile.mkdtemp()
            environ = os.environ.copy()
            environ["HOME"] = self._browser_home
            environ["LC_ALL"] = "C.UTF-8"
            # this might be set for the tests themselves, but we must isolate caching between tests
            try:
                del environ["XDG_CACHE_HOME"]
            except KeyError:
                pass

            cmd = self.browser.cmd(cdp_port, environ, self.show_browser,
                                   self._browser_home, self.download_dir)

            # sandboxing does not work in Docker container
            self._browser = subprocess.Popen(
                cmd, env=environ, close_fds=True,
                preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_CORE, (0, 0)))
            if self.verbose:
                sys.stderr.write("Started %s (pid %i) on port %i\n" % (cmd[0], self._browser.pid, cdp_port))

        # wait for CDP to be up and have at least one target
        for _ in range(120):
            try:
                res = urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json/list", timeout=5)
                if res.getcode() == 200 and json.loads(res.read()):
                    break
            except URLError:
                pass
            time.sleep(0.5)
        else:
            raise RuntimeError('timed out waiting for browser to start')

        # now start the driver
        if self.trace:
            # enable frame/execution context debugging if tracing is on
            environ["TEST_CDP_DEBUG"] = "1"

        self._driver = subprocess.Popen([self.browser.CDP_DRIVER_FILENAME, str(cdp_port)],
                                        env=environ,
                                        stdout=subprocess.PIPE,
                                        stdin=subprocess.PIPE,
                                        close_fds=True)
        self.valid = True

        for inject in self.inject_helpers:
            with open(inject) as f:
                src = f.read()
            # HACK: injecting sizzle fails on missing `document` in assert()
            src = src.replace('function assert( fn ) {', 'function assert( fn ) { if (true) return true; else ')
            # HACK: sizzle tracks document and when we switch frames, it sees the old document
            # although we execute it in different context.
            src = src.replace('context = context || document;', 'context = context || window.document;')
            self.invoke("Page.addScriptToEvaluateOnNewDocument", source=src, no_trace=True)

        if self.start_profile:
            self.invoke("Profiler.enable")
            self.invoke("Profiler.startPreciseCoverage", callCount=False, detailed=True)

    def kill(self):
        self.valid = False
        self.cur_frame = None
        if self._driver:
            self._driver.stdin.close()
            self._driver.wait()
            self._driver = None

        shutil.rmtree(self.download_dir, ignore_errors=True)

        if self._browser:
            if self.verbose:
                sys.stderr.write("Killing browser (pid %i)\n" % self._browser.pid)
            try:
                self._browser.terminate()
            except OSError:
                pass  # ignore if it crashed for some reason
            self._browser.wait()
            self._browser = None
            shutil.rmtree(self._browser_home, ignore_errors=True)
            os.remove(self._cdp_port_lockfile.name)
            self._cdp_port_lockfile.close()

    def set_frame(self, frame):
        self.cur_frame = frame
        if self.trace:
            print("-> switch to frame %s" % frame)

    def get_js_log(self):
        """Return the current javascript console log"""

        if self.valid:
            # needs to be wrapped in Promise
            messages = self.command("Promise.resolve(messages)")
            return ["%s: %s" % tuple(m) for m in messages]
        return []

    def read_log(self):
        """Returns an iterator that produces log messages one by one.

        Blocks if there are no new messages right now."""

        if not self.valid:
            yield []
            return

        while True:
            messages = self.command("waitLog()")
            for m in messages:
                yield m

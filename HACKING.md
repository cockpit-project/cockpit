Tips for hacking on libvirt-dbus
================================

Here is where to get code:

```
$ git clone https://libvirt.org/git/libvirt-dbus.git
```

Alternatively you can use one of the mirrors:

[https://github.com/libvirt/libvirt-dbus](https://github.com/libvirt/libvirt-dbus)
[https://gitlab.com/libvirt/libvirt-dbus](https://gitlab.com/libvirt/libvirt-dbus)


Running from git repository
---------------------------

  * The first step is to run autoreconf to create configure script:

    ```
    ./autogen.sh
    ```

    Now you can compile libvirt-dbus:

    ```
    make
    ```


  * Before posting a patch, you should run tests:

    ```
    make check
    ```

    The test tool requires python3 and python3-dbus.


  * To run libvirt-dbus directly from the build dir without installing it
    use the run script:

    ```
    ./run ./src/libvirt-dbus
    ```


Coding style rules
------------------

  * Opening & closing braces for functions should be at start of line:

    ```
    int
    foo(int bar)
    {
        ...
    }
    ```

    Not

    ```
    int
    foo(int bar) {
        ...
    }
    ```

  * Opening brace for if/while/for loops should be at the end of line:

    ```
    if (foo) {
        bar;
        wizz;
    }
    ```

    Not

    ```
    if (foo)
    {
        bar;
        wizz;
    }
    ```

    Rationale: putting every if/while/for opening brace on a new line
    expands function length too much.


  * If a brace needs to be used for one clause in an if/else statement,
    it should be used for both clauses, even if the other clauses are
    only single statements. eg:

    ```
    if (foo) {
        bar;
        wizz;
    } else {
        eek;
    }
    ```

    Not

    ```
    if (foo) {
        bar;
        wizz;
    } else
        eek;
    ```


  * Function parameter attribute annotations should follow the parameter
    name, eg:

    ```
    int
    foo(int bar G_GNUC_UNUSED)
    {
    }
    ```

    Not

    ```
    int
    foo(G_GNUC_UNUSED int bar)
    {
    }
    ```

    Rationale: Adding / removing G_GNUC_UNUSED  should not cause the
    rest of the line to move around since that obscures diffs.


  * There should be no space between function names & open brackets eg:

    ```
    int
    foo(int bar)
    {
    }
    ```

    Not

    ```
    int
    foo (int bar)
    {
    }
    ```


  * To keep lines under 80 characters (where practical), multiple parameters
    should be on new lines. Do not attempt to line up parameters vertically eg:

    ```
    int
    foo(int bar,
        unsigned long wizz)
    {
    }
    ```

    Not

    ```
    int
    foo(int bar, unsigned long wizz)
    {
    }
    ```

    Not

    ```
    int
    foo(int           bar,
        unsigned long wizz)
    {
    }
    ```

    Rationale: attempting vertical alignment causes bigger diffs when
    modifying code if type names change causing whitespace re-alignment.

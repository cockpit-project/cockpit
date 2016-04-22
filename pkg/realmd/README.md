Developing the realmd component
-------------------------------

This adds functionality to Cockpit to join an AD or IPA domain.

Running a test domain
---------------------

To contribute to this component, and run a test domain which ends
up being rather easy. Install the stuff in ```test/README``` near the
top. And then do the following:

    $ sudo test/vm-prep
    $ sudo test/vm-run ipa

That runs an IPA domain. Now in another terminal do the following:

    $ sudo /bin/sh -c "echo -e 'domain cockpit.lan\nsearch cockpit.lan\nnameserver 10.111.112.100\n' > /etc/resolv.conf"

Make sure this works:

    $ realm discover cockpit.lan

And now you're ready to use the feature. There's an account called
"admin" with the password "foobarfoo".

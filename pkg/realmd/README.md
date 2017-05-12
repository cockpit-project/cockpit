Developing the realmd component
-------------------------------

This adds functionality to Cockpit to join an AD or IPA domain.

Some features of Cockpit require a domain to test. Cockpit should work
with either Active Directory or IPA.

### Running a test domain

To contribute to this component, run a test domain which ends
up being rather easy. Install the stuff in ```test/README``` near the
top. And then do the following:

    $ sudo bots/image-prep
    $ bots/image-run ipa

That runs an IPA domain. Now in another terminal do the following:

    $ sudo /bin/sh -c "echo -e 'domain cockpit.lan\nsearch cockpit.lan\nnameserver 10.111.112.100\n' > /etc/resolv.conf"

Make sure this works:

    $ realm discover cockpit.lan

And now you're ready to use the feature. There's an account called
"admin" with the password "foobarfoo".

To test your DNS, the following should succeed without any error messages
on your server with cockpit:

    $ host cockpit.lan

Now verify that you can authenticate against the IPA server. See password
above.

    $ kinit admin@COCKPIT.LAN
    Password for admin@COCKPIT.LAN:

**BUG:** IPA sometimes fails to start up correctly on system boot. You may
have to log into the IPA server and run `systemctl start ipa`.
[ipa bug](https://bugzilla.redhat.com/show_bug.cgi?id=1071356)

## Setting up Single Sign on

Cockpit can perform single sign on authentication via Kerberos. To test and
work on this feature, you must have a domain on your network. See section
above if you do not.

Use the following guide to configure things, with more troubleshooting advice
below:

http://cockpit-project.org/guide/latest/sso.html

**BUG:** The host name of the computer Cockpit is running on should end with
the domain name. If it does not, then rename the computer Cockpit is running on:
[realmd bug](https://bugzilla.redhat.com/show_bug.cgi?id=1144343)

    $ sudo hostnamectl set-hostname my-server.domain.com

**BUG:** If your domain is an IPA domain, then you need to explictly add a service
before Cockpit can be used with Single Sign on. The following must be done on
the computer running Cockpit.
[realmd bug](https://bugzilla.redhat.com/show_bug.cgi?id=1144292)

    $ sudo -s
    # kinit admin@COCKPIT.LAN
    # curl -s --negotiate -u : https://f0.cockpit.lan/ipa/json \
            --header 'Referer: https://f0.cockpit.lan/ipa' \
            --header "Content-Type: application/json" \
            --header "Accept: application/json" \
            --data '{"params": [["HTTP/my-server.cockpit.lan@COCKPIT.LAN"], {"raw": false, "all": false, "version": "2.101", "force": true, "no_members": false, "ipakrbokasdelegate": true}], "method": "service_add", "id": 0}'
    # ipa-getkeytab -q -s f0.cockpit.lan -p HTTP/my-server.cockpit.lan \
            -k /etc/krb5.keytab

Now when you go to your cockpit instance you should be able to log in without
authenticating. Make sure to use the full hostname that you set above, the one
that includes the domain name.

If you want to use Cockpit to connect to a second server make sure that second
server is joined to a domain, and that you can ssh into it using GSSAPI authentication
with the domain user:

    $ ssh -o PreferredAuthentications=gssapi-with-mic admin@my-server2.domain.com

If you thought that was nasty and tiresome, it's because it is at present :S

## Using delegated credentials

Cockpit can delegate forwardable credentials. Make sure to specify you want them
during kinit:

    $ kinit -f admin@COCKPIT.LAN
    $ klist -f
    Default principal: admin@COCKPIT.LAN
    ...
	Flags: FIA

Use the IPA GUI to setup "Trusted for delegation" for the host and service that
Cockpit is running on. Make sure to tell the browser to delegate credentials
as seen in the guide:

http://cockpit-project.org/guide/latest/sso.html

Ze goggles, zey do nothing!

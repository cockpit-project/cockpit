cockpit TLS proxy
=================

`cockpit-tls` is a TLS terminating HTTP proxy for cockpit-ws. TLS termination
should not be done directly in `cockpit-ws`, as that is hard to audit and trust:
This code is subject to external attacks through HTTP, does a *lot* of
interpretation of data streams, uses a lot of external dependencies, and
multiplexes sessions of different users in one process. Thus any vulnerability
can easily lead to complete privilege escalation across all running and future
sessions.

By isolating the TLS termination and certificate checking from the http
processing, and isolating http processing for each client certificate, Cockpit
can do certificate based client authentication (smart cards, browser-imported
certificates, and similar) in a sufficiently robust manner. Any tampering with
a `cockpit-ws` process is then unable to affect other sessions and the
certificate attestation.

Design goals
------------

 * Run TLS termination (cockpit-tls) and the actual data interpretation and
   sessions (cockpit-ws) in separate security contexts, so that vulnerabilities
   in the HTTP session cannot affect the trust put into the TLS authentication.
 * Run separate cockpit-ws processes for each TLS client certificate, plus one
   instance for "https without certificate", and another one for "unencrypted
   http", so that one tampered session cannot affect the others.
 * cockpit-tls *does not* interpret the HTTP data stream, to avoid risking any
   vulnerability. It is only allowed to inspect the first byte of a new
   connection to decide between TLS or plain HTTP, and do the TLS negotiation
   and encryption/decryption. In other words, it treats the payload on the TLS
   connection as a black box.
 * Minimal dependencies: Only glibc and a TLS library (GnuTLS at the moment),
   so that the code can be audited (by humans or things like coverity) more
   easily.

Structure
---------

```
+---------+  http://machine:9090                           +------------------------+
|Browser A|+----------------------+                    +-->|cockpit-ws http instance|
+---------+                       |                    |   +------------------------+
                                  |                    |
                                  |                    +   (plain HTTP over Unix socket)
                                  |                    |
+---------+  https://machine:9090 |    +------------+  |   +------------------------------------+
|Browser B|+----------------------+--->| cockpit-tls|--+-->|cockpit-ws https instance for cert B|
+---------+    client cert B      |    +------------+  +   +------------------------------------+
                                  |                    |
                                  |                    |
+---------+  https://machine:9090 |                    |   +------------------------------------+
|Browser C|+----------------------+                    +-->|cockpit-ws https instance for cert C|
+---------+    client cert C                               +------------------------------------+
```

The startup of these instances and isolating them from one another makes heavy
use of systemd features.

 * The top-level unit that the admin enables/controls is [cockpit.socket](../ws/cockpit.socket.in),
   which listens to the port (9090 by default).
 * That activates [cockpit.service](../ws/cockpit.service.in), which ensures
   that a server TLS certificate is present and starts `cockpit-tls`, usually
   as user `cockpit-ws` (for historical reasons, to avoid having to change the
   ownership of `/etc/cockpit/ws-certs.d/*` on upgrades).
 * When accepting a connection, cockpit-tls checks if it uses TLS:
   - If not, it connects to [cockpit-wsinstance-http.socket](../src/ws/cockpit-wsinstance-http.socket.in) or
     [cockpit-wsinstance-http-redirect.socket](../src/ws/cockpit-wsinstance-http-redirect.socket.in).
   - If the connection does use TLS, it calculates the fingerprint of the
     client certificate (using the empty string if there is none), and connects
     to [cockpit-wsinstance-https-factory.socket](../src/ws/cockpit-wsinstance-https-factory.socket.in).
     This starts a helper factory process `cockpit-wsinstance-factory` that
     reads the fingerprint from stdin, and asks systemd to start a new
     [cockpit-wsinstance-https@fingerprint.socket](../src/ws/cockpit-wsinstance-https@.socket.in)
     and .service pair.
 * Each instance runs in its own systemd cgroup, as another unprivileged system
   user `cockpit-wsinstance`.
 * cockpit-tls exports the client certificates to `/run/cockpit/tls/<fingerprint>`
   while there is at least one open connection with that certificate, i. e. as
   long as there is an active Cockpit session.

Client certificate authentication
---------------------------------

This must be explicitly enabled in cockpit.conf with `ClientCertAuthentication = yes`,
see the [guide](../../doc/guide/cert-authentication.xml) and
[manpage](../../doc/man/cockpit.conf.xml). Then cockpit-tls will ask the
browser for a client certificate.

Commonly this is provided by a smart card, but it's equally possible to import
certificates directly into the web browser.

This requires the host to be in an Identity Management domain like
[FreeIPA](https://www.freeipa.org/) or [Active
Directory](https://en.wikipedia.org/wiki/Active_Directory), which can associate
certificates to users. See the [FreeIPA User Certificates
documentation](https://www.freeipa.org/page/V4/User_Certificates) for details.

The `sssd-dbus` package must be installed for this to work.

If the web browser presents a client certificate, cockpit-tls will write this
certificate to `/run/cockpit/tls`.   If cockpit-ws sees that cockpit-tls
exports a certificate for its connection (by checking its cgroup instance name,
which is the certificate fingerprint, and checking /run/cockpit/tls for it),
then it will request the `tls-cert` authentication schema from cockpit-session,
instead of the usual `basic` or `gssapi`. cockpit-session then uses the content
of this file to ask sssd to map the certificate to a username.  If the mapping
is successful, cockpit-session sets the user name and opens the PAM session
without further authentication.


Code layout
-----------

 * A `Connection` (in `connection.[hc]`) object represents a single TCP
   connection from a client (browser) towards cockpit-tls. Each connection is
   handled in its own thread, so that blocked connections cannot starve others.
   It has the code for launching ws instances and shoveling data back and forth
   between the browser and the ws instance.

 * A `Server` (in `server.[hc]`) object represents the cockpit-tls logic. It is
   a singleton (not instantiated), and mostly split out into a separate object
   so that it can be properly unit tested. It maintains some global
   configuration, listens to the port, and coordinates the connection threads.
   and `WsInstance` objects according to incoming requests.

 * `certfile.[hc]` deals with exporting current certificates to
   /run/cockpit/tls/, and the refcounting from all Connections that belong to a
   particular certificate.

The other files are helpers or unit tests.

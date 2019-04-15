cockpit TLS proxy
=================

`cockpit-tls` is a TLS terminating HTTP proxy for cockpit-ws. TLS termination
should not be done directly in `cockpit-ws`, as that is hard to audit and trust:
This code is subject to external attacks through HTTP, does a *lot* of
interpretation of data streams, uses a lot of external dependencies, and
multiplexes sessions of different users in one process. Thus any vulnerability
can easily lead to complete privilege escalation across all running and future
sessions.

Right now this does not have any extra features over using cockpit-ws directly
(other than better isolation). In the future, it will be able to do certificate
based client authentication (smart cards, browser-imported certificates, and
similar), which greatly aggravates the above security trust issue.

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
   so that the code can be audited (by humans or things  like coverity) more
   easily.

```
  +---------+   https://machine:9090                             +---------------------+
  | Browser |<-----------------------+                       +-->| no-cert ws instance |
  +---------+     no client cert     |                       |   +---------------------+
                                     |    +-------------+    |
                                     +--->| cockpit-tls |<---+ (plain HTTP over Unix socket)
                                     |    +-------------+    |
  +---------+   https://machine:9090 |                       |   +------------------------+
  | Browser |<-----------------------+                       +-->| ws instance for cert A |
  +---------+     client cert A                                  +------------------------+
```

Current status
--------------

cockpit-tls currently does the TLS termination, but without client-side
certificates. It also runs as the same `cockpit-ws` system user as cockpit-ws
itself, so currently there is only process isolation. It does the multiplexing
of cockpit-ws. So it should be completely transparent to outside users for now.

Code layout
-----------

 * A `Connection` (in `connection.[hc]`) object represents a single TCP
   connection from a client (browser) towards cockpit-tls. It can be used as a
   linked-list.
 * A `WsInstance` (in `wsinstance.[hc]`) object represents a `cockpit-ws`
   process for a particular client side certificate (or no certificate),
   together with a Unix socket that is connected to it.
 * A `Server` (in `server.[hc]`) object represents the cockpit-tls logic. It is
   usually a singleton, and mostly split out into a separate object so that it
   can be properly unit tested. It maintains a list of `Connection` and
   `WsInstance` objects according to incoming requests.
 * `main.c` does the CLI option parsing and instantiation of a `Server` object.

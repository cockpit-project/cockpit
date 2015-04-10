Cockpit Re-Authorization Documentation
======================================

This document is about authorization which is the means by which an already
authenticated user is checked to see if they are valid/allowed in some context.

cockpit-bridge runs as the authenticated user. Like many other programs, when
it needs to perform a privileged action, it does this either via DBus + Polkit
or sudo.

In this way Cockpit respects and integrates with the policy and access control
configured on the system.

Both polkit and sudo often reauthorize users to check if they are still present
at the console. This is where the complexity of using Cockpit with Polkit and/or
sudo arises.

This document does not deal with Polkit and sudo rules where the user is directly
allowed or denied for a given action or command. Those work as expected, and
need no further attention from Cockpit. The remainder of this document deals
with the cases where reauthorization is requested by Polkit or sudo before
performing an action.

**Goals:**

 * Allow use of kerberos (via GSSAPI) for reauthorization.
 * Allow one machine to reauthorize a user logged in via a different machine.
 * Don't leak the user's password to a user owned process, especially across
   multiple machines.
 * Don't require a TTY to prompt for a password: no TTY available.
 * Don't prompt twice in a row for user paswsord: once when logging in, and
   once immediately afterwords when performing the privileged action that user
   logged into Cockpit to do.

**Design:**

 * Remember that Cockpit is an administrative tool and not a general
   purpose user session.
 * Users who just logged into Cockpit should start off authorized for
   the priveleged actions/roles/commands which the policy dictates.
 * The user can become deauthorized after a timeout or by choice, after
   which point they must enter their credentials again before they can
   perform priveleged actions again.

The security characteristics of the scheme documented here are presented
individually at the end.


Polkit Refresher
----------------

http://www.freedesktop.org/software/polkit/docs/latest/

polkitd is a DBus daemon that manages a set of privileged actions, and each
action has policy for who is allowed to perform that action. DBus system
services ask polkit whether they are permitted to perform an action on behalf
of a given client.

In the case of many actions, polkitd is configured to require that a user prove
that they are the one performing the action. This is called reauthorizing the
user.

Various agents can register with polkit and offer to reauthorize the user. Most
do this via re-authenticating via the PAM stack, usually via password. The agents
themselves usually consist of a privileged and unprivileged component. While the
unprivileged component can do any necessary prompting, the privileged part actually
reauthorizes the user and communicates the result back to polkitd.

The default polkit agent code provided with polkit uses PAM running in a setuid
binary to reauthorize the user by authenticating them through PAM.


Sudo Refresher
--------------

http://www.sudo.ws/

sudo is a setuid program which is called on the command line to either allow
the user to run either a shell or a command as another user, often a privileged
user. It is configured with various rules in the sudoers file which restrict
who can run what as whom.

In the case of many commands, sudo is configured to require that the user prove
that they are the one performing the action. This is called reauthorizing the
user.


Cockpit Auth Refresher
----------------------

The goal is for Cockpit to have two authentication modes. Password (via PAM)
and Kerberos (via GSSAPI). The kerberos authentication is not yet implemented.

We suggest people implement other desired authentication mechanisms
(such as certificate based auth) as part of their kerberos based domain.

See [doc/authenticte.md](authenticate.md) for more details.


Cockpit Session Refresher
-------------------------

cockpit-ws is the web service which serves the HTML and javascript to the
browser, holds user credentials, validates cookies, and through which the
javascript connects back to Cockpit via a WebSocket.

cockpit-bridge is the process performs various actions on behalf of the user.
It is run in a real PAM, selinux, and unix session. It processes the DBus
or REST or commands on behalf of Cockpit.

To launch cockpit-bridge, locally a small wrapper called cockpit-session
sets up the session and changes to the right user, and executes cockpit-bridge
inside it.

When connecting to a remote machine cockpit-bridge is launched via ssh, and
ssh takes care of setting up the session.

See [doc/cockpit-transport.png](cockpit-transport.png) for more on how the
various components of cockpit interact, although not everything is represented.

Kernel Keyring Refresher
------------------------

The kernel keyring holds secrets in unpageable memory and allows processes to
retrieve them based on various access rights.

One nice feature is it's possible to have a subtree of processes have their
own 'session' keyring. We use this feature in Cockpit.

See keyring(7)


Authorization Implementation
============================

Given that the goal of both polkit and sudo is to check whether the user is
present at the machine, we provide that reauthorization from cockpit-ws, and
verify it in the pam_reauthorize.so PAM module.

At a high level here's what happens. First during initial authentication
of the user:

 * The pam_reauthorize.so module is present late in "auth" stack.
   * If root is being authenticated then bail
   * If ```geteuid() != 0``` then bail
   * If a PAM authtok password is present:
      * ```salt = "$6$" encode_alnum(read("/dev/urandom", 16))```
      * ```secret = crypt(authtok, salt)```
      * Save ```secret``` for session handler
 * The pam_reauthorize.so module is present late in "session" stack.
   * If ```secret``` was saved by "auth" handler, place this in the
     session kernel keyring, owned by root, and readable only
     by root.

Note that if GSSAPI was used to authenticate then nothing happens
above. In fact the "auth" PAM stack is not called (eg: sshd).

When cockpit-bridge starts it does:

 * Registers itself as a polkit agent for its own session.
 * Like all other polkit agents, cockpit-bridge's polkit agent
   has a privileged helper: cockpit-polkit

When Polkit needs to reauthorize the user, it connects to the
cockpit-bridge polkit agent:

 * cockpit-bridge checks that polkit is trying to reauthorize
   the current user and bails if not.
 * Via its privileged helper, cockpit-bridge performs the following:
   * If ```getuid() == 0``` then bail
   * If ```geteuid() != 0``` then bail
   * If ```secret``` is present in session kernel keyring.
     * Verify that ```secret``` in keyring is owned by root, and only readable
       by root, otherwise: bail
     * Parse ```salt``` out of ```secret```
     * ```nonce = "$6$" encode_alnum(read("/dev/urandom", 16))```
     * ```challenge = "crypt1:" encode_hex(user) ":" salt ":" nonce```
   * If no ```secret``` is present in session kernel keyring
     * Lookup shadow sp_spwdp entry, and use that as a secret, if present
       and is a valid salted crypt hash.
   * If no ```secret``` available
     * ```challenge = "gssapi1:" encode_hex(user)```
   * Send ```challenge``` to cockpit-ws
   * Wait for ```response``` from cockpit-ws
   * If ```startswith(response, "gssapi1:")``` then
     * Pass response to ```gss_accept_sec_context()``` appropriately
     * User has reauthorized if successful GSSAPI auth
   * If ```startswith(response, "crypt1:")``` then:
     * ```expected = "crypt1:" crypt(nonce, secret)```
     * User has reauthorized if ```response``` is identical to ```expected```

When sudo wants to reauthorize the user, we place a pam module in
its PAM stack so it does this reauthorization via a polkit action with
a policy of ```auth_self```.

See [doc/protocol.md](protocol.md) for the exact syntax the messages that
carry the challenge and response between cockpit-bridge and cockpit-ws.

Before cokcpit-ws returns the response back, it checks that various criteria
are met. See below.

Security Characteristics and Implications
=========================================

Oracle
------

When polkit or sudo reauthorize the user, they use a privileged oracle which
checks whether a given user is present at the machine. The user is reauthorized
based on the decision of this oracle. In the polkit and sudo cases this oracle
is a PAM module like pam_unix.so running in a privileged process on the same
machine as the user.

In the cockpit case the oracle is not a PAM module, but is cockpit-ws. The
cockpit-ws process tells us whether the user is still present. cockpit-ws runs
as a privileged process, often on another machine.

As an oracle cockpit-ws can track:

 * Whether the user is still logged in.
 * Whether the user's browser is still connected.
 * Whether a timeout has occurred since the last privileged (ie: administrative
   write, whatever you want to call it) action was performed by the user.
 * The user can be reprompted for the password.

Based on these criteria, cockpit-ws can declare to polkit/sudo that the user is
still around and should be reauthorized.

In addition the domain acts as an oracle in the kerberos case, and during
reauthorization we check that the account is still valid for the given host in
question.

Once again: any access policy (either centralized from the domain or not) applied
to the user for the given action is over and above the reauthorization discussed here.

Snooping
--------

In their default (and most often used configuration) both sudo and Polkit prompt
for passwords via unprivileged user processes. There is no protection against
snooping. Some prompting tools imagine that they provide some snooping security via
grabbing the X keyboard. This is not the case.

When authenticated via kerberos we will reauthorize the user via GSSAPI, and as such
will have the protection against snooping that GSSAPI affords.

This scheme also does not try to prevent snooping of the authorization token, and
thus has the same security characteristics of Polkit and sudo.

Better: We do better than typical polkit and sudo password based reauthorization,
as we do not let the user's plain text password actually transit any unprivileged
process.

Replay prevention
-----------------

In their default (and most often used configuration) both sudo and Polkit prompt
for passwords and make no attempt to prevent those passwords being replayed
multiple times in a scripted manner or saved for later nefarious use.

Better: this scheme prevents replay of a response once it is used. The nonce
included in the response is random and must be identical to the one in the
challenge.

When authenticated via kerberos we will reauthorize the user via
GSSAPI, and as such will have similar replay prevention characteristics to GSSAPI.

PAM usage
---------

The pam_reauthorize.so PAM module is in the PAM auth and session stacks
for the following (below some other PAM module that has authenticated
the user):

 * cockpit
 * sshd

The PAM module is present to derive the secret from a password login.
This allows us to not send the user's password through the user's
session.

Session Keyring
---------------

We use the session kernel keyring. It is best practice to have pam_keyinit.so
in the PAM stack in order to have a different session keyring per PAM session.

However even in the absence of a unique session kernel keyring, this
reauthorization scheme is secure. However various components may step on each
other's toes and cause reauthorization to fail (and fall back to other forms
of reauthorization). This is a fail safe.

We place the secret in the session kernel keyring. However this secret is
only writable and readable by root. Before using the secret from the session
kernel keyring, we verify that it is owned by root, and nobody else has any
permissions (including link permissions).

Reauthentication
----------------

Reauthenticating the user is done in polkit and sudo to verify that the user is
actually present. It is also done under the assumption that the user will be
operating unprivileged most of the time, and perform select priveleged tasks.

Cockpit has a different use case. It is an administrative console. Asking the
user to reauthenticate as themselves immediately after login to perform privileged
tasks would be pointless.

Reprompting for passwords also doesn't work at all with single-sign-on, where
the user has authenticated transparently and is using Cockpit based on the
authorization (host-based and time-based) of the domain. In a single-sign-on
solution we can neither assume that the user has a password to retype, is able
to reauthenticate.

Cockpit will provide reauthorization via cockpit-ws based on the presence of
valid credentials (ie: not logged out) and recent reauthorization. After a
period of inactivity credentials timeout, and cannot be used to reauthorize.

When kerberos is in use, Cockpit reauthorize the user via GSSAPI
at each reauthorization. This prevents uses of tickets that have expired, and
checks domain policy regularly.


Use of crypt()
--------------

We use crypt() as opposed to some other MACing function as it has a stable
known portable API, correctly handles any FIPS requirements, and system
policy.

By prepending '$6$' (or something like it) to the salt, we get high strength
hashing. This can be upgraded over time, as the hashing function is chosen
by pam_cockpit_authorize.so, and respected by cockpit-ws.

We also have algorithm mobility so that the PAM module can choose an
appropriately strong algorithm, over time.

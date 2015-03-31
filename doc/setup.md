
Cockpit Setup Mechanisms
========================

Cockpit has a very strong concept of the user who is logged in. When adding
a machine to the dashboard, the same user should be available on all the
machines.

In general it is ideal if the identity is kept in sync using a domain, such
as a FreeIPA domain. However to make things work in an ad-hoc deployment,
Cockpit offers to setup the other machine to authenticate similarly enough
so that it can be successfully added to the dashboard.

This is implemented using an extensible DBus interface on the internal
cockpit-bridge bus. It looks like this:

```
node /setup {
  interface cockpit.Setup {
    methods:
      Prepare(in  s mechanism,
              out v data);
      Transfer(in  s mechanism,
               in  v data,
               out v data);
      Commit(in  s mechanism,
             in  v data);
    signals:
    properties:
      readonly as Mechanisms = ['passwd1'];
  };
```

There are multiple mechanisms for doing the setup. The basic one is called
```passwd1``` and syncs user accounts, passwords, and group membership.

On the destination machine the ```Prepare()``` method is invoked with
the ```mechanism``` type, and produces some data.

The prepared data is passed to the ```Transfer()``` function on the source
machine, which returns additional data.

The transferred data is passed to the ```Commit()``` function on the
destination machine to complete the setup.

passwd1
-------

The format of ```passwd``` data is a DBus variant containing a tuple that
looks like this: ```(asas)```. That is, two arrays of strings. The first array
is a set of passwd(5) lines. The second array is a set of group(5) lines.

The passwd(5) lines contain hashed passwords. We only transfer accounts
that are not determined to be "system" accounts. We do not sync UIDs and
GIDs. Nor do we change the shell / home directory of accounts that already
exist. Groups are not created on the remote system, but membership is
added to where necessary.

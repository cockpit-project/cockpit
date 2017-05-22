# Cockpit Bots

These are automated bots and tools that work on Cockpit. This
includes updating operating system images, testing changes,
releasing Cockpit and more.

Bots are being migrated into this directory and this documentation
will be updated as they are.

## Images

In order to test Cockpit it is staged into an operating system
image. These images are tracked in the ```bots/images``` directory.

For managing these images:

 * image-download: Download test images
 * image-upload: Upload test images
 * image-create: Create test machine images
 * image-prepare: Build and install Cockpit packages into a test machine image

For debugging the images:

 * image-run: Run a test machine image


## Integration with GitHub

A number of machines are watching our GitHub repository and are
executing tests for pull requests as well as making new images.

Most of this happens automatically, but you can influence their
actions with the github-trigger utility in this directory.

### Setup

You need a GitHub token in ~/.config/github-token.  You can create one
for your account at

    https://github.com/settings/tokens

When generating a new personal access token, the scope only needs to
encompass public_repo (or repo if you're accessing a private repo).

### Retrying a failed test

If you want to run the "verify/fedora-24" testsuite again for pull
request #1234, run github-trigger like so:

  $ bots/github-trigger 1234 verify/fedora-24

### Testing a pull request by a non-whitelisted user

If you want to run all tests on pull request #1234 that has been
opened by someone who is not in our white-list, run github-trigger
like so:

  $ bots/github-trigger -f 1234

Of course, you should make sure that the pull request is proper and
doesn't execute evil code during tests.

### Refreshing a test image

Test images are refreshed automatically once per week, and even if the
last refresh has failed, the machines wait one week before trying again.

If you want the machines to refresh the fedora-24 image immediately,
run github-trigger like so:

  $ bots/github-trigger --image fedora-24

### Creating new images for a pull request

If as part of some new feature you need to change the content of some
or all images, you can ask the machines to create those images.

If you want to have a new fedora-24 image for pull request #1234, run
github-trigger like so:

  $ bots/github-trigger --image fedora-24 1234

The machines will post comments to the pull request about their
progress and at the end there will be links to commits with the new
images.  You can then include these commits into the pull request in
any way you like.

NOTE: as part of this, the pull request will get the "bot" label and
the machines will not automatically test pull requests with that
label.  Thus, once the images are made, remove the "bot" label.

If you are certain about the changes to the images, it is probably a
good idea to make a dedicated pull request just for the images.  That
pull request can then hopefully be merged to master faster.  If
instead the images are created on the main feature pull request and
sit there for a long time, they might cause annoying merge conflicts.

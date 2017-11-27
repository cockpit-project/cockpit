# Hacking on the Cockpit Bots

These are automated bots and testing that works on the Cockpit project. This
includes updating operating system images, bringing in changes from other
projects, releasing Cockpit and more.

## Environment for the bots

The bots work in containers that are built in the [cockpituous](https://github.com/cockpit-project/cockpituous)
repository. New dependencies should be added there in the `tests/Dockerfile`
file in that repository.

## Invoking the bots

 1. The containers in the `cockpitous` repository invoke the `.tasks` file
at root of this repository.
 1. The ```.tasks``` file prints out a list of possible tasks on standard out.
 1. The printed tasks are sorted in alphabetical reverse order, and one of the
first items in the list is executed.

## The bots themselves

Most bots are python scripts. They live in this `bots/` directory. Shared code
is in the `bots/tasks` directory.

## Bots filing issues

Many bots file or work with issues in GitHub repository. We can use issues to tell
bots what to do. Often certan bots will just file issues for tasks that are outstanding.
And in many cases other bots will then perform those tasks.

These bots are listed in the `bots/issue-scan` file. They are written using the
`bots/tasks/__init__.py` code, and you can see `bots/example-task` for an
example of one.

## Bots printing output

The bot output is posted using the cockpitous [sink](https://github.com/cockpit-project/cockpituous/tree/master/sink) code. See that link for how it works.

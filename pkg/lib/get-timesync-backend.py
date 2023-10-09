import os
import subprocess

# get-timesync-backend - determine which NTP backend unit timedatectl
#                        will likely enable.

roots = ["/etc", "/run", "/usr/local", "/usr/lib", "/lib"]


def gather_files(name, suffix):
    # This function creates a list of files in the same order that
    # systemd will read them in.
    #
    # First we collect all files in all root directories.  Duplicates
    # are avoided by only storing files with a basename that hasn't
    # been seen yet.  The roots are processed in order so that files
    # in /etc override identically named files in /usr, for example.
    #
    # The files are stored in a dict with their basename (such as
    # "10-chrony.list") as the key and their full pathname (such as
    # "/usr/lib/systemd/ntp-units.d/10-chrony.list") as the value.
    #
    # This arrangement allows for easy checks for duplicate basenames
    # while retaining access to the full pathname later when creating
    # the final result.
    #
    pathname_by_basename = {}
    for r in roots:
        dirname = os.path.join(r, name)
        if os.path.isdir(dirname):
            for basename in os.listdir(dirname):
                if basename.endswith(suffix) and basename not in pathname_by_basename:
                    pathname_by_basename[basename] = os.path.join(dirname, basename)

    # Then we create a list of the full pathnames, sorted by their
    # basenames.
    #
    sorted_basenames = sorted(pathname_by_basename.keys())
    return [pathname_by_basename[basename] for basename in sorted_basenames]


def unit_exists(unit):
    load_state = subprocess.check_output(["systemctl", "show", "--value", "-p", "LoadState", unit],
                                         universal_newlines=True).strip()
    return load_state != "not-found" and load_state != "masked"


def first_unit(files):
    for f in files:
        with open(f) as c:
            for ll in c.readlines():
                w = ll.strip()
                if w != "" and not w.startswith("#") and unit_exists(w):
                    return w
    return None


unit = first_unit(gather_files("systemd/ntp-units.d", ".list"))

if unit:
    print(unit)

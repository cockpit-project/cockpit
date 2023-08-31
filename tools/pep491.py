# This is a post-install hack for the Install-Paths-To functionality from the
# (Deferred) PEP 491. See https://peps.python.org/pep-0491/ for details.

# We pass the filename on the command line instead of reading it from METADATA
# to avoid potential conflicts when/if the feature gets added in the future.

import argparse
import os
import sysconfig


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('prefix')
    parser.add_argument('pkg')
    parser.add_argument('file')
    parser.add_argument('lines', nargs='+')
    args = parser.parse_args()

    # figure out where our files should be located
    paths = sysconfig.get_paths('posix_prefix', vars={'base': args.prefix})
    purelib = paths['purelib']
    assert purelib.startswith(args.prefix)

    # write the dynamic content (note: file must already exist)
    with open(f'{purelib}/{args.file}', 'w', encoding='utf-8') as file:
        file.writelines(f'{line}\n' for line in args.lines)

    # update the RECORD entry, don't bother with the checksum
    with open(f'{purelib}/{args.pkg}.dist-info/RECORD', 'r+', encoding='utf-8') as file:
        file.seek(0, os.SEEK_SET)
        lines = file.readlines()

        file.seek(0, os.SEEK_SET)
        for line in lines:
            if line.startswith(f'{args.file},'):
                line = f'{args.file},,\n'
            file.write(line)


if __name__ == '__main__':
    main()

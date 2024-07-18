import os
import os.path
import subprocess
import sys


def main(path):
    # If the path does not exist, we will create but need to verify it lives on the same volume
    if not os.path.exists(path):
        if path.endswith('/'):
            path = path.rstrip('/')
        path = os.path.dirname(path)

        # bail out if the parent path is not found
        if not os.path.exists(path):
            sys.exit(2)

    try:
        print(subprocess.check_output(["findmnt", "--output", "UUID", "--no-heading", "--target", path]))
    except subprocess.SubprocessError as exc:
        print(exc, file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.stdout.write("Path not provided\n")
        sys.exit(1)

    main(sys.argv[1])

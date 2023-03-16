import os
import sys

from cockpit._vendor.ferny import interaction_client

pw = os.environ.get('PSEUDO_PASSWORD')
if pw:
    reader, writer = os.pipe()
    # '-' is the (ignored) argv[0], and 'can haz pw' is the message in argv[1]
    interaction_client.interact(2, writer, ['-', 'can haz pw?'], {})
    os.close(writer)

    response = os.read(reader, 1024).decode('utf-8').strip()
    if response != pw:
        sys.stderr.write('pseudo says: Bad password\n')
        sys.exit(1)

os.execvp(sys.argv[1], sys.argv[1:])

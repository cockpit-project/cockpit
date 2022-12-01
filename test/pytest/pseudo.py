import os
import json
import sys

pw = os.environ.get('PSEUDO_PASSWORD')
if pw:
    challenge = '\n{"command":"authorize", "challenge":"plain1:", "cookie":"dontcare", "prompt": "can haz pw?"}\n'
    sys.stdout.write(f'{len(challenge)}\n{challenge}')
    sys.stdout.flush()

    response = json.loads(sys.stdin.read(int(sys.stdin.readline())))
    if response.get('response') != pw:
        sys.stderr.write('pseudo says: Bad password\n')
        sys.exit(1)

os.execvp(sys.argv[1], sys.argv[1:])

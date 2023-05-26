import importlib
import os
import subprocess
import sys

BASE_DIR = os.path.realpath(f'{__file__}/../../..')
TEST_DIR = f'{BASE_DIR}/test'
BOTS_DIR = f'{BASE_DIR}/bots'

sys.path.append(BOTS_DIR)
sys.path.append(f'{TEST_DIR}/common')
sys.path.append(f'{BOTS_DIR}/machine')


def ensure_bots():
    if not os.path.isdir(BOTS_DIR):
        subprocess.check_call([f'{BASE_DIR}/test/common/make-bots'])
        importlib.invalidate_caches()

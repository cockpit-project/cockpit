import sys
import os

CURRENT_DIR = os.path.dirname(os.path.realpath(__file__))
TEST_DIR = os.path.dirname(CURRENT_DIR)
BOTS_DIR = os.path.join(os.path.dirname(TEST_DIR), "bots")
LOCAL_COMMON_DIR = os.path.join(TEST_DIR, "common")
LOCAL_COPY_COMMON_DIR = os.path.join(CURRENT_DIR, "common")

LOCAL_MACHINE_DIR = os.path.join(BOTS_DIR, "machine")
LOCAL_COPY_MACHINE_DIR = os.path.join(CURRENT_DIR, "machine")

if os.path.exists(LOCAL_COMMON_DIR):
    sys.path.append(LOCAL_COMMON_DIR)
else:
    sys.path.append(LOCAL_COPY_COMMON_DIR)

if os.path.exists(LOCAL_MACHINE_DIR):
    sys.path.append(LOCAL_MACHINE_DIR)
else:
    sys.path.append(LOCAL_COPY_MACHINE_DIR)

import sys
import os

CURRENT_DIR = os.path.dirname(os.path.realpath(__file__))

if CURRENT_DIR not in sys.path:
    sys.path.insert(1, CURRENT_DIR)

COMMON_DIR = os.path.realpath(os.path.join(CURRENT_DIR, "common"))
if COMMON_DIR not in sys.path:
    sys.path.insert(1, COMMON_DIR)

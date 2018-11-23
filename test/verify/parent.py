import os
import sys

TEST_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOTS_DIR = os.path.join(os.path.dirname(TEST_DIR), "bots")
sys.path.append(os.path.join(TEST_DIR, "common"))
sys.path.append(os.path.join(BOTS_DIR, "machine"))

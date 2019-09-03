import ctypes, os

# see <linux/time.h>
CLOCK_REALTIME = 0
CLOCK_MONOTONIC = 1

class timespec(ctypes.Structure):
    _fields_ = [
        ('tv_sec', ctypes.c_long),
        ('tv_nsec', ctypes.c_long)
    ]

librt = ctypes.CDLL('librt.so.1', use_errno=True)
c_clock_gettime = librt.clock_gettime
c_clock_gettime.argtypes = [ctypes.c_int, ctypes.POINTER(timespec)]

def clock_gettime(clock):
    t = timespec()
    if c_clock_gettime(clock , ctypes.pointer(t)) != 0:
        errno_ = ctypes.get_errno()
        raise OSError(errno_, os.strerror(errno_))
    return t.tv_sec + t.tv_nsec * 1e-9

print (clock_gettime(CLOCK_REALTIME) - clock_gettime(CLOCK_MONOTONIC))

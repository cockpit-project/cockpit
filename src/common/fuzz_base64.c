#include "config.h"

#include "cockpitbase64.h"

#include <stdint.h>

#define kMinInputLength 2
#define kMaxInputLength 1024

extern int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int
LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
    char     encoded[2048];
    uint8_t  decoded[2048];

    if (size < kMinInputLength || size > kMaxInputLength)
        return 0;

    cockpit_base64_ntop(data, size, encoded, sizeof(encoded));
    cockpit_base64_pton((char *)data, size, decoded, sizeof(decoded));

    return 0;
}

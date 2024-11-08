# Fuzzing cockpit

## Build cockpit fuzzer using libFuzzer.

### Export flags for fuzzing.

Note that in `CFLAGS` and `CXXFLAGS`, any type of sanitizers can be added.

- [AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html),
    [ThreadSanitizer](https://clang.llvm.org/docs/ThreadSanitizer.html),
    [MemorySanitizer](https://clang.llvm.org/docs/MemorySanitizer.html),
    [UndefinedBehaviorSanitizer](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html),
    [LeakSanitizer](https://clang.llvm.org/docs/LeakSanitizer.html).

```shell
$ export CC=clang
$ export CXX=clang++
$ export CFLAGS="-g -DFUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION -fsanitize=address,undefined -fsanitize=fuzzer-no-link"
$ export CXXFLAGS="-g -DFUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION -fsanitize=address,undefined -fsanitize=fuzzer-no-link"
$ export LIB_FUZZING_ENGINE="-fsanitize=fuzzer"
```

### Build cockpit for fuzzing.

```shell
$ ./autogen.sh --enable-fuzzing --disable-doc
$ make -j$(nproc)
```

### Running fuzzer.

```shell
$ mkdir -p fuzz_authorize_seed fuzz_base64_seed fuzz_websocket_seed

$ ./fuzz_authorize fuzz_authorize_seed src/common/fuzz_authorize_seed_corpus
$ ./fuzz_base64 fuzz_base64_seed src/common/fuzz_base64_seed_corpus
$ ./fuzz_websocket fuzz_websocket_seed src/websocket/fuzz_websocket_seed_corpus
```

Here is more information about [LibFuzzer](https://llvm.org/docs/LibFuzzer.html).

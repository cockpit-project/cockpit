# Python decorators for FMF metadata

## Copy of code
This is copy of source code inside

https://github.com/jscotka/fmf_metadata

When doing PR here please consider to do PR also to main origin project.
Or do it there and We'll create PR inside cockpit to update to latest bits 

## Usage

### FMF data regeneration
It generates FMF file for verify testsuite and update `test/verify.fmf` file
```
PYTHONPATH=`pwd`/test/common:`pwd`/test/verify test/common/fmf_metadata/cli.py --config test/common/fmf_metadata/tests/cockpit_metadata_config.yaml -u
```

### run one test via TMT via explicit FMF name
Schedule test on your machine (`-a provision -h local`)
```
tmt --root test run -a provision -h local test --name /verify/check-testlib/TestRunTestListing/testBasic
```

### run all nondestructive tests
```
tmt -r test run -a provision -h local test --filter non_destructive:True
```

### Verify the tool
```
cd test/common/fmf_metadata/
make check 
```

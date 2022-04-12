# doesn't do anything on its own.  must be sourced.

# The script which sources this script must set the following variables:
#   GITHUB_REPO = the relative repo name of the submodule on github
#   SUBDIR = the location in the working tree where the submodule goes
# We also expect `set -eu`.
[ -n "${GITHUB_REPO}" ]
[ -n "${SUBDIR}" ]

# Set by git-rebase for spawned actions
unset GIT_DIR GIT_EXEC_PATH GIT_PREFIX GIT_REFLOG_ACTION GIT_WORK_TREE

GITHUB_BASE="${GITHUB_BASE:-cockpit-project/cockpit}"
GITHUB_REPOSITORY="${GITHUB_BASE%/*}/${GITHUB_REPO}"
HTTPS_REMOTE="https://github.com/${GITHUB_REPOSITORY}"

CACHE_DIR="${XDG_CACHE_HOME-${HOME}/.cache}/cockpit-dev/${GITHUB_REPOSITORY}.git"

if [ "${V-}" = 0 ]; then
    message() { printf "  %-8s %s\n" "$1" "$2" >&2; }
    quiet='--quiet'
else
    message() { :; }
    quiet=''
fi

# runs a git command on the cache dir
git_cache() {
    git --git-dir "${CACHE_DIR}" "$@"
}

# reads the named gitlink from the current state of the index
# returns (ie: prints) a 40-character commit ID
get_index_gitlink() {
    if ! git ls-files -s "$1" | egrep -o '\<[[:xdigit:]]{40}\>'; then
        echo "*** couldn't read gitlink for file $1 from the index" >&2
        exit 1
    fi
}

init_cache() {
    if [ ! -d "${CACHE_DIR}" ]; then
        message INIT "${CACHE_DIR}"
        mkdir -p "${CACHE_DIR}"
        git init --bare --template='' ${quiet} "${CACHE_DIR}"
        git_cache remote add origin "${HTTPS_REMOTE}"
    fi
}

# This checks if the given argument "$1" (already) exists in the repository
# we use git rev-list --objects to to avoid problems with incomplete fetches:
# we want to make sure the complete commit is there
check_ref() {
    git_cache rev-list --quiet --objects "$1" -- 2>/dev/null
}

# Fetch a specific commit ID into the cache
# Either we have this commit available locally (in which case this function
# does nothing), or we need to fetch it.  There's no chance that the object
# changed on the server, because we define it by its checksum.
fetch_sha_to_cache() {
    sha="$1"

    init_cache
    # No "offline mode" here: we either have the commit, or we don't
    if ! check_ref "${sha}"; then
        message FETCH "${SUBDIR}  [ref: ${sha}]"
        git_cache fetch --no-tags ${quiet} origin "${sha}"
        # tag it to keep it from being GC'd.
        git_cache tag "sha-${sha}" "${sha}"
    fi
}

# General purpose "fetch" function to be used with tags, refs, or nothing at
# all (to fetch everything).  This checks the server for updates, because all
# of those things might change at any given time.  Supports an "offline" mode
# to skip the fetch and use the possibly-stale local version, if we have it.
fetch_to_cache() {
    # We're fetching a named ref (or all refs), which means:
    #  - we should always do the fetch because it might have changed. but
    #  - we might be able to skip updating in case we already have it
    init_cache
    if [ -z "${OFFLINE-}" ]; then
        message FETCH "${SUBDIR}  ${1+[ref: $*]}"
        git_cache fetch --prune ${quiet} origin "$@"
    fi
}

# Get the content of "$2" from cache commit "$1"
cat_from_cache() {
    git_cache cat-file blob "$1:$2"
}

# Consistency checking: for a given cache commit "$1", check if it contains a
# file "$2" which is equal to the file "$3" present in the working tree.
cmp_from_cache() {
    cat_from_cache "$1" "$2" | cmp "$3"
}

# Like `git clone` except that it uses the original origin url and supports
# checking out commit IDs as detached heads.  The target directory must either
# be empty, or not exist.
clone_from_cache() {
    message CLONE "${SUBDIR}  [ref: $1]"
    [ ! -e "${SUBDIR}" ] || rmdir "${SUBDIR}"
    mkdir "${SUBDIR}"
    cp -a --reflink=auto "${CACHE_DIR}" "${SUBDIR}/.git"
    git --git-dir "${SUBDIR}/.git" config --unset core.bare
    git -c advice.detachedHead=false -C "${SUBDIR}" checkout ${quiet} "$1"
}

# This copies the files without setting up the git repository.  The copied
# files are expected to be in a same-named subdirectory inside the cache
# repository.
unpack_from_cache() {
    message "UNPACK" "${SUBDIR}  [ref: $1]"
    git_cache archive "$1" "${SUBDIR}" | tar -x --touch "${SUBDIR}"
}

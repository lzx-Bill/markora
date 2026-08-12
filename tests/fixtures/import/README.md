# Import safety fixtures

`normal-tree` and `mixed` are committed byte fixtures. `cases.json` is the canonical descriptor
for unsafe entries that must never be unpacked into the repository. The portability unit tests
construct ZIP files in a private temporary directory from these shapes and cover invalid UTF-8,
traversal, absolute/backslash paths, duplicate normalized paths, symlinks, depth/count/size limits,
compression ratio and partial failure without committing hazardous archives.

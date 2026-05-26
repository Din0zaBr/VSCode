package storage

import "strconv"

// itoa is a thin wrapper used to build placeholder lists (e.g. "$1", "$2") in
// dynamic SQL queries throughout this package.
func itoa(n int) string { return strconv.Itoa(n) }

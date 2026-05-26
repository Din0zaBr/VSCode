// Generate a bcrypt password hash for ADMIN_PASSWORD_HASH in .env
//
// Usage:
//   cd UrsusSiem/scripts
//   go run gen-password-hash.go              # prompts interactively
//   go run gen-password-hash.go MyP@ss123    # hashes the given argument

//go:build ignore

package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	var password string

	if len(os.Args) > 1 {
		password = strings.Join(os.Args[1:], " ")
	} else {
		fmt.Print("Password: ")
		r := bufio.NewReader(os.Stdin)
		line, err := r.ReadString('\n')
		if err != nil {
			fmt.Fprintln(os.Stderr, "read error:", err)
			os.Exit(1)
		}
		password = strings.TrimRight(line, "\r\n")
	}

	if len(password) < 8 {
		fmt.Fprintln(os.Stderr, "password must be at least 8 characters")
		os.Exit(1)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		fmt.Fprintln(os.Stderr, "bcrypt error:", err)
		os.Exit(1)
	}

	fmt.Println(string(hash))
}

package password

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"golang.org/x/crypto/argon2"
	"strings"
)

// OWASP minimum Argon2id parameters: 19 MiB, 2 iterations, 1 lane.
const prefix = "$argon2id$v=19$m=19456,t=2,p=1$"

func Hash(value string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	key := argon2.IDKey([]byte(value), salt, 2, 19*1024, 1, 32)
	return prefix + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key)
}
func Verify(value, encoded string) (bool, error) {
	if !strings.HasPrefix(encoded, prefix) {
		return false, fmt.Errorf("unsupported password hash")
	}
	parts := strings.Split(strings.TrimPrefix(encoded, prefix), "$")
	if len(parts) != 2 {
		return false, fmt.Errorf("invalid password hash")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil || len(salt) != 16 {
		return false, fmt.Errorf("invalid hash salt")
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil || len(expected) != 32 {
		return false, fmt.Errorf("invalid hash key")
	}
	actual := argon2.IDKey([]byte(value), salt, 2, 19*1024, 1, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}
